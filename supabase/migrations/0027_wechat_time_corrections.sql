-- [INPUT]: 微信原话、时间选择条件、受限补丁和读取时的记录版本。
-- [OUTPUT]: 唯一候选查询、原子纠错与活动切换、前后快照和可撤销修改。
-- [POS]: 微信纠错事务边界；复用时间版本及审计触发器，不放宽网页权限。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

create function public.find_time_correction_targets(p_input_id uuid,p_requests jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare r public.raw_inputs%rowtype; request jsonb; target jsonb; candidates jsonb; result jsonb:='[]';
  day_start timestamptz; day_end timestamptz;
begin
  if jsonb_typeof(p_requests) is distinct from 'array' or jsonb_array_length(p_requests)>10 then
    raise exception 'invalid correction requests' using errcode='22023'; end if;
  if p_requests='[]'::jsonb then return '[]'; end if;
  select * into strict r from public.raw_inputs where id=p_input_id;
  if r.source<>'wechat' then raise exception 'wechat input required' using errcode='22023'; end if;
  for request in select value from jsonb_array_elements(p_requests) loop
    target:=request->'target';
    if jsonb_typeof(request) is distinct from 'object' or request-array['target','patch']<>'{}'
      or jsonb_typeof(target) is distinct from 'object' or target='{}'::jsonb
      or target-array['start_at','end_at','day','activity','position']<>'{}'
      or exists(select 1 from jsonb_each(target) e where jsonb_typeof(e.value)<>'string' or length(btrim(e.value#>>'{}'))=0)
      or (target?'position' and target->>'position' not in ('current','previous')) then
      raise exception 'invalid correction target' using errcode='22023'; end if;
    day_start:=null; day_end:=null;
    if target?'day' or not(target ?| array['start_at','end_at','position']) then
      day_start:=coalesce((target->>'day')::date,(r.received_at at time zone 'Asia/Shanghai')::date)::timestamp at time zone 'Asia/Shanghai';
      day_end:=day_start+interval '1 day';
    end if;
    select coalesce(jsonb_agg(value order by start_at,id),'[]') into candidates from (
      select t.id,t.start_at,jsonb_build_object('id',t.id,'revision',t.revision,'start_at',t.start_at,
        'end_at',t.end_at,'activity',t.activity,'category',c.name) value
      from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
      join public.categories c on c.id=t.category_id
      where i.owner_id=r.owner_id and t.deleted_at is null
        and (not(target?'start_at') or t.start_at=(target->>'start_at')::timestamptz)
        and (not(target?'end_at') or t.end_at=(target->>'end_at')::timestamptz
          or (t.end_at is null and target?'start_at' and t.start_at=(target->>'start_at')::timestamptz
            and (target->>'end_at')::timestamptz>t.start_at
            and (target->>'end_at')::timestamptz<=r.received_at+interval '1 minute'))
        and (not(target?'activity') or position(lower(target->>'activity') in lower(t.activity))>0)
        and (day_start is null or (t.start_at<day_end and coalesce(t.end_at,'infinity')>day_start))
        and (not(target?'position') or (target->>'position'='current' and t.end_at is null)
          or (target->>'position'='previous' and t.end_at=(select max(x.end_at)
            from public.time_entries x join public.raw_inputs j on j.id=x.raw_input_id
            where j.owner_id=r.owner_id and x.deleted_at is null and x.end_at<=r.received_at
              and (day_start is null or (x.start_at<day_end and x.end_at>day_start))
              and (not(target?'activity') or position(lower(target->>'activity') in lower(x.activity))>0))))
      order by t.start_at,t.id limit 6
    ) matches;
    result:=result||jsonb_build_array(jsonb_build_object('matches',candidates,'count',jsonb_array_length(candidates)));
  end loop;
  return result;
end;
$$;

create function public.apply_time_corrections(p_input_id uuid,p_lease_token uuid,p_result jsonb,
  p_expected_targets jsonb,p_expected_ongoing jsonb default null)
returns public.raw_inputs language plpgsql set search_path='' as $$
declare r public.raw_inputs%rowtype; targets jsonb; request jsonb; match jsonb; patch jsonb; changes jsonb:='[]';
  before_row public.time_entries%rowtype; after_row public.time_entries%rowtype;
  before_data jsonb; category smallint; category_name text; position_index integer:=0;
  seen uuid[]:='{}'; question text; details text; plan jsonb;
begin
  select * into strict r from public.raw_inputs where id=p_input_id for update;
  if r.revoked_at is not null or r.status in ('parsed','ignored') then return r; end if;
  if r.source<>'wechat' or r.lease_token is null or r.lease_token is distinct from p_lease_token then
    raise exception 'invalid correction lease' using errcode='55000'; end if;
  begin
    if jsonb_typeof(p_result->'time_corrections') is distinct from 'array'
      or jsonb_array_length(p_result->'time_corrections') not between 1 and 10
      or nullif(p_result->>'clarify','') is not null then
      raise exception 'invalid correction plan' using errcode='22023'; end if;
    lock table public.time_entries in share row exclusive mode;
    targets:=public.find_time_correction_targets(r.id,p_result->'time_corrections');
    if (jsonb_array_length(coalesce(p_result->'time_entries','[]'))>0
      or jsonb_array_length(coalesce(p_result->'time_events','[]'))>0)
      and p_expected_ongoing is not null
      and public.get_steward_context(r.owner_id)->'ongoing' is distinct from p_expected_ongoing then
      raise exception '进行中活动刚刚发生变化，请重发这次纠错和切换的钟点。' using errcode='P0001'; end if;
    for request in select value from jsonb_array_elements(p_result->'time_corrections') loop
      if (targets->position_index->>'count')::integer=0 then
        raise exception '没有找到对应时间记录，请补充日期、原起止时间或原活动名称。' using errcode='P0001'; end if;
      if (targets->position_index->>'count')::integer>1 then
        select string_agg(to_char((x->>'start_at')::timestamptz at time zone 'Asia/Shanghai','MM-DD HH24:MI')||' '||(x->>'activity'),'；')
          into details from jsonb_array_elements(targets->position_index->'matches') x;
        raise exception '找到多条记录：%。请指出要修改的日期和原起止时间。',details using errcode='P0001'; end if;
      match:=targets->position_index->'matches'->0;
      if p_expected_targets is null or p_expected_targets->position_index->'matches'->0 is distinct from match then
        raise exception '这条时间记录刚刚发生变化，请重发要修改的原时段和新内容。' using errcode='P0001'; end if;
      if (match->>'id')::uuid=any(seen) then
        raise exception '同一条时间记录被重复修改，请合成一次修改。' using errcode='P0001'; end if;
      seen:=seen||array[(match->>'id')::uuid];
      patch:=request->'patch';
      if jsonb_typeof(patch) is distinct from 'object' or patch='{}'::jsonb
        or patch-array['start_at','end_at','activity','category','note']<>'{}'
        or exists(select 1 from jsonb_each(patch) e where jsonb_typeof(e.value) not in ('string','null')
          or (e.key not in ('end_at','note') and e.value='null'::jsonb))
        or (patch?'activity' and not(patch?'category')) then
        raise exception 'invalid correction patch' using errcode='22023'; end if;
      select * into strict before_row from public.time_entries where id=(match->>'id')::uuid for update;
      select name into category_name from public.categories where id=before_row.category_id;
      before_data:=to_jsonb(before_row)||jsonb_build_object('category',category_name);
      -- 明确指定当前整段的终点时封口；后续切换仍由原执行器创建新活动。
      if before_row.end_at is null and request->'target'?'end_at' and not(patch?'end_at') then
        patch:=patch||jsonb_build_object('end_at',request->'target'->>'end_at'); end if;
      category:=before_row.category_id;
      if patch?'category' then
        select id into category from public.categories where owner_id=r.owner_id and kind='time'
          and is_active and code=patch->>'category';
        if category is null then raise exception '请选择已有的时间分类。' using errcode='P0001'; end if;
      end if;
      after_row:=jsonb_populate_record(before_row,patch-'category');
      if length(btrim(after_row.activity)) not between 1 and 500 or (patch?'note' and length(coalesce(after_row.note,''))>500)
        or after_row.start_at is null or after_row.start_at>r.received_at+interval '1 minute'
        or after_row.end_at>r.received_at+interval '1 minute'
        or after_row.end_at<=after_row.start_at then
        raise exception '请提供已发生的有效起止时间，结束时间须晚于开始时间。' using errcode='P0001'; end if;
      update public.time_entries set start_at=after_row.start_at,end_at=after_row.end_at,
        activity=after_row.activity,category_id=category,note=after_row.note,
        tags=case when patch?'activity' and after_row.activity!~'(睡觉|睡眠|午睡|午觉|补觉|打盹|入睡)'
          then array_remove(before_row.tags,'whoop-pending') else before_row.tags end
        where id=before_row.id;
      changes:=changes||jsonb_build_array(jsonb_build_object('id',before_row.id,'before',before_data));
      position_index:=position_index+1;
    end loop;
    if exists(select 1 from public.time_entries t join public.time_entries x on t.id<>x.id
      join public.raw_inputs i on i.id=x.raw_input_id where t.id=any(seen) and t.deleted_at is null
      and x.deleted_at is null and i.owner_id=r.owner_id and t.start_at<coalesce(x.end_at,'infinity')
      and coalesce(t.end_at,'infinity')>x.start_at) then
      raise exception '修改后的时间与另一条记录重叠，请说明两段正确的起止时间。' using errcode='P0001'; end if;
    plan:=p_result-'time_corrections';
    select * into r from public.apply_steward(r.id,p_lease_token,plan,public.get_steward_context(r.owner_id)->'ongoing');
    if r.status<>'parsed' then
      raise exception '%',coalesce(r.clarification_prompt,'后续记录没有通过校验，本次修改未提交。') using errcode='P0001'; end if;
    select jsonb_agg(value||jsonb_build_object('after',to_jsonb(t)||jsonb_build_object('category',c.name))) into changes
      from jsonb_array_elements(changes) value join public.time_entries t on t.id=(value->>'id')::uuid
      join public.categories c on c.id=t.category_id;
    update public.raw_inputs set parse_result=r.parse_result||jsonb_build_object('_time_corrections',changes)
      where id=r.id returning * into r;
    return r;
  exception when sqlstate 'P0001' or sqlstate '22023' or sqlstate '22007' or sqlstate '22008' or sqlstate '23514' then
    get stacked diagnostics question=message_text;
  end;
  select * into r from public.apply_steward(p_input_id,p_lease_token,jsonb_build_object(
    'time_entries','[]'::jsonb,'transactions','[]'::jsonb,'clarify',question));
  update public.raw_inputs set parse_result=r.parse_result||jsonb_build_object(
    '_pending_time_corrections',p_result->'time_corrections') where id=r.id returning * into r;
  return r;
end;
$$;

alter function public.claim_next_input(uuid,boolean) rename to claim_next_input_before_time_corrections;
create function public.claim_next_input(p_owner_id uuid,p_records_enabled boolean)
returns setof public.raw_inputs language plpgsql set search_path='' as $$
declare r public.raw_inputs%rowtype; waiting public.raw_inputs%rowtype;
begin
  select * into r from public.claim_next_input_before_time_corrections(p_owner_id,p_records_enabled);
  if r.id is null then return; end if;
  -- 只把日期、钟点短答交还给纠错追问，新活动仍走独立消息。
  if r.input_kind='record' and r.status='pending' and r.attempts=1 and r.parse_result is null
    and r.clarification_for is null and r.reply_input_id is null and length(btrim(r.text))<=100
    and (btrim(r.text) in ('今天','昨天','前天','上一段','当前这段','当前这条')
      or (btrim(r.text)~'^[0-9零一二三四五六七八九十两年月日号今天昨前到至点分半:：/ .~～—-]+(那(一)?(条|段))?[。！!]?\s*$'
        and btrim(r.text)~'([:：][0-9]{2}|点|[0-9]{1,2}月|[0-9]{4}-[0-9]{2}-)')) then
    select * into waiting from public.raw_inputs where owner_id=p_owner_id and source=r.source
      and status='awaiting_clarification' and revoked_at is null and id<>r.id
      and parse_result?'_pending_time_corrections' and received_at<=r.received_at
      and received_at>=r.received_at-interval '30 minutes'
      order by received_at desc for update skip locked limit 1;
    if waiting.id is not null then
      update public.raw_inputs set status='ignored',clarification_for=waiting.id,lease_token=null,lease_until=null where id=r.id;
      update public.raw_inputs set status='pending',reply_input_id=r.id,receipt_text=null,delivered_at=null,
        lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',attempts=1,next_attempt_at=now()
        where id=waiting.id returning * into r;
    end if;
  end if;
  return next r;
end;
$$;

alter function public.run_command(uuid,uuid,text) rename to run_command_before_time_corrections;
create function public.run_command(p_input_id uuid,p_lease_token uuid,p_command text)
returns public.raw_inputs language plpgsql set search_path='' as $$
declare r public.raw_inputs%rowtype; target public.raw_inputs%rowtype; change jsonb;
  before_row public.time_entries%rowtype; seen uuid[]:='{}'; restored integer:=0;
begin
  if p_command<>'undo' then return public.run_command_before_time_corrections(p_input_id,p_lease_token,p_command); end if;
  select * into strict r from public.raw_inputs where id=p_input_id for update;
  if r.status='parsed' or r.revoked_at is not null then return r; end if;
  if r.input_kind<>'command' or r.lease_token is null or r.lease_token is distinct from p_lease_token then
    raise exception 'invalid command lease' using errcode='55000'; end if;
  lock table public.time_entries in share row exclusive mode;
  select * into target from public.raw_inputs where owner_id=r.owner_id and input_kind='record'
    and revoked_at is null and status<>'ignored' and received_at<=r.received_at and id<>r.id
    order by received_at desc,created_at desc for update limit 1;
  if coalesce(jsonb_array_length(target.parse_result->'_time_corrections'),0)=0 then
    return public.run_command_before_time_corrections(p_input_id,p_lease_token,p_command); end if;
  begin
    for change in select value from jsonb_array_elements(target.parse_result->'_time_corrections') loop
      if not exists(select 1 from public.time_entries where id=(change->>'id')::uuid
        and deleted_at is null and revision=(change->'after'->>'revision')::bigint) then
        raise exception 'correction changed' using errcode='P0001'; end if;
    end loop;
    select * into r from public.run_command_before_time_corrections(p_input_id,p_lease_token,p_command);
    for change in select value from jsonb_array_elements(target.parse_result->'_time_corrections') loop
      before_row:=jsonb_populate_record(null::public.time_entries,change->'before');
      update public.time_entries set start_at=before_row.start_at,end_at=before_row.end_at,
        activity=before_row.activity,category_id=before_row.category_id,note=before_row.note,tags=before_row.tags
        where id=before_row.id;
      seen:=seen||array[before_row.id]; restored:=restored+1;
    end loop;
    if exists(select 1 from public.time_entries t join public.time_entries x on t.id<>x.id
      join public.raw_inputs i on i.id=x.raw_input_id where t.id=any(seen) and t.deleted_at is null
      and x.deleted_at is null and i.owner_id=r.owner_id and t.start_at<coalesce(x.end_at,'infinity')
      and coalesce(t.end_at,'infinity')>x.start_at) then
      raise exception 'undo overlap' using errcode='P0001'; end if;
    update public.raw_inputs set parse_result=r.parse_result||jsonb_build_object('restored_corrections',restored)
      where id=r.id returning * into r;
    return r;
  exception when sqlstate 'P0001' or sqlstate '22023' or sqlstate '23514' then
    update public.raw_inputs set status='parsed',parse_result=jsonb_build_object(
      'command','undo','undone',false,'correction_conflict',true),lease_token=null,lease_until=null,
      receipt_text=null,receipt_revision=receipt_revision+1,delivered_at=null,reply_attempts=0,reply_next_at=now()
      where id=p_input_id returning * into r;
    return r;
  end;
end;
$$;

revoke all on function public.find_time_correction_targets(uuid,jsonb),
  public.apply_time_corrections(uuid,uuid,jsonb,jsonb,jsonb),public.run_command(uuid,uuid,text),
  public.run_command_before_time_corrections(uuid,uuid,text),public.claim_next_input(uuid,boolean),
  public.claim_next_input_before_time_corrections(uuid,boolean) from public,anon,authenticated;
grant execute on function public.find_time_correction_targets(uuid,jsonb),
  public.apply_time_corrections(uuid,uuid,jsonb,jsonb,jsonb),public.run_command(uuid,uuid,text),
  public.run_command_before_time_corrections(uuid,uuid,text),public.claim_next_input(uuid,boolean),
  public.claim_next_input_before_time_corrections(uuid,boolean) to service_role;
