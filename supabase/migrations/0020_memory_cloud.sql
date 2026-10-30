-- [INPUT]: 不可变微信原话、当前回执修订与已确认的MemOS云接入。
-- [OUTPUT]: 回复版本档案、持久化记忆任务、投递确认与同步租约。
-- [POS]: 云记忆出口；只索引微信文字，不复制用户正文或OAuth载荷。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  raw_input_id uuid not null references public.raw_inputs(id), role text not null check(role in ('user','assistant')),
  receipt_revision integer, content text, happened_at timestamptz not null,
  delivered_at timestamptz, origin text not null default 'live' check(origin in ('live','legacy')),
  created_at timestamptz not null default now(),
  check((role='user' and receipt_revision is null and content is null)
    or (role='assistant' and receipt_revision is not null and receipt_revision>=0 and content is not null))
);
create unique index conversation_user_once on public.conversation_messages(raw_input_id) where role='user';
create unique index conversation_reply_once on public.conversation_messages(raw_input_id,receipt_revision) where role='assistant';
create index conversation_owner_time on public.conversation_messages(owner_id,happened_at);

create table public.memory_jobs (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  message_id uuid not null unique references public.conversation_messages(id),
  state text not null check(state in ('waiting_delivery','pending','submitting','processing','completed','failed','unknown')),
  task_id text, lease_token uuid, lease_until timestamptz, next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0, failure_count integer not null default 0,
  error_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz
);
create index memory_jobs_due on public.memory_jobs(owner_id,next_attempt_at,created_at)
  where state in ('pending','processing','submitting');
alter table public.conversation_messages enable row level security;
alter table public.memory_jobs enable row level security;
revoke all on public.conversation_messages,public.memory_jobs from anon,authenticated;
grant select on public.conversation_messages to authenticated;
grant select(id,owner_id,message_id,state,task_id,attempts,failure_count,error_code,created_at,updated_at,completed_at)
  on public.memory_jobs to authenticated;
grant all on public.conversation_messages,public.memory_jobs to service_role;
create policy owner_read on public.conversation_messages for select to authenticated using
  (owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');
create policy owner_read on public.memory_jobs for select to authenticated using
  (owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');

create function public.protect_conversation_message() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op in ('DELETE','TRUNCATE') then raise exception 'conversation archive is immutable' using errcode='55000'; end if;
  if (new.id,new.owner_id,new.raw_input_id,new.role,new.receipt_revision,new.content,new.happened_at,new.origin,new.created_at)
    is distinct from (old.id,old.owner_id,old.raw_input_id,old.role,old.receipt_revision,old.content,old.happened_at,old.origin,old.created_at) then
    raise exception 'conversation content is immutable' using errcode='55000'; end if;
  return new;
end;
$$;
create trigger conversation_immutable before update or delete on public.conversation_messages
  for each row execute function public.protect_conversation_message();
create trigger conversation_no_truncate before truncate on public.conversation_messages
  for each statement execute function public.protect_conversation_message();

create function public.enqueue_message_memory() returns trigger language plpgsql set search_path='' as $$
begin
  insert into public.memory_jobs(owner_id,message_id,state)
    values(new.owner_id,new.id,case when new.role='assistant' and new.delivered_at is null then 'waiting_delivery' else 'pending' end)
    on conflict(message_id) do nothing;
  return new;
end;
$$;
create trigger conversation_memory after insert on public.conversation_messages
  for each row execute function public.enqueue_message_memory();

create function public.capture_conversation() returns trigger language plpgsql set search_path='' as $$
begin
  if new.source<>'wechat' then return new; end if;
  if length(btrim(new.text))>0 then
    insert into public.conversation_messages(owner_id,raw_input_id,role,happened_at,delivered_at)
      values(new.owner_id,new.id,'user',new.received_at,new.received_at) on conflict do nothing;
  end if;
  if new.receipt_text is not null and length(btrim(new.receipt_text))>0 then
    if exists(select 1 from public.conversation_messages where raw_input_id=new.id and role='assistant'
      and receipt_revision=new.receipt_revision and content is distinct from new.receipt_text) then
      raise exception 'reply content requires new revision' using errcode='55000'; end if;
    insert into public.conversation_messages(owner_id,raw_input_id,role,receipt_revision,content,happened_at,delivered_at)
      values(new.owner_id,new.id,'assistant',new.receipt_revision,new.receipt_text,now(),new.delivered_at) on conflict do nothing;
    if new.delivered_at is not null then
      update public.conversation_messages set delivered_at=new.delivered_at where raw_input_id=new.id
        and role='assistant' and receipt_revision=new.receipt_revision and delivered_at is null;
      update public.memory_jobs j set state='pending',next_attempt_at=now(),updated_at=now()
        from public.conversation_messages m where j.message_id=m.id and m.raw_input_id=new.id
        and m.receipt_revision=new.receipt_revision and m.role='assistant' and j.state='waiting_delivery';
    end if;
  end if;
  return new;
end;
$$;
create trigger raw_conversation_capture after insert or update of receipt_text,receipt_revision,delivered_at on public.raw_inputs
  for each row execute function public.capture_conversation();

-- 仅回填现存微信原话和仍可证明的当前回执，不重建已覆盖的旧版本。
insert into public.conversation_messages(owner_id,raw_input_id,role,happened_at,delivered_at,origin)
  select owner_id,id,'user',received_at,received_at,'legacy' from public.raw_inputs
  where source='wechat' and length(btrim(text))>0 on conflict do nothing;
insert into public.conversation_messages(owner_id,raw_input_id,role,receipt_revision,content,happened_at,delivered_at,origin)
  select owner_id,id,'assistant',receipt_revision,receipt_text,coalesce(delivered_at,received_at),delivered_at,'legacy'
  from public.raw_inputs where source='wechat' and receipt_text is not null and length(btrim(receipt_text))>0 on conflict do nothing;

create function public.accept_reply(p_owner_id uuid,p_input_id uuid,p_revision integer) returns void
language plpgsql set search_path='' as $$
declare r public.raw_inputs%rowtype;
begin
  select * into strict r from public.raw_inputs where owner_id=p_owner_id and id=p_input_id for update;
  -- 旧确认发送期间出现新修订，也要记录旧确认实际被渠道接受。
  update public.conversation_messages set delivered_at=coalesce(delivered_at,now())
    where owner_id=p_owner_id and raw_input_id=p_input_id and role='assistant' and receipt_revision=p_revision;
  update public.memory_jobs j set state='pending',next_attempt_at=now(),updated_at=now()
    from public.conversation_messages m where j.message_id=m.id and m.raw_input_id=p_input_id
      and m.owner_id=p_owner_id and m.receipt_revision=p_revision and m.role='assistant' and j.state='waiting_delivery';
  update public.raw_inputs set delivered_at=now() where id=r.id and receipt_revision=p_revision;
end;
$$;

create function public.claim_memory_job(p_owner_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare j public.memory_jobs%rowtype; result jsonb;
begin
  -- 未取得task_id的过期写入存在结果不明窗口，禁止盲目重投。
  update public.memory_jobs set state='unknown',error_code='MEMOS_SUBMISSION_UNKNOWN',lease_token=null,lease_until=null,updated_at=now()
    where owner_id=p_owner_id and state='submitting' and task_id is null and lease_until<now();
  select q.* into j from public.memory_jobs q join public.conversation_messages m on m.id=q.message_id
    where q.owner_id=p_owner_id and q.state in ('pending','processing')
    and q.next_attempt_at<=now() and (q.lease_until is null or q.lease_until<now())
    order by m.happened_at,q.created_at,q.id for update of q skip locked limit 1;
  if not found then return null; end if;
  update public.memory_jobs set state=case when task_id is null then 'submitting' else 'processing' end,
    lease_token=gen_random_uuid(),lease_until=now()+interval '1 minute',attempts=attempts+1,updated_at=now()
    where id=j.id returning * into j;
  select jsonb_build_object('id',j.id,'message_id',m.id,'raw_input_id',r.id,'lease_token',j.lease_token,
    'role',m.role,'content',case when m.role='user' then r.text else m.content end,
    'happened_at',m.happened_at,'conversation_id','lifeos-wechat:'||(r.received_at at time zone 'Asia/Shanghai')::date::text,
    'task_id',j.task_id,'state',j.state) into result
    from public.conversation_messages m join public.raw_inputs r on r.id=m.raw_input_id
    where m.id=j.message_id and m.owner_id=p_owner_id and r.owner_id=p_owner_id and r.source='wechat';
  return result;
end;
$$;

create function public.finish_memory_job(p_owner_id uuid,p_id uuid,p_lease_token uuid,p_state text,p_task_id text default null,p_error_code text default null)
returns void language plpgsql set search_path='' as $$
declare j public.memory_jobs%rowtype;
begin
  select * into strict j from public.memory_jobs where id=p_id and owner_id=p_owner_id for update;
  if j.lease_token is null or j.lease_token is distinct from p_lease_token then
    raise exception 'memory lease changed' using errcode='55000'; end if;
  if p_state not in ('processing','completed','retry','failed','unknown') or
    (p_state='processing' and coalesce(j.task_id,p_task_id) is null) or
    (j.task_id is not null and p_task_id is not null and j.task_id<>p_task_id) then
    raise exception 'invalid memory outcome' using errcode='22023'; end if;
  update public.memory_jobs set
    state=case when p_state='retry' then case when failure_count>=4 then 'failed' else case when coalesce(task_id,p_task_id) is null then 'pending' else 'processing' end end else p_state end,
    task_id=coalesce(task_id,p_task_id),lease_token=null,lease_until=null,
    failure_count=failure_count+case when p_state in ('retry','failed','unknown') then 1 else 0 end,
    next_attempt_at=now()+case when p_state='retry' then make_interval(secs=>least(900,30*power(2,least(failure_count,5)))::integer) else interval '5 seconds' end,
    error_code=left(p_error_code,80),updated_at=now(),completed_at=case when p_state='completed' then now() else null end
    where id=p_id;
end;
$$;

create function public.get_memory_sync_status(p_owner_id uuid) returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object('messages',(select count(*) from public.conversation_messages where owner_id=p_owner_id),
  'states',coalesce((select jsonb_object_agg(state,n) from (select state,count(*) n from public.memory_jobs where owner_id=p_owner_id group by state) x),'{}'::jsonb));
$$;

revoke all on function public.protect_conversation_message(),public.enqueue_message_memory(),public.capture_conversation(),
  public.accept_reply(uuid,uuid,integer),public.claim_memory_job(uuid),public.finish_memory_job(uuid,uuid,uuid,text,text,text),public.get_memory_sync_status(uuid)
  from public,anon,authenticated;
grant execute on function public.protect_conversation_message(),public.enqueue_message_memory(),public.capture_conversation(),
  public.accept_reply(uuid,uuid,integer),public.claim_memory_job(uuid),public.finish_memory_job(uuid,uuid,uuid,text,text,text),public.get_memory_sync_status(uuid)
  to service_role;
