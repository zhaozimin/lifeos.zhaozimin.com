-- [INPUT]: 时间账本、WHOOP夜间睡眠对齐、微信纠错与晨间推送队列。
-- [OUTPUT]: 纠错空替换字段容错、昨日时间轴异常巡检、合体晨间推送与系统晨报对话可见性。
-- [POS]: 晨间醒后对账与微信纠错加固迁移；白天零打扰，醒后一次核对并支持按编号回复修正。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

-- ============================================================
-- 1. 加固 apply_time_corrections：剥离空 time_replacements 防白名单拒收
-- ============================================================

create or replace function public.apply_time_corrections(p_input_id uuid,p_lease_token uuid,p_result jsonb,
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
    if coalesce(p_result->'time_replacements','[]'::jsonb)<>'[]'::jsonb then
      raise exception '请将整条记录纠错与区间替换分开发送。' using errcode='22023'; end if;
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
    plan:=p_result-array['time_corrections','time_replacements'];
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

-- ============================================================
-- 2. 昨日时间轴异常巡检（未闭合、睡前截断、超长活动、任意空白、未收尾项）
-- ============================================================

create or replace function public.format_audit_span(
  p_start timestamptz, p_end timestamptz, p_base_day date, p_time_zone text default 'Asia/Shanghai'
) returns text language plpgsql immutable set search_path='' as $$
declare
  s_local timestamp := p_start at time zone p_time_zone;
  e_local timestamp := p_end at time zone p_time_zone;
  s_text text;
  e_text text;
begin
  s_text := case
    when s_local::date = p_base_day then to_char(s_local, 'HH24:MI')
    when s_local::date = p_base_day + 1 then '次日' || to_char(s_local, 'HH24:MI')
    else to_char(s_local, 'MM-DD HH24:MI')
  end;
  if p_end is null then
    return s_text || ' 起';
  end if;
  e_text := case
    when e_local::date = s_local::date then to_char(e_local, 'HH24:MI')
    when e_local::date = p_base_day + 1 then '次日' || to_char(e_local, 'HH24:MI')
    else to_char(e_local, 'MM-DD HH24:MI')
  end;
  return s_text || '–' || e_text;
end;
$$;

create or replace function public.get_morning_time_audit(
  p_owner_id uuid, p_date date, p_time_zone text default 'Asia/Shanghai', p_now timestamptz default now()
) returns jsonb language plpgsql stable set search_path='' as $$
declare
  v_yesterday date := p_date - 1;
  v_yesterday_start timestamptz := v_yesterday::timestamp at time zone p_time_zone;
  v_today_start timestamptz := p_date::timestamp at time zone p_time_zone;
  v_sleep_start timestamptz;
  v_sleep_end timestamptz;
  v_audit_end timestamptz;
  v_items jsonb := '[]'::jsonb;
  v_flagged_ids uuid[] := '{}';
  v_gap_total integer := 0;
  v_gap_limit constant integer := 10;
  rec record;
  v_mins integer;
  v_span text;
  v_limit integer;
  v_reason text;
  v_lines text[] := '{}';
  v_idx integer := 0;
  v_item jsonb;
  v_body text;
begin
  if p_owner_id is null or p_date is null or coalesce(length(btrim(p_time_zone)), 0) = 0 or p_now is null then
    raise exception 'morning audit parameters required' using errcode = '22023';
  end if;

  -- 定位昨夜今晨 WHOOP 夜间主睡眠，覆盖「昨日 00:00 至醒来」的完整闭环窗口。
  select t.start_at, t.end_at
    into v_sleep_start, v_sleep_end
  from public.time_entries t
  join public.raw_inputs r on r.id = t.raw_input_id
  where r.owner_id = p_owner_id and t.deleted_at is null
    and 'whoop-night' = any(t.tags)
    and t.end_at is not null
    and t.end_at > v_yesterday_start + interval '18 hours'
    and t.end_at <= least(p_now, v_today_start + interval '18 hours')
  order by t.end_at desc limit 1;

  v_audit_end := least(p_now, v_today_start + interval '18 hours', greatest(v_today_start, coalesce(v_sleep_end, v_today_start)));

  -- 2.1 昨日或更早开始、至今仍未闭合的进行中记录。
  for rec in
    select t.id, t.start_at, t.activity, c.name as category_name
    from public.time_entries t
    join public.raw_inputs r on r.id = t.raw_input_id
    join public.categories c on c.id = t.category_id
    where r.owner_id = p_owner_id and t.deleted_at is null
      and t.end_at is null and t.start_at < v_today_start
    order by t.start_at, t.id
  loop
    v_flagged_ids := v_flagged_ids || rec.id;
    v_span := public.format_audit_span(rec.start_at, null, v_yesterday, p_time_zone);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'kind', 'unclosed', 'entry_id', rec.id, 'start_at', rec.start_at, 'end_at', null,
      'activity', rec.activity, 'category', rec.category_name,
      'text', '未闭合记录：' || v_span || ' ' || rec.activity || '（仍在进行中）'
    ));
  end loop;

  -- 2.2 睡前未闭合（被 WHOOP 入睡时间截断的原活动，如跨时间洗漱/工作未结束）。
  if v_sleep_start is not null then
    for rec in
      select t.id, t.start_at, t.end_at, t.activity, c.name as category_name
      from public.time_entries t
      join public.raw_inputs r on r.id = t.raw_input_id
      join public.categories c on c.id = t.category_id
      where r.owner_id = p_owner_id and t.deleted_at is null
        and t.end_at is not null
        and 'whoop-boundary-fragment' = any(t.tags)
        and abs(extract(epoch from (t.end_at - v_sleep_start))) <= 60
        and t.id <> all(v_flagged_ids)
      order by t.start_at, t.id
    loop
      v_flagged_ids := v_flagged_ids || rec.id;
      v_mins := greatest(1, round(extract(epoch from (rec.end_at - rec.start_at)) / 60.0)::integer);
      v_span := public.format_audit_span(rec.start_at, rec.end_at, v_yesterday, p_time_zone);
      v_reason := case
        when (rec.start_at at time zone p_time_zone)::date < (rec.end_at at time zone p_time_zone)::date
          then '睡前未闭合（跨夜）'
        else '睡前未闭合'
      end;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'kind', 'pre_sleep_unclosed', 'entry_id', rec.id, 'start_at', rec.start_at, 'end_at', rec.end_at,
        'minutes', v_mins, 'activity', rec.activity, 'category', rec.category_name,
        'text', v_reason || '：' || v_span || ' ' || rec.activity || '（' || v_mins || '分钟，至入睡前未结束）'
      ));
    end loop;
  end if;

  -- 2.3 短活动超常拉长：洗漱 > 35 分钟、洗澡 > 50 分钟、吃饭 > 90 分钟。
  for rec in
    select t.id, t.start_at, t.end_at, t.activity, c.name as category_name,
      extract(epoch from (t.end_at - t.start_at)) as secs
    from public.time_entries t
    join public.raw_inputs r on r.id = t.raw_input_id
    join public.categories c on c.id = t.category_id
    where r.owner_id = p_owner_id and t.deleted_at is null
      and t.end_at is not null
      and t.end_at > v_yesterday_start and t.start_at < v_audit_end
      and t.id <> all(v_flagged_ids)
    order by t.start_at, t.id
  loop
    v_limit := null;
    v_reason := null;
    if rec.activity ~ '(洗澡|淋浴|冲澡|泡澡)' and rec.secs > 50 * 60 then
      v_limit := 50;
      v_reason := '洗澡超过50分钟';
    elsif rec.activity !~ '(洗澡|淋浴|冲澡|泡澡)' and rec.activity ~ '(洗漱|刷牙|洗脸)' and rec.secs > 35 * 60 then
      v_limit := 35;
      v_reason := '洗漱超过35分钟';
    elsif (
      rec.activity ~ '(吃饭|早餐|早饭|午餐|午饭|晚餐|晚饭|宵夜|夜宵|聚餐|干饭|用餐|吃东西)'
      or (rec.category_name = '饮食' and rec.activity !~ '(做饭|买菜|买饭|洗水果|喝水|泡茶|咖啡)')
    ) and rec.secs > 90 * 60 then
      v_limit := 90;
      v_reason := '吃饭超过90分钟';
    end if;

    if v_limit is not null then
      v_flagged_ids := v_flagged_ids || rec.id;
      v_mins := greatest(1, round(rec.secs / 60.0)::integer);
      v_span := public.format_audit_span(rec.start_at, rec.end_at, v_yesterday, p_time_zone);
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'kind', 'overlong_activity', 'entry_id', rec.id, 'start_at', rec.start_at, 'end_at', rec.end_at,
        'minutes', v_mins, 'threshold_minutes', v_limit, 'activity', rec.activity, 'category', rec.category_name,
        'text', '时长偏长：' || v_span || ' ' || rec.activity || '（' || v_mins || '分钟，' || v_reason || '）'
      ));
    end if;
  end loop;

  -- 2.4 时间轴空白或中断：合并覆盖区间后，任意 >= 1 分钟空白均提示。
  if v_audit_end > v_yesterday_start then
    for rec in
      with intervals as (
        select distinct greatest(t.start_at, v_yesterday_start) as s,
          least(coalesce(t.end_at, v_audit_end), v_audit_end) as e
        from public.time_entries t
        join public.raw_inputs r on r.id = t.raw_input_id
        where r.owner_id = p_owner_id and t.deleted_at is null
          and coalesce(t.end_at, v_audit_end) > v_yesterday_start
          and t.start_at < v_audit_end
      ), preceding as (
        select s, e, max(e) over(order by s, e rows between unbounded preceding and 1 preceding) as previous_end
        from intervals
      ), numbered as (
        select s, e, sum(case when previous_end is null or s > previous_end then 1 else 0 end)
          over(order by s, e rows unbounded preceding) as island
        from preceding
      ), merged as (
        select min(s) as s, max(e) as e from numbered group by island
      ), edges as (
        select v_yesterday_start as s, v_yesterday_start as e
        union select s, e from merged
        union select v_audit_end, v_audit_end
      ), adjacent as (
        select s, max(e) over(order by s, e rows between unbounded preceding and 1 preceding) as previous_end
        from edges
      ), gaps as (
        select previous_end as s, s as e,
          floor(extract(epoch from (s - previous_end)) / 60.0)::integer as mins
        from adjacent
        where s - previous_end >= interval '1 minute'
      )
      select s, e, mins, count(*) over()::integer as total_gaps
      from gaps
      order by s limit v_gap_limit
    loop
      v_gap_total := rec.total_gaps;
      v_span := public.format_audit_span(rec.s, rec.e, v_yesterday, p_time_zone);
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'kind', 'gap', 'start_at', rec.s, 'end_at', rec.e, 'minutes', rec.mins,
        'text', '记录空白：' || v_span || '（' || rec.mins || '分钟未记录）'
      ));
    end loop;
  end if;

  -- 2.5 昨日未收尾项：挂起追问、待确认分类与 WHOOP 对齐冲突。
  for rec in
    select r.id, r.received_at, left(regexp_replace(btrim(r.text), '\s+', ' ', 'g'), 24) as snippet
    from public.raw_inputs r
    where r.owner_id = p_owner_id and r.source = 'wechat'
      and r.revoked_at is null and r.status = 'awaiting_clarification'
      and r.received_at >= v_yesterday_start and r.received_at < v_audit_end
    order by r.received_at, r.id limit 5
  loop
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'kind', 'pending_clarification', 'input_id', rec.id, 'received_at', rec.received_at,
      'text', '未处理追问：' || to_char(rec.received_at at time zone p_time_zone, 'HH24:MI') || '「' || rec.snippet || '」'
    ));
  end loop;

  for rec in
    select t.id, t.start_at, t.end_at, t.activity
    from public.time_entries t
    join public.raw_inputs r on r.id = t.raw_input_id
    join public.categories c on c.id = t.category_id
    where r.owner_id = p_owner_id and t.deleted_at is null
      and t.end_at is not null and c.code = 'uncategorized'
      and t.end_at > v_yesterday_start and t.start_at < v_audit_end
      and t.id <> all(v_flagged_ids)
    order by t.start_at, t.id limit 5
  loop
    v_span := public.format_audit_span(rec.start_at, rec.end_at, v_yesterday, p_time_zone);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'kind', 'uncategorized', 'entry_id', rec.id, 'start_at', rec.start_at, 'end_at', rec.end_at,
      'activity', rec.activity,
      'text', '待确认分类：' || v_span || ' ' || rec.activity
    ));
  end loop;

  if exists(
    select 1 from public.time_sleep_alignments a
    where a.owner_id = p_owner_id and a.status = 'conflict'
      and a.updated_at >= v_yesterday_start
  ) then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'kind', 'sleep_conflict',
      'text', '睡眠校准冲突：昨夜 WHOOP 睡眠与人工修改冲突，请在网页核对'
    ));
  end if;

  -- 组装编号文案。
  if jsonb_array_length(v_items) = 0 then
    v_body := '昨日时间轴核对（' || to_char(v_yesterday, 'MM-DD') || '）' || E'\n'
      || '昨日时间轴已完整闭合，无空白或超时异常。';
  else
    v_lines := array['昨日时间轴核对（' || to_char(v_yesterday, 'MM-DD') || '）'];
    for v_item in select value from jsonb_array_elements(v_items) loop
      v_idx := v_idx + 1;
      v_lines := array_append(v_lines, v_idx::text || '. ' || (v_item->>'text'));
    end loop;
    if v_gap_total > v_gap_limit then
      v_lines := array_append(v_lines, '（另有 ' || (v_gap_total - v_gap_limit)::text || ' 处较短空白，可在网页时间轴查看）');
    end if;
    v_lines := array_append(v_lines, '可直接按编号回复实际时段补齐（如「1 是 23:20 洗完后刷手机」）；无误可忽略。');
    v_body := array_to_string(v_lines, E'\n');
  end if;

  return jsonb_build_object(
    'day', v_yesterday,
    'window_start', v_yesterday_start,
    'window_end', v_audit_end,
    'sleep_start', v_sleep_start,
    'sleep_end', v_sleep_end,
    'issue_count', jsonb_array_length(v_items),
    'gaps_truncated', v_gap_total > v_gap_limit,
    'items', v_items,
    'text', v_body
  );
end;
$$;

-- ============================================================
-- 3. 合体晨间推送：WHOOP 今日运动计划 + 昨日时间轴核对（窗口放宽至 16:00）
-- ============================================================

create or replace function public.enqueue_whoop_morning(
  p_owner_id uuid, p_date date, p_time_zone text, p_revision integer, p_text text
) returns jsonb language plpgsql set search_path='' as $$
declare
  local_now timestamp := now() at time zone p_time_zone;
  plan jsonb;
  target jsonb;
  v_audit jsonb;
  v_full_text text;
  result uuid;
begin
  select payload into plan from public.whoop_plans
   where owner_id = p_owner_id and target_date = p_date
     and time_zone = p_time_zone and revision = p_revision;
  if plan is null or plan#>>'{publication,state}' is distinct from 'published' or p_date <> local_now::date
    or local_now::time < coalesce((select value#>>'{settings,reportTime}' from public.whoop_publications
      where owner_id = p_owner_id and key = 'status'), '07:00')::time
    or local_now::time >= '16:00'::time then
    return jsonb_build_object('queued', false, 'reason', 'outside_window_or_waiting');
  end if;
  if length(p_text) not between 1 and 3500 then
    raise exception 'invalid morning receipt' using errcode = '22023';
  end if;
  select payload into target from public.raw_inputs
   where owner_id = p_owner_id and source = 'wechat'
     and payload ? 'from_user_id' and payload ? 'context_token'
     and received_at > now() - interval '24 hours'
   order by received_at desc limit 1;
  if target is null then
    return jsonb_build_object('queued', false, 'reason', 'no_context');
  end if;
  v_audit := public.get_morning_time_audit(p_owner_id, p_date, p_time_zone, now());
  v_full_text := left(p_text || E'\n\n' || (v_audit->>'text'), 3500);
  insert into public.raw_inputs(
    owner_id, source, external_id, text, received_at, payload, input_kind, status,
    parse_result, receipt_text, reply_expires_at
  )
  values(
    p_owner_id, 'system', 'health:morning:' || p_date || ':' || p_time_zone,
    '晨间运动计划与昨日时间核对', now(), target, 'command', 'parsed',
    jsonb_build_object('command', 'health', 'day', p_date, 'revision', p_revision, 'audit', v_audit),
    v_full_text, (p_date + 1)::timestamp at time zone p_time_zone
  )
  on conflict(owner_id, source, external_id) do nothing returning id into result;
  return jsonb_build_object(
    'queued', result is not null,
    'reason', case when result is null then 'already_queued' else 'queued' end,
    'audit_issues', (v_audit->>'issue_count')::integer
  );
end;
$$;

-- ============================================================
-- 4. 对话上下文闭环：微信最近八轮纳入 24h 内已投递的晨间推送
-- ============================================================

create or replace function public.get_recent_dialogue(p_input_id uuid) returns jsonb
language sql stable set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'text', left(x.text, 1000),
  'reply', case when x.source = 'system' then left(x.reply, 1800) else left(x.reply, 1000) end,
  'received_at', x.received_at
) order by x.received_at, x.created_at, x.id), '[]'::jsonb)
from (
  select r.id, r.source, r.text, coalesce(nullif(r.parse_result->>'answer', ''), r.receipt_text) reply, r.received_at, r.created_at
  from public.raw_inputs anchor
  join public.raw_inputs r on r.owner_id = anchor.owner_id
  where anchor.id = p_input_id and r.revoked_at is null and r.status = 'parsed'
    and (
      r.source = anchor.source
      or (
        anchor.source = 'wechat'
        and r.source = 'system'
        and r.external_id like 'health:morning:%'
        and r.delivered_at is not null
        and r.received_at >= anchor.received_at - interval '24 hours'
      )
    )
    and (r.received_at, r.created_at, r.id) < (anchor.received_at, anchor.created_at, anchor.id)
  order by r.received_at desc, r.created_at desc, r.id desc limit 8
) x;
$$;

revoke all on function public.apply_time_corrections(uuid,uuid,jsonb,jsonb,jsonb),
  public.format_audit_span(timestamptz,timestamptz,date,text),
  public.get_morning_time_audit(uuid,date,text,timestamptz),
  public.enqueue_whoop_morning(uuid,date,text,integer,text),
  public.get_recent_dialogue(uuid)
  from public, anon, authenticated;
grant execute on function public.apply_time_corrections(uuid,uuid,jsonb,jsonb,jsonb),
  public.format_audit_span(timestamptz,timestamptz,date,text),
  public.get_morning_time_audit(uuid,date,text,timestamptz),
  public.enqueue_whoop_morning(uuid,date,text,integer,text),
  public.get_recent_dialogue(uuid)
  to service_role;
