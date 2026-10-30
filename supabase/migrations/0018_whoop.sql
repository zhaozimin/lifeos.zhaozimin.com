-- [INPUT]: VPS唯一WHOOP同步器、本人AAL2与既有微信回执队列。
-- [OUTPUT]: 身体记录发布副本、保留修订的训练报告和受限异步操作。
-- [POS]: 健康域云端边界；OAuth令牌不进入本库或浏览器。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

create table public.whoop_records(
 owner_id uuid not null references auth.users(id),kind text not null check(kind in ('cycles','recoveries','sleeps','workouts')),
 source_id text not null,payload jsonb not null,updated_at timestamptz not null default now(),
 primary key(owner_id,kind,source_id)
);
create table public.whoop_publications(
 owner_id uuid not null references auth.users(id),key text not null,value jsonb not null,
 updated_at timestamptz not null default now(),primary key(owner_id,key)
);
create table public.whoop_plans(
 owner_id uuid not null references auth.users(id),target_date date not null,time_zone text not null,
 revision integer not null check(revision>0),payload jsonb not null,published_at timestamptz not null default now(),
 primary key(owner_id,target_date,time_zone,revision)
);
create table public.whoop_jobs(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
 action text not null check(action in ('sync','generate','settings','checkin')),payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','running','succeeded','failed')),
 result jsonb,error text,created_at timestamptz not null default now(),finished_at timestamptz,
 lease_token uuid,lease_until timestamptz,attempts integer not null default 0
);
create index whoop_jobs_pending on public.whoop_jobs(owner_id,created_at) where status in ('pending','running');

alter table public.whoop_records enable row level security;
alter table public.whoop_publications enable row level security;
alter table public.whoop_plans enable row level security;
alter table public.whoop_jobs enable row level security;
revoke all on public.whoop_records,public.whoop_publications,public.whoop_plans,public.whoop_jobs from anon,authenticated;
grant select on public.whoop_records,public.whoop_publications,public.whoop_plans,public.whoop_jobs to authenticated;
grant all on public.whoop_records,public.whoop_publications,public.whoop_plans,public.whoop_jobs to service_role;
create policy owner_read on public.whoop_records for select to authenticated using
 (owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');
create policy owner_read on public.whoop_publications for select to authenticated using
 (owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');
create policy owner_read on public.whoop_plans for select to authenticated using
 (owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');
create policy owner_read on public.whoop_jobs for select to authenticated using
 (owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');

create function public.publish_whoop(p_owner_id uuid,p_records jsonb,p_publications jsonb,p_plans jsonb)
returns void language plpgsql set search_path='' as $$
declare item jsonb; pair record;
begin
 if p_publications::text ~ '"(access_token|refresh_token|clientSecret|clientId)"[[:space:]]*:' then
  raise exception 'credentials cannot be published' using errcode='22023'; end if;
 if jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>10000
  or jsonb_typeof(p_publications)<>'object' or jsonb_typeof(p_plans)<>'array' then
  raise exception 'invalid health publication' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_records) loop
  insert into public.whoop_records(owner_id,kind,source_id,payload) values
   (p_owner_id,item->>'kind',item->>'id',item->'payload') on conflict(owner_id,kind,source_id)
   do update set payload=excluded.payload,updated_at=now() where whoop_records.payload is distinct from excluded.payload;
 end loop;
 for pair in select * from jsonb_each(p_publications) loop
  if pair.key not in ('status','dashboard:7','dashboard:30','dashboard:90','plans','export','summary') then
   raise exception 'unknown health publication' using errcode='22023'; end if;
  insert into public.whoop_publications values(p_owner_id,pair.key,pair.value,now()) on conflict(owner_id,key)
   do update set value=excluded.value,updated_at=now();
 end loop;
 for item in select value from jsonb_array_elements(p_plans) loop
  insert into public.whoop_plans(owner_id,target_date,time_zone,revision,payload) values
   (p_owner_id,(item->>'targetDate')::date,item->>'timeZone',(item->>'revision')::integer,item)
   on conflict do nothing;
 end loop;
end;
$$;

create function public.enqueue_whoop_job(p_id uuid,p_action text,p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=public.dashboard_owner(); old public.whoop_jobs%rowtype;
begin
 if jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>16000
   or p_action not in ('sync','generate','settings','checkin') then
  raise exception 'invalid health operation' using errcode='22023'; end if;
 if p_action='settings' and p_payload-array['goal','experience','constraints','reportTime','wakeTime','timeZone','age','diet','foodRestrictions']<>'{}' then
  raise exception 'credential changes require private console' using errcode='22023'; end if;
 if p_action='sync' and p_payload-array['days']<>'{}' then raise exception 'invalid sync' using errcode='22023'; end if;
 if p_action='generate' and p_payload<>'{}' then raise exception 'invalid generation' using errcode='22023'; end if;
 if p_action='checkin' and p_payload-array['date','energy','soreness','weight','nutrition','notes','symptoms']<>'{}' then
  raise exception 'invalid checkin' using errcode='22023'; end if;
 select * into old from public.whoop_jobs where id=p_id;
 if found then
  if old.owner_id<>v_owner or old.action<>p_action or old.payload<>p_payload then
   raise exception 'operation identity conflict' using errcode='40001'; end if;
  return old.id;
 end if;
 if (select count(*) from public.whoop_jobs where owner_id=v_owner and status in ('pending','running'))>=10 then
  raise exception 'health queue busy' using errcode='54000'; end if;
 insert into public.whoop_jobs(id,owner_id,action,payload) values(p_id,v_owner,p_action,p_payload);
 return p_id;
end;
$$;
create function public.claim_whoop_job(p_owner_id uuid) returns setof public.whoop_jobs
language plpgsql set search_path='' as $$
declare r public.whoop_jobs%rowtype;
begin
 -- 失去响应的写入结果未知，留给人工核对，不重放生成或写入。
 update public.whoop_jobs set status='failed',error='操作结果待核对，请刷新查看；不要重复提交。',finished_at=now()
  where owner_id=p_owner_id and status='running' and lease_until<now();
 select * into r from public.whoop_jobs where owner_id=p_owner_id and status='pending'
  order by created_at for update skip locked limit 1;
 if not found then return; end if;
 update public.whoop_jobs set status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',
  attempts=attempts+1 where id=r.id returning * into r;
 return next r;
end;
$$;
create function public.finish_whoop_job(p_id uuid,p_lease_token uuid,p_result jsonb,p_error text default null)
returns void language plpgsql set search_path='' as $$
begin
 update public.whoop_jobs set status=case when p_error is null then 'succeeded' else 'failed' end,
  result=p_result,error=left(p_error,300),finished_at=now(),lease_until=null
  where id=p_id and lease_token=p_lease_token and status='running';
 if not found then raise exception 'health operation lease changed' using errcode='55000'; end if;
end;
$$;

create function public.enqueue_whoop_morning(p_owner_id uuid,p_date date,p_time_zone text,p_revision integer,p_text text)
returns jsonb language plpgsql set search_path='' as $$
declare local_now timestamp:=now() at time zone p_time_zone; plan jsonb; target jsonb; result uuid;
begin
 select payload into plan from public.whoop_plans where owner_id=p_owner_id and target_date=p_date
  and time_zone=p_time_zone and revision=p_revision;
 if plan is null or plan#>>'{publication,state}' is distinct from 'published' or p_date<>local_now::date
  or local_now::time<coalesce((select value#>>'{settings,reportTime}' from public.whoop_publications
   where owner_id=p_owner_id and key='status'),'07:00')::time or local_now::time>='12:00'::time then
  return jsonb_build_object('queued',false,'reason','outside_window_or_waiting'); end if;
 if length(p_text) not between 1 and 3500 then raise exception 'invalid morning receipt' using errcode='22023'; end if;
 select payload into target from public.raw_inputs where owner_id=p_owner_id and source='wechat'
  and payload ? 'from_user_id' and payload ? 'context_token'
  and received_at>now()-interval '24 hours' order by received_at desc limit 1;
 if target is null then return jsonb_build_object('queued',false,'reason','no_context'); end if;
 insert into public.raw_inputs(owner_id,source,external_id,text,received_at,payload,input_kind,status,parse_result,receipt_text)
 values(p_owner_id,'system','health:morning:'||p_date||':'||p_time_zone,'晨间运动计划',now(),target,'command','parsed',
  jsonb_build_object('command','health','day',p_date,'revision',p_revision),p_text)
 on conflict(owner_id,source,external_id) do nothing returning id into result;
 return jsonb_build_object('queued',result is not null,'reason',case when result is null then 'already_queued' else 'queued' end);
end;
$$;
revoke all on function public.publish_whoop(uuid,jsonb,jsonb,jsonb),public.enqueue_whoop_job(uuid,text,jsonb),
 public.claim_whoop_job(uuid),public.finish_whoop_job(uuid,uuid,jsonb,text),public.enqueue_whoop_morning(uuid,date,text,integer,text)
 from public,anon,authenticated;
grant execute on function public.enqueue_whoop_job(uuid,text,jsonb) to authenticated;
grant execute on function public.publish_whoop(uuid,jsonb,jsonb,jsonb),public.claim_whoop_job(uuid),
 public.finish_whoop_job(uuid,uuid,jsonb,text),public.enqueue_whoop_morning(uuid,date,text,integer,text) to service_role;
