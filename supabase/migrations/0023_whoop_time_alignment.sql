-- [INPUT]: 已评分WHOOP睡眠、本人授权的大类策略与原始时间段。
-- [OUTPUT]: 可审计的睡眠校准、首尾刷手机推定和重复同步检查点。
-- [POS]: 设备睡眠真源；软删被替代时段，保留原话、原值与修改版本。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

create table public.time_sleep_alignments(
 owner_id uuid not null references auth.users(id),sleep_id text not null,payload_hash text not null,
 status text not null check(status in ('applied','conflict','invalid')),
 start_at timestamptz,end_at timestamptz,asleep_millis bigint,awake_millis bigint,no_data_millis bigint,
 originals jsonb not null default '[]',generated jsonb not null default '[]',reason text,
 updated_at timestamptz not null default now(),primary key(owner_id,sleep_id)
);
alter table public.time_sleep_alignments enable row level security;
revoke all on public.time_sleep_alignments from public,anon,authenticated;
grant select on public.time_sleep_alignments to authenticated;
grant all on public.time_sleep_alignments to service_role;
create policy owner_read on public.time_sleep_alignments for select to authenticated using
 (owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');

create function public.protect_whoop_sleep() returns trigger language plpgsql set search_path='' as $$
begin
 if old.item_index=0 and exists(select 1 from public.raw_inputs where id=old.raw_input_id and source='whoop')
  and (new.start_at,new.end_at,new.category_id,new.deduction_minutes,new.activity,new.deleted_at)
   is distinct from (old.start_at,old.end_at,old.category_id,old.deduction_minutes,old.activity,old.deleted_at)
  and coalesce(current_setting('lifeos.whoop_time_write',true),'')<>'yes' then
  raise exception '睡眠以WHOOP为准，请在WHOOP修改并同步。' using errcode='22023';end if;
 return new;
end;
$$;
create trigger time_sleep_guard before update on public.time_entries for each row execute function public.protect_whoop_sleep();

create function public.reconcile_whoop_time(p_owner_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare policy public.time_group_policies%rowtype;s jsonb;stages jsonb;hash text;sid text;
 old public.time_sleep_alignments%rowtype;part jsonb;origin public.time_entries%rowtype;current_row public.time_entries%rowtype;
 changed boolean;closed_origins jsonb;
 sleep_start timestamptz;sleep_end timestamptz;actual bigint;awake bigint;nodata bigint;gross integer;
 sleep_category smallint;phone_category smallint;originals jsonb;generated jsonb;raw_id uuid;new_id uuid;
 boundary_start timestamptz;boundary_end timestamptz;idx integer;deduction integer;phone boolean;
 title text;category smallint;tags text[];note text;source_group text;
 applied integer:=0;unchanged integer:=0;conflicts integer:=0;invalid integer:=0;
begin
 select * into policy from public.time_group_policies where owner_id=p_owner_id and sleep_authority;
 if not found then return jsonb_build_object('enabled',false);end if;
 select id into sleep_category from public.categories where owner_id=p_owner_id and kind='time' and is_active and name='睡眠';
 select id into phone_category from public.categories where owner_id=p_owner_id and kind='time' and is_active and name='娱乐';
 if sleep_category is null or phone_category is null then raise exception 'sleep group missing' using errcode='22023';end if;
 -- 与微信切换使用同一短事务表锁，发布期间不会出现半个睡眠段。
 lock table public.time_entries in share row exclusive mode;
 perform set_config('lifeos.whoop_time_write','yes',true);
 for s in select payload from public.whoop_records where owner_id=p_owner_id and kind='sleeps'
  and payload->>'score_state'='SCORED' and (policy.include_naps or payload->>'nap'='false')
  order by (payload->>'start')::timestamptz,payload->>'id' loop
  sid:=s->>'id';hash:=encode(sha256(convert_to(s::text,'UTF8')),'hex');
  select * into old from public.time_sleep_alignments where owner_id=p_owner_id and sleep_id=sid for update;
  if found and old.status='applied' and old.payload_hash=hash then unchanged:=unchanged+1;continue;end if;
  sleep_start:=(s->>'start')::timestamptz;sleep_end:=(s->>'end')::timestamptz;stages:=s#>'{score,stage_summary}';
  actual:=(stages->>'total_light_sleep_time_milli')::bigint+(stages->>'total_slow_wave_sleep_time_milli')::bigint+
   (stages->>'total_rem_sleep_time_milli')::bigint;
  awake:=(stages->>'total_awake_time_milli')::bigint;nodata:=(stages->>'total_no_data_time_milli')::bigint;
  gross:=floor(extract(epoch from(sleep_end-sleep_start))/60)::integer;
  if sleep_start is null or sleep_end is null or sleep_end<=sleep_start or sleep_end>now() or actual is null
   or actual<=0 or actual>extract(epoch from(sleep_end-sleep_start))*1000+1000 or awake<0 or nodata<0 then
   insert into public.time_sleep_alignments(owner_id,sleep_id,payload_hash,status,reason)
    values(p_owner_id,sid,hash,'invalid','INVALID_SCORED_SLEEP') on conflict(owner_id,sleep_id)
    do update set status='invalid',reason=excluded.reason,updated_at=now();invalid:=invalid+1;continue;
  end if;
  if old.sleep_id is not null then
   -- 正常切换关闭晨间手机段时，保留新的结束点；其他人工变化先标记冲突。
   changed:=false;closed_origins:='{}';
   for part in select value from jsonb_array_elements(old.generated) loop
    select * into current_row from public.time_entries where id=(part->>'id')::uuid;
    if not found or current_row.deleted_at is not null then changed:=true;exit;end if;
    if (to_jsonb(current_row)-array['revision','updated_at','duration_min']) is distinct from
      ((part->'baseline')-array['revision','updated_at','duration_min']) then
     if part->>'role'='after' and part#>>'{baseline,end_at}' is null and current_row.end_at>=old.end_at
      and (to_jsonb(current_row)-array['revision','updated_at','duration_min','end_at'])=
        ((part->'baseline')-array['revision','updated_at','duration_min','end_at']) then
      closed_origins:=closed_origins||jsonb_build_object(part->>'sourceId',current_row.end_at);
     else changed:=true;exit;end if;
    end if;
   end loop;
   if changed or exists(select 1 from jsonb_array_elements(old.originals) e left join public.time_entries t on t.id=(e->>'id')::uuid
     where t.id is null or t.deleted_at is null or t.revision<>(e->>'revision')::bigint+1) then
    update public.time_sleep_alignments set status='conflict',reason='SOURCE_CHANGED_AFTER_ALIGNMENT',updated_at=now()
     where owner_id=p_owner_id and sleep_id=sid;conflicts:=conflicts+1;continue;
   end if;
   update public.time_entries set deleted_at=now() where id in
    (select (e->>'id')::uuid from jsonb_array_elements(old.generated) e);
   update public.time_entries set deleted_at=null,end_at=coalesce((closed_origins->>id::text)::timestamptz,end_at) where id in
    (select (e->>'id')::uuid from jsonb_array_elements(old.originals) e);
  end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.start_at,t.id),'[]') into originals
   from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
   where r.owner_id=p_owner_id and t.deleted_at is null and t.start_at<sleep_end
    and coalesce(t.end_at,'infinity'::timestamptz)>sleep_start;
  update public.time_entries set deleted_at=now() where id in
   (select (e->>'id')::uuid from jsonb_array_elements(originals) e);
  raw_id:=gen_random_uuid();
  insert into public.raw_inputs(id,owner_id,source,external_id,text,received_at,payload,input_kind,status,receipt_text,delivered_at)
   values(raw_id,p_owner_id,'whoop','sleep:'||sid||':'||raw_id::text,'WHOOP睡眠校准',sleep_end,
    jsonb_build_object('sleep_id',sid,'source_hash',hash,'nap',s->'nap'),'import','parsed','WHOOP同步，不发送微信回执',now()) on conflict do nothing;
  new_id:=gen_random_uuid();
  deduction:=greatest(0,gross-floor(actual/60000.0)::integer);
  insert into public.time_entries(id,raw_input_id,item_index,start_at,end_at,category_id,activity,deduction_minutes,deduction_note,tags,note)
   values(new_id,raw_id,0,sleep_start,sleep_end,sleep_category,'睡眠',deduction,
    'WHOOP浅睡+深睡+REM为实际睡眠；夜间清醒及无数据不计睡眠。',
    array['whoop-sleep',case when s->>'nap'='true' then 'whoop-nap' else 'whoop-night' end],
    '来源：WHOOP已评分睡眠。睡眠区间内的清醒没有逐段时间戳，不推断为刷手机。');
  select jsonb_build_array(jsonb_build_object('id',new_id,'revision',t.revision,'role','sleep','baseline',to_jsonb(t))) into generated
   from public.time_entries t where t.id=new_id;idx:=0;
  for part in select value from jsonb_array_elements(originals) loop
   origin:=jsonb_populate_record(null::public.time_entries,part);
   select name into source_group from public.categories where id=origin.category_id;
   -- 只在已记录的睡觉/休息窗口首尾推定刷手机，不填造窗口以外的空白。
   phone:=(source_group in ('睡眠','清醒休息','娱乐') or 'whoop-pending'=any(origin.tags))
    and (origin.end_at is null or origin.end_at-origin.start_at<=interval '24 hours');
   for boundary_start,boundary_end in
    select origin.start_at,least(origin.end_at,sleep_start) where origin.start_at<sleep_start
    union all select greatest(origin.start_at,sleep_end),origin.end_at where origin.end_at is null or origin.end_at>sleep_end loop
    if boundary_end is not null and boundary_end<=boundary_start then continue;end if;
    idx:=idx+1;new_id:=gen_random_uuid();
    title:=case when phone then '刷手机' else origin.activity end;
    category:=case when phone then phone_category else origin.category_id end;
    tags:=array_remove(coalesce(origin.tags,'{}'),'whoop-pending')||array[case when phone then 'whoop-phone-estimate' else 'whoop-boundary-fragment' end];
    note:=concat_ws(E'\n',nullif(origin.note,''),case when phone then
     '按本人规则推定：手动睡觉/起床窗口与WHOOP睡眠首尾差额记为刷手机；非设备检测到手机。'
     else 'WHOOP睡眠覆盖区间已校准；此段保留原活动。' end);
    deduction:=case when boundary_end is null or origin.end_at is null then 0 else least(
     floor(extract(epoch from(boundary_end-boundary_start))/60)::integer,
     floor(origin.deduction_minutes*extract(epoch from(boundary_end-boundary_start))/nullif(extract(epoch from(origin.end_at-origin.start_at)),0))::integer) end;
    insert into public.time_entries(id,raw_input_id,item_index,start_at,end_at,category_id,activity,deduction_minutes,deduction_note,project,tags,note)
     values(new_id,raw_id,idx,boundary_start,boundary_end,category,title,deduction,origin.deduction_note,origin.project,tags,note);
    select generated||jsonb_build_array(jsonb_build_object('id',new_id,'revision',t.revision,
      'role',case when boundary_start>=sleep_end then 'after' else 'before' end,'sourceId',origin.id,'baseline',to_jsonb(t)))
     into generated from public.time_entries t where t.id=new_id;
   end loop;
  end loop;
  insert into public.time_sleep_alignments(owner_id,sleep_id,payload_hash,status,start_at,end_at,asleep_millis,awake_millis,no_data_millis,originals,generated)
   values(p_owner_id,sid,hash,'applied',sleep_start,sleep_end,actual,awake,nodata,originals,generated)
   on conflict(owner_id,sleep_id) do update set payload_hash=excluded.payload_hash,status='applied',start_at=excluded.start_at,end_at=excluded.end_at,
    asleep_millis=excluded.asleep_millis,awake_millis=excluded.awake_millis,no_data_millis=excluded.no_data_millis,
    originals=excluded.originals,generated=excluded.generated,reason=null,updated_at=now();
  applied:=applied+1;
 end loop;
 perform set_config('lifeos.whoop_time_write','',true);
 return jsonb_build_object('enabled',true,'applied',applied,'unchanged',unchanged,'conflicts',conflicts,'invalid',invalid,'include_naps',policy.include_naps);
end;
$$;
revoke all on function public.protect_whoop_sleep(),public.reconcile_whoop_time(uuid) from public,anon,authenticated;
grant execute on function public.protect_whoop_sleep(),public.reconcile_whoop_time(uuid) to service_role;

create function public.apply_time_group_review(p_owner_id uuid,p_review_hash text,p_groups jsonb,p_rules jsonb,p_entries jsonb,p_include_naps boolean default true)
returns jsonb language plpgsql set search_path='' as $$
declare item jsonb;row public.time_entries%rowtype;category smallint;installed jsonb;aligned jsonb;n integer:=0;
begin
 if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)>100000 then raise exception 'invalid reviewed records' using errcode='22023';end if;
 lock table public.time_entries in share row exclusive mode;
 installed:=public.install_time_groups(p_owner_id,p_review_hash,p_groups,p_rules,p_include_naps);
 for item in select value from jsonb_array_elements(p_entries) loop
  select t.* into row from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
   where t.id=(item->>'id')::uuid and r.owner_id=p_owner_id and t.deleted_at is null for update of t;
  if not found or row.revision<>(item->>'revision')::bigint or row.activity is distinct from item->>'activity' then
   raise exception 'review record changed' using errcode='40001';end if;
  select id into category from public.categories where owner_id=p_owner_id and kind='time' and is_active
   and name=item->>'group' and metadata->>'bigGroup'='true';
  if category is null then raise exception 'review group missing' using errcode='22023';end if;
  update public.time_entries set category_id=category where id=row.id;
  n:=n+1;
 end loop;
 aligned:=public.reconcile_whoop_time(p_owner_id);
 return jsonb_build_object('classification',installed,'records',n,'sleep',aligned);
end;
$$;
revoke all on function public.apply_time_group_review(uuid,text,jsonb,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.apply_time_group_review(uuid,text,jsonb,jsonb,jsonb,boolean) to service_role;

create function public.get_time_sleep_summary(p_from date,p_to date) returns jsonb
language plpgsql stable set search_path='' as $$
declare owner uuid:=auth.uid();result jsonb;
begin
 if owner is null or (auth.jwt()->>'aal') is distinct from 'aal2' then raise exception 'owner aal2 required' using errcode='42501';end if;
 if p_to<p_from or p_to-p_from>366 then raise exception 'invalid sleep summary range' using errcode='22023';end if;
 if not exists(select 1 from public.time_group_policies where owner_id=owner and sleep_authority) then return null;end if;
 with scored as(select w.source_id,w.payload,
  (w.payload#>>'{score,stage_summary,total_light_sleep_time_milli}')::bigint+
  (w.payload#>>'{score,stage_summary,total_slow_wave_sleep_time_milli}')::bigint+
  (w.payload#>>'{score,stage_summary,total_rem_sleep_time_milli}')::bigint millis
  from public.whoop_records w join public.time_group_policies p on p.owner_id=w.owner_id
  where w.owner_id=owner and w.kind='sleeps' and w.payload->>'score_state'='SCORED'
   and (p.include_naps or w.payload->>'nap'='false')
   and ((w.payload->>'end')::timestamptz at time zone 'Asia/Shanghai')::date between p_from and p_to)
 select jsonb_build_object('source','WHOOP','sleepMinutes',coalesce(sum(floor(millis/60000.0)),0),
  'sleepMillis',coalesce(sum(millis),0),'nights',count(*) filter(where payload->>'nap'='false'),
  'naps',count(*) filter(where payload->>'nap'='true'),
  'conflicts',(select count(*) from public.time_sleep_alignments a where a.owner_id=owner and a.status<>'applied'
   and a.sleep_id in(select source_id from scored)),
  'pending',(select count(*) from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
   where r.owner_id=owner and t.deleted_at is null and t.tags@>array['whoop-pending']
    and (t.start_at at time zone 'Asia/Shanghai')::date between p_from and p_to)) into result from scored where millis>0;
 return result;
end;
$$;
revoke all on function public.get_time_sleep_summary(date,date) from public,anon;
grant execute on function public.get_time_sleep_summary(date,date) to authenticated,service_role;
