-- [INPUT]: 微信闭合时段、目标快照与当前计时版本。
-- [OUTPUT]: 原子区间替换、区间外片段、完整审计和因果撤销。
-- [POS]: 历史时段执行器；原话不变，派生记录可裁剪和恢复。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

create function public.find_time_replacement_targets(p_input_id uuid,p_requests jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare r public.raw_inputs%rowtype; request jsonb; first_at timestamptz; last_at timestamptz; targets jsonb;
begin
  if jsonb_typeof(p_requests) is distinct from 'array' or jsonb_array_length(p_requests)>10 then
    raise exception '一次最多调整10个时段。' using errcode='22023'; end if;
  if p_requests='[]'::jsonb then return '[]'; end if;
  select * into strict r from public.raw_inputs where id=p_input_id;
  if r.source<>'wechat' then raise exception 'wechat input required' using errcode='22023'; end if;
  for request in select value from jsonb_array_elements(p_requests) loop
    if jsonb_typeof(request) is distinct from 'object'
      or request-array['start_at','end_at','activity','category','note']<>'{}'
      or not(request ?& array['start_at','end_at','activity','category'])
      or exists(select 1 from jsonb_each(request) x where
        (x.key<>'note' and jsonb_typeof(x.value)<>'string')
        or (x.key='note' and jsonb_typeof(x.value) not in ('string','null')))
      or length(btrim(request->>'activity')) not between 1 and 500
      or length(coalesce(request->>'note',''))>500 then
      raise exception '请提供日期、起止钟点、活动和已有分类。' using errcode='22023'; end if;
    first_at:=(request->>'start_at')::timestamptz; last_at:=(request->>'end_at')::timestamptz;
    if not isfinite(first_at) or not isfinite(last_at) or last_at<=first_at
      or last_at>r.received_at+interval '1 minute' or last_at-first_at>interval '24 hours' then
      raise exception '请提供已经发生的有效时段，每段不超过24小时。' using errcode='22023'; end if;
  end loop;
  select coalesce(jsonb_agg(value order by start_at,id),'[]') into targets from (
    select t.id,t.start_at,to_jsonb(t)||jsonb_build_object('category',c.name,'source',i.source) value
    from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
    join public.categories c on c.id=t.category_id
    where i.owner_id=r.owner_id and t.deleted_at is null and exists(
      select 1 from jsonb_array_elements(p_requests) x
      where t.start_at<(x->>'end_at')::timestamptz and coalesce(t.end_at,'infinity')>(x->>'start_at')::timestamptz)
    order by t.start_at,t.id limit 51
  ) matching;
  return targets;
end;
$$;

-- 复制片段保留原分类、备注、项目及标签；创建和更新均写审计。
create function public.insert_time_replacement_fragment(p_input uuid,p_index integer,
  p_start timestamptz,p_end timestamptz,p_template jsonb)
returns uuid language plpgsql set search_path='' as $$
declare saved public.time_entries%rowtype; owner uuid;
begin
  select owner_id into strict owner from public.raw_inputs where id=p_input;
  if not exists(select 1 from public.categories where id=(p_template->>'category_id')::smallint
    and owner_id=owner and kind='time') then
    raise exception 'invalid fragment category' using errcode='22023'; end if;
  insert into public.time_entries(raw_input_id,item_index,start_at,end_at,category_id,activity,note,
    deduction_minutes,deduction_note,project,tags)
  values(p_input,p_index,p_start,p_end,(p_template->>'category_id')::smallint,p_template->>'activity',
    p_template->>'note',0,p_template->>'deduction_note',p_template->>'project',
    array(select jsonb_array_elements_text(coalesce(p_template->'tags','[]')))) returning * into saved;
  insert into public.record_changes(owner_id,kind,record_id,revision,before_data,after_data,actor)
    values(owner,'time',saved.id,saved.revision,'{}',to_jsonb(saved),'service');
  if saved.category_id is distinct from (p_template->>'category_id')::smallint then
    update public.time_entries set category_id=(p_template->>'category_id')::smallint where id=saved.id;
  end if;
  return saved.id;
end;
$$;

create function public.apply_time_replacements(p_input_id uuid,p_lease_token uuid,p_result jsonb,
  p_expected_targets jsonb,p_expected_ongoing jsonb default null)
returns public.raw_inputs language plpgsql set search_path='' as $$
declare r public.raw_inputs%rowtype; requests jsonb; targets jsonb; request jsonb; original jsonb;
  old_row public.time_entries%rowtype; first_at timestamptz; last_at timestamptz; category smallint;
  next_index integer:=100; originals jsonb:='[]'; generated jsonb; question text; plan jsonb;
begin
  select * into strict r from public.raw_inputs where id=p_input_id for update;
  if r.revoked_at is not null or r.status in ('parsed','ignored') then return r; end if;
  if r.source<>'wechat' or r.lease_token is null or r.lease_token is distinct from p_lease_token then
    raise exception 'invalid replacement lease' using errcode='55000'; end if;
  begin
    requests:=p_result->'time_replacements';
    if jsonb_typeof(requests) is distinct from 'array' or jsonb_array_length(requests) not between 1 and 10
      or nullif(p_result->>'clarify','') is not null
      or coalesce(p_result->'time_corrections','[]')<>'[]'::jsonb then
      raise exception '请将整条记录纠错与区间替换分开发送。' using errcode='22023'; end if;
    lock table public.time_entries in share row exclusive mode;
    targets:=public.find_time_replacement_targets(r.id,requests);
    if targets is distinct from p_expected_targets
      or (p_expected_ongoing is not null and public.get_steward_context(r.owner_id)->'ongoing' is distinct from p_expected_ongoing) then
      raise exception '时间记录刚刚发生变化，请重发日期、时段和活动，我会按最新记录调整。' using errcode='P0001'; end if;
    if jsonb_array_length(targets)>50 then
      raise exception '本次涉及超过50条记录，请缩短时段后重发。' using errcode='P0001'; end if;
    if exists(select 1 from jsonb_array_elements(requests) with ordinality a(value,n)
      join jsonb_array_elements(requests) with ordinality b(value,n) on a.n<b.n
      where (a.value->>'start_at')::timestamptz<(b.value->>'end_at')::timestamptz
        and (a.value->>'end_at')::timestamptz>(b.value->>'start_at')::timestamptz) then
      raise exception '这次提供的时段彼此重叠，请给出互不重叠的最终时段。' using errcode='P0001'; end if;
    if exists(select 1 from jsonb_array_elements(targets) x where
      (x->>'source'='whoop' and (x->>'item_index')::integer=0) or x->'tags'?'whoop-sleep') then
      raise exception '该区间含WHOOP评分睡眠，请先核对设备睡眠；本次未修改任何记录。' using errcode='P0001'; end if;
    if exists(select 1 from jsonb_array_elements(targets) x where (x->>'deduction_minutes')::integer>0) then
      raise exception '原记录含扣减时长，无法确定扣减属于哪个片段，本次未修改。请先明确并修正原记录的扣减。' using errcode='P0001'; end if;
    for request in select value from jsonb_array_elements(requests) order by (value->>'start_at')::timestamptz loop
      first_at:=(request->>'start_at')::timestamptz; last_at:=(request->>'end_at')::timestamptz;
      select id into category from public.categories where owner_id=r.owner_id and kind='time' and is_active
        and code=public.resolve_time_group(r.owner_id,request->>'activity',request->>'category');
      if category is null then raise exception '请选择已有的时间分类。' using errcode='P0001'; end if;
      -- 每个区间读取最新片段，允许一条原记录被多个不相交区间裁剪。
      for old_row in select t.* from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
        where i.owner_id=r.owner_id and t.deleted_at is null
          and t.start_at<last_at and coalesce(t.end_at,'infinity')>first_at order by t.start_at,t.id for update of t loop
        update public.time_entries set deleted_at=clock_timestamp(),deletion_reason='wechat-time-replacement' where id=old_row.id;
        if old_row.start_at<first_at then
          perform public.insert_time_replacement_fragment(r.id,next_index,old_row.start_at,first_at,to_jsonb(old_row));
          next_index:=next_index+1;
        end if;
        if old_row.end_at is null or old_row.end_at>last_at then
          perform public.insert_time_replacement_fragment(r.id,next_index,last_at,old_row.end_at,to_jsonb(old_row));
          next_index:=next_index+1;
        end if;
      end loop;
      perform public.insert_time_replacement_fragment(r.id,next_index,first_at,last_at,
        jsonb_build_object('activity',request->>'activity','category_id',category,'note',request->>'note','tags','[]'::jsonb));
      next_index:=next_index+1;
    end loop;
    plan:=p_result-array['time_replacements','time_corrections'];
    select * into r from public.apply_steward(r.id,p_lease_token,plan,public.get_steward_context(r.owner_id)->'ongoing');
    if r.status<>'parsed' then
      raise exception '%',coalesce(r.clarification_prompt,'后续记录未通过校验，本次修改未提交。') using errcode='P0001'; end if;
    if exists(select 1 from public.time_entries t join public.time_entries x on t.id<>x.id
      join public.raw_inputs i on i.id=x.raw_input_id where t.raw_input_id=r.id and t.deleted_at is null
        and x.deleted_at is null and i.owner_id=r.owner_id and t.start_at<coalesce(x.end_at,'infinity')
        and coalesce(t.end_at,'infinity')>x.start_at) then
      raise exception '同时提交的活动存在重叠，请给出各段最终的起止时间。' using errcode='P0001'; end if;
    for original in select value from jsonb_array_elements(targets) loop
      select * into strict old_row from public.time_entries where id=(original->>'id')::uuid;
      originals:=originals||jsonb_build_array(jsonb_build_object('before',original,'after_deleted',to_jsonb(old_row)));
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'revision',t.revision,'deleted_at',t.deleted_at) order by t.id),'[]')
      into generated from public.time_entries t where t.raw_input_id=r.id;
    update public.raw_inputs set parse_result=r.parse_result||jsonb_build_object('_time_replacements',
      jsonb_build_object('requests',requests,'originals',originals,'generated',generated))
      where id=r.id returning * into r;
    return r;
  exception when sqlstate 'P0001' or sqlstate '22023' or sqlstate '22007' or sqlstate '22008' or sqlstate '23514' then
    get stacked diagnostics question=message_text;
  end;
  select * into r from public.apply_steward(p_input_id,p_lease_token,jsonb_build_object(
    'time_entries','[]'::jsonb,'transactions','[]'::jsonb,'clarify',question));
  update public.raw_inputs set parse_result=r.parse_result||jsonb_build_object('_pending_time_replacements',requests)
    where id=r.id returning * into r;
  return r;
end;
$$;

alter function public.run_command(uuid,uuid,text) rename to run_command_before_time_replacements;
create function public.run_command(p_input_id uuid,p_lease_token uuid,p_command text)
returns public.raw_inputs language plpgsql set search_path='' as $$
declare r public.raw_inputs%rowtype; target public.raw_inputs%rowtype; change jsonb; old_row public.time_entries%rowtype;
  restored integer:=0; seen uuid[]:='{}';
begin
  if p_command<>'undo' then return public.run_command_before_time_replacements(p_input_id,p_lease_token,p_command); end if;
  select * into strict r from public.raw_inputs where id=p_input_id for update;
  if r.status='parsed' or r.revoked_at is not null then return r; end if;
  if r.input_kind<>'command' or r.lease_token is null or r.lease_token is distinct from p_lease_token then
    raise exception 'invalid command lease' using errcode='55000'; end if;
  lock table public.time_entries in share row exclusive mode;
  select * into target from public.raw_inputs where owner_id=r.owner_id and input_kind='record'
    and revoked_at is null and status<>'ignored' and received_at<=r.received_at and id<>r.id
    order by received_at desc,created_at desc for update limit 1;
  if not(coalesce(target.parse_result,'{}')?'_time_replacements') then
    return public.run_command_before_time_replacements(p_input_id,p_lease_token,p_command); end if;
  begin
    for change in select value from jsonb_array_elements(target.parse_result->'_time_replacements'->'originals') loop
      if not exists(select 1 from public.time_entries where id=(change->'before'->>'id')::uuid
        and deleted_at is not null and revision=(change->'after_deleted'->>'revision')::bigint) then
        raise exception 'original changed' using errcode='P0001'; end if;
    end loop;
    for change in select value from jsonb_array_elements(target.parse_result->'_time_replacements'->'generated') loop
      if not exists(select 1 from public.time_entries t where t.id=(change->>'id')::uuid
        and t.revision=(change->>'revision')::bigint and to_jsonb(t)->'deleted_at'=change->'deleted_at') then
        raise exception 'fragment changed' using errcode='P0001'; end if;
    end loop;
    select * into r from public.run_command_before_time_replacements(p_input_id,p_lease_token,p_command);
    for change in select value from jsonb_array_elements(target.parse_result->'_time_replacements'->'originals') loop
      old_row:=jsonb_populate_record(null::public.time_entries,change->'before');
      update public.time_entries set deleted_at=null,deletion_reason=old_row.deletion_reason where id=old_row.id;
      seen:=seen||array[old_row.id]; restored:=restored+1;
    end loop;
    if exists(select 1 from public.time_entries t join public.time_entries x on t.id<>x.id
      join public.raw_inputs i on i.id=x.raw_input_id where t.id=any(seen) and t.deleted_at is null
        and x.deleted_at is null and i.owner_id=r.owner_id and t.start_at<coalesce(x.end_at,'infinity')
        and coalesce(t.end_at,'infinity')>x.start_at) then
      raise exception 'undo overlap' using errcode='P0001'; end if;
    update public.raw_inputs set parse_result=r.parse_result||jsonb_build_object(
      'replacement_undone',true,'restored_replacement_records',restored) where id=r.id returning * into r;
    return r;
  exception when sqlstate 'P0001' or sqlstate '22023' or sqlstate '23514' then
    update public.raw_inputs set status='parsed',parse_result=jsonb_build_object(
      'command','undo','undone',false,'replacement_conflict',true),lease_token=null,lease_until=null,
      receipt_text=null,receipt_revision=receipt_revision+1,delivered_at=null,reply_attempts=0,reply_next_at=now()
      where id=p_input_id returning * into r;
    return r;
  end;
end;
$$;

revoke all on function public.find_time_replacement_targets(uuid,jsonb),
  public.insert_time_replacement_fragment(uuid,integer,timestamptz,timestamptz,jsonb),
  public.apply_time_replacements(uuid,uuid,jsonb,jsonb,jsonb),public.run_command(uuid,uuid,text),
  public.run_command_before_time_replacements(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.find_time_replacement_targets(uuid,jsonb),
  public.insert_time_replacement_fragment(uuid,integer,timestamptz,timestamptz,jsonb),
  public.apply_time_replacements(uuid,uuid,jsonb,jsonb,jsonb),public.run_command(uuid,uuid,text),
  public.run_command_before_time_replacements(uuid,uuid,text) to service_role;
