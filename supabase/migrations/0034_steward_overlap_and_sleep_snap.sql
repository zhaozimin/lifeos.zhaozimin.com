-- [INPUT]: 微信管家执行器、区间替换执行器与WHOOP评分睡眠边界。
-- [OUTPUT]: 同活动闭合去重防伪重叠、区间替换60秒WHOOP睡眠边界吸附。
-- [POS]: 解决「XX完毕，切换YY」重复输出当前段报重叠，以及历史修改因分钟取整擦碰WHOOP睡眠秒级边界被拒的问题。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

-- ============================================================
-- 1. 微信计时闭合防伪重叠：模型重复输出当前进行中同活动时原地闭合去重
-- ============================================================

create or replace function public.apply_steward_records_before_groups(
  p_input_id uuid, p_lease_token uuid, p_result jsonb, p_expected_ongoing jsonb default null
) returns public.raw_inputs language plpgsql set search_path='' as $$
declare r public.raw_inputs%rowtype; previous public.time_entries%rowtype;
  entry jsonb; event jsonb; account_name text; facts text; boundary timestamptz;
  category smallint; rest_category smallint; open_count integer; new_id uuid; rest_id uuid; new_revision bigint;
  context_ids jsonb:='[]'; effects jsonb:='[]'; stopped timestamptz;
  plan jsonb; question text; entry_index integer; first_start timestamptz; close_at timestamptz;
  v_entries jsonb; v_effective_result jsonb; v_dup_ord integer; v_dup_end timestamptz;
begin
  select * into strict r from public.raw_inputs where id=p_input_id for update;
  if r.revoked_at is not null or r.status in ('parsed','ignored') then return r; end if;
  if r.lease_token is null or r.lease_token is distinct from p_lease_token then
    raise exception 'input lease changed' using errcode='55000'; end if;
  if jsonb_typeof(p_result) is distinct from 'object'
    or p_result-array['time_entries','transactions','time_events','archive_kind','unsupported','clarify']<>'{}'
    or jsonb_typeof(p_result->'time_entries') is distinct from 'array'
    or jsonb_typeof(p_result->'transactions') is distinct from 'array'
    or jsonb_typeof(coalesce(p_result->'time_events','[]')) is distinct from 'array'
    or jsonb_array_length(coalesce(p_result->'time_events','[]'))>1
    or jsonb_array_length(p_result->'transactions')>50 then
    raise exception 'invalid steward plan' using errcode='22023'; end if;
  if nullif(p_result->>'archive_kind','') is not null
    and p_result->>'archive_kind' not in ('inspiration','diary','emotion','raw') then
    raise exception 'invalid archive kind' using errcode='22023'; end if;
  if nullif(p_result->>'unsupported','') is not null and p_result->>'unsupported' not in
    ('correction','transfer','foreign_currency','recurring','knowledge','schedule','history_query','obsidian_binding','other') then
    raise exception 'invalid unsupported reason' using errcode='22023'; end if;
  if nullif(p_result->>'clarify','') is not null and
    jsonb_array_length(coalesce(p_result->'time_events','[]'))+
    jsonb_array_length(p_result->'transactions')+jsonb_array_length(p_result->'time_entries')>0 then
    raise exception 'clarification conflicts with event' using errcode='22023'; end if;
  facts:=r.text||E'\n'||coalesce((select string_agg(text,E'\n' order by received_at)
    from public.raw_inputs where clarification_for=r.id and owner_id=r.owner_id),'');
  v_entries:=p_result->'time_entries';
  v_effective_result:=p_result;
  -- 业务拒绝回滚整条计划，再沿用原事务发出一个追问。
  begin
    for entry in select value from jsonb_array_elements(p_result->'transactions') loop
      if entry->>'currency' is distinct from 'CNY' then
        raise exception '目前只记人民币，请折算后报数。' using errcode='P0001'; end if;
      if entry->>'direction' not in ('expense','income') or
        (entry->>'amount_cents')::bigint<=0 then
        raise exception 'invalid money record' using errcode='22023'; end if;
      account_name:=nullif(trim(entry->>'funding_account'),'');
      if account_name is null or not exists(select 1 from public.local_records
        where owner_id=r.owner_id and kind='account' and deleted_at is null and data->>'name'=account_name)
        or position(account_name in facts)=0 then
        raise exception '这笔收支使用哪个资金账户？请告诉我网页中的账户名。' using errcode='P0001'; end if;
      if exists(select 1 from public.transactions t join public.raw_inputs i on i.id=t.raw_input_id
        where i.owner_id=r.owner_id and t.deleted_at is null and t.direction=entry->>'direction'
          and t.amount_cents=(entry->>'amount_cents')::bigint
          and coalesce(t.from_account,t.to_account)=account_name
          and coalesce(t.note,'')=coalesce(entry->>'note','')
          and abs(extract(epoch from(i.received_at-r.received_at)))<=90
          and abs(extract(epoch from(t.occurred_at-(entry->>'occurred_at')::timestamptz)))<=90)
        and facts!~'(另外一笔|另一笔|确实两笔)'
        and not (coalesce(r.clarification_prompt,'') like '90秒内%' and exists(
          select 1 from public.raw_inputs where clarification_for=r.id and owner_id=r.owner_id
            and trim(text)~'^(是|是的|对|确认|yes)[。！!]?\s*$')) then
        raise exception '90秒内已有一笔相同收支，这次是另外一笔吗？' using errcode='P0001'; end if;
    end loop;
    if jsonb_array_length(v_entries)>0 or
      jsonb_array_length(coalesce(p_result->'time_events','[]'))>0 then
      -- 单人账本短事务串行化，防止网页补录与切换竞态。
      lock table public.time_entries in share row exclusive mode;
    end if;
    if jsonb_array_length(v_entries)>0 or jsonb_array_length(coalesce(p_result->'time_events','[]'))>0 then
      select count(*) into open_count from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
        where i.owner_id=r.owner_id and t.deleted_at is null and t.end_at is null;
      if p_expected_ongoing is not null and (open_count<>jsonb_array_length(p_expected_ongoing) or exists(
        select 1 from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
        where i.owner_id=r.owner_id and t.deleted_at is null and t.end_at is null and not exists(
          select 1 from jsonb_array_elements(p_expected_ongoing) e
          where (e->>'id')::uuid=t.id and (e->>'revision')::bigint=t.revision))) then
        raise exception '网页中的进行中活动已改变，请确认现在开始或结束的活动与钟点。' using errcode='P0001'; end if;
      if open_count>1 then
        raise exception '已有多项进行中活动，请先在网页核对后再切换。' using errcode='P0001'; end if;

      select min((e->>'start_at')::timestamptz) into first_start
        from jsonb_array_elements(v_entries) e;
      select t.* into previous from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
        where i.owner_id=r.owner_id and t.deleted_at is null and t.end_at is null for update of t;

      -- 情况 A：模型重复把当前进行中的同活动写进了 time_entries（如「22:56 洗漱完毕，休息」）。
      -- 原地按该段终点闭合旧计时并移除重复条目，避免自碰撞报「重叠」。
      if previous.id is not null and first_start = previous.start_at then
        select ord::integer, (e->>'end_at')::timestamptz
          into v_dup_ord, v_dup_end
        from jsonb_array_elements(v_entries) with ordinality as x(e, ord)
        where (e->>'start_at')::timestamptz = previous.start_at
          and btrim(coalesce(e->>'activity', '')) = btrim(coalesce(previous.activity, ''))
          and (e->>'end_at')::timestamptz > previous.start_at
          and (e->>'end_at')::timestamptz <= r.received_at + interval '1 minute'
        order by ord limit 1;

        if v_dup_ord is not null and not exists(
          select 1 from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
          where i.owner_id=r.owner_id and t.deleted_at is null and t.id<>previous.id
            and t.start_at < v_dup_end and coalesce(t.end_at,'infinity'::timestamptz) > previous.start_at
        ) then
          if public.is_toilet_activity(previous.activity) and not public.has_explicit_toilet_end(facts)
            and v_dup_end > previous.start_at + interval '10 minutes' then
            close_at := previous.start_at + interval '10 minutes';
            rest_category := public.resolve_rest_category(r.owner_id);
            update public.time_entries set end_at=close_at where id=previous.id returning revision into new_revision;
            effects := jsonb_build_array(jsonb_build_object('id',previous.id,'revision',new_revision,'end_at',close_at));
            context_ids := context_ids || jsonb_build_array(previous.id);
            if rest_category is not null then
              insert into public.time_entries(raw_input_id,item_index,start_at,end_at,category_id,activity,tags,note)
                values(r.id,51,close_at,v_dup_end,rest_category,'休息',array['toilet-auto-rest'],
                  '按本人规则推定：上厕所超过10分钟未点结束，10分钟后自动转为休息。') returning id into rest_id;
              context_ids := context_ids || jsonb_build_array(rest_id);
            end if;
          else
            update public.time_entries set end_at=v_dup_end where id=previous.id returning revision into new_revision;
            effects := jsonb_build_array(jsonb_build_object('id',previous.id,'revision',new_revision,'end_at',v_dup_end));
            context_ids := context_ids || jsonb_build_array(previous.id);
          end if;
          select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) into v_entries
            from jsonb_array_elements(v_entries) with ordinality as x(e, ord)
            where ord::integer <> v_dup_ord;
          v_effective_result := jsonb_set(p_result, '{time_entries}', v_entries);
        end if;
      -- 情况 B：新时段起点晚于旧计时起点，先在首个新时段起点闭合旧计时。
      elsif previous.id is not null and first_start > previous.start_at then
        if public.is_toilet_activity(previous.activity) and not public.has_explicit_toilet_end(facts)
          and first_start > previous.start_at + interval '10 minutes'
          and not exists(select 1 from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
            where i.owner_id=r.owner_id and t.deleted_at is null and t.id<>previous.id
              and t.start_at < first_start and coalesce(t.end_at,'infinity'::timestamptz) > previous.start_at) then
          close_at := previous.start_at + interval '10 minutes';
          rest_category := public.resolve_rest_category(r.owner_id);
          update public.time_entries set end_at=close_at where id=previous.id returning revision into new_revision;
          effects := jsonb_build_array(jsonb_build_object('id',previous.id,'revision',new_revision,'end_at',close_at));
          context_ids := context_ids || jsonb_build_array(previous.id);
          if rest_category is not null then
            insert into public.time_entries(raw_input_id,item_index,start_at,end_at,category_id,activity,tags,note)
              values(r.id,51,close_at,first_start,rest_category,'休息',array['toilet-auto-rest'],
                '按本人规则推定：上厕所超过10分钟未点结束，10分钟后自动转为休息。') returning id into rest_id;
            context_ids := context_ids || jsonb_build_array(rest_id);
          end if;
        else
          update public.time_entries set end_at=first_start where id=previous.id returning revision into new_revision;
          effects := jsonb_build_array(jsonb_build_object('id',previous.id,'revision',new_revision,'end_at',first_start));
          context_ids := context_ids || jsonb_build_array(previous.id);
        end if;
      end if;
    end if;

    for entry in select value from jsonb_array_elements(v_entries) loop
      if exists(select 1 from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
        where i.owner_id=r.owner_id and t.deleted_at is null and
        t.start_at<(entry->>'end_at')::timestamptz and
        coalesce(t.end_at,'infinity'::timestamptz)>(entry->>'start_at')::timestamptz) then
        raise exception '这段时间与已有记录重叠，请先在网页核对或修改对应记录。' using errcode='P0001'; end if;
    end loop;
    select * into r from public.apply_parse(p_input_id,p_lease_token,
      v_effective_result||jsonb_build_object('transactions','[]'::jsonb));
    -- 真实资金账户决定余额方向；支付渠道仍独立保留。
    for entry,entry_index in select value,ordinality::integer-1 from
      jsonb_array_elements(p_result->'transactions') with ordinality loop
      select id into category from public.categories where owner_id=r.owner_id and kind='money'
        and is_active and code=entry->>'category';
      if category is null then raise exception 'invalid money category' using errcode='23514'; end if;
      insert into public.transactions(raw_input_id,item_index,occurred_at,direction,amount_cents,currency,
        category_id,account,merchant,note,from_account,to_account,details)
      values(r.id,entry_index,(entry->>'occurred_at')::timestamptz,entry->>'direction',
        (entry->>'amount_cents')::bigint,'CNY',category,entry->>'funding_account',entry->>'merchant',entry->>'note',
        case when entry->>'direction'='expense' then entry->>'funding_account' end,
        case when entry->>'direction'='income' then entry->>'funding_account' end,
        jsonb_build_object('payment_method',entry->>'account'));
    end loop;
    if exists(select 1 from public.time_entries t join public.time_entries x on t.id<>x.id
      join public.raw_inputs i on i.id=x.raw_input_id where t.raw_input_id=r.id
        and t.deleted_at is null and x.deleted_at is null and i.owner_id=r.owner_id
        and t.start_at<coalesce(x.end_at,'infinity'::timestamptz)
        and coalesce(t.end_at,'infinity'::timestamptz)>x.start_at) then
      raise exception '这条消息中的时间段互相重叠，请确认各段起止。' using errcode='P0001'; end if;
    for event in select value from jsonb_array_elements(coalesce(p_result->'time_events','[]')) loop
      if event->>'action' not in ('switch','stop') then
        raise exception 'invalid time action' using errcode='22023'; end if;
      boundary:=(event->>'at')::timestamptz;
      if boundary is null or boundary>r.received_at+interval '1 minute' then
        raise exception '请确认这项活动的实际开始或结束时间。' using errcode='P0001'; end if;
      previous:=null;
      select t.* into previous from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
        where i.owner_id=r.owner_id and t.deleted_at is null and t.end_at is null for update of t;
      if event->>'action'='switch' then
        select id into category from public.categories where owner_id=r.owner_id and kind='time'
          and code=event->>'category' and is_active;
        if category is null or coalesce(length(trim(event->>'activity')),0)=0 then
          raise exception 'invalid switch category or activity' using errcode='22023'; end if;
        if previous.id is not null and previous.category_id=category and previous.activity=event->>'activity' then
          if boundary<previous.start_at then
            raise exception '切换时间早于当前活动起点，请确认钟点。' using errcode='P0001'; end if;
          context_ids:=context_ids||jsonb_build_array(previous.id); continue;
        end if;
      elsif event->>'category' is not null or event->>'activity' is not null then
        raise exception 'stop cannot open activity' using errcode='22023'; end if;
      if previous.id is not null then
        if boundary<=previous.start_at then
          raise exception '这个钟点未晚于当前活动起点，请确认实际钟点；误记请发“撤销”。' using errcode='P0001'; end if;
        if exists(select 1 from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
          where i.owner_id=r.owner_id and t.deleted_at is null and t.id<>previous.id and
          t.start_at<boundary and coalesce(t.end_at,'infinity'::timestamptz)>previous.start_at) then
          raise exception '当前活动与已有记录重叠，请先在网页核对结束点。' using errcode='P0001'; end if;
        if public.is_toilet_activity(previous.activity) and not public.has_explicit_toilet_end(facts)
          and boundary>previous.start_at+interval '10 minutes' then
          close_at:=previous.start_at+interval '10 minutes';
          rest_category:=public.resolve_rest_category(r.owner_id);
          update public.time_entries set end_at=close_at where id=previous.id returning revision into new_revision;
          effects:=effects||jsonb_build_array(jsonb_build_object('id',previous.id,'revision',new_revision,'end_at',close_at));
          context_ids:=context_ids||jsonb_build_array(previous.id);
          if rest_category is not null then
            insert into public.time_entries(raw_input_id,item_index,start_at,end_at,category_id,activity,tags,note)
              values(r.id,51,close_at,boundary,rest_category,'休息',array['toilet-auto-rest'],
                '按本人规则推定：上厕所超过10分钟未点结束，10分钟后自动转为休息。') returning id into rest_id;
            context_ids:=context_ids||jsonb_build_array(rest_id);
          end if;
        else
          update public.time_entries set end_at=boundary where id=previous.id returning revision into new_revision;
          effects:=effects||jsonb_build_array(jsonb_build_object('id',previous.id,'revision',new_revision,'end_at',boundary));
          context_ids:=context_ids||jsonb_build_array(previous.id);
        end if;
      end if;
      if event->>'action'='switch' then
        if exists(select 1 from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
          where i.owner_id=r.owner_id and t.deleted_at is null and
          coalesce(t.end_at,'infinity'::timestamptz)>boundary) then
          raise exception '新活动起点与已有记录重叠，请确认实际钟点。' using errcode='P0001'; end if;
        insert into public.time_entries(raw_input_id,item_index,start_at,category_id,activity,note)
          values(r.id,50,boundary,category,event->>'activity',event->>'note') returning id into new_id;
        context_ids:=context_ids||jsonb_build_array(new_id);
      else stopped:=boundary;
      end if;
    end loop;
    -- 标签只索引原话，不复制或改写笔记正文。
    plan:=v_effective_result||jsonb_build_object('_time_effects',effects,'_time_context_ids',context_ids,'_stopped_at',stopped);
    update public.raw_inputs set parse_result=plan,
      status=case when r.status='ignored' then 'parsed'::public.input_status else r.status end
      where id=r.id returning * into r;
    return r;
  exception when sqlstate 'P0001' then
    get stacked diagnostics question=message_text;
  end;
  return public.apply_parse(p_input_id,p_lease_token,
    jsonb_build_object('time_entries','[]'::jsonb,'transactions','[]'::jsonb,'clarify',question));
end;
$$;

-- ============================================================
-- 2. 区间替换 60 秒 WHOOP 睡眠边界吸附：避免分钟取整误撞睡眠真源或留秒级残渣
-- ============================================================

create or replace function public.snap_time_replacement_requests(
  p_owner_id uuid, p_requests jsonb, p_received_at timestamptz
) returns jsonb language plpgsql stable set search_path='' as $$
declare
  req jsonb;
  snapped jsonb := '[]'::jsonb;
  first_at timestamptz;
  last_at timestamptz;
  cand timestamptz;
begin
  if jsonb_typeof(p_requests) is distinct from 'array' then return p_requests; end if;
  for req in select value from jsonb_array_elements(p_requests) loop
    first_at := (req->>'start_at')::timestamptz;
    last_at := (req->>'end_at')::timestamptz;

    -- 终点紧邻 WHOOP 评分睡眠起点（< 60 秒）时，自动吸附到睡眠精确起点。
    select t.start_at into cand
    from public.time_entries t
    join public.raw_inputs i on i.id = t.raw_input_id
    where i.owner_id = p_owner_id and t.deleted_at is null
      and ((i.source = 'whoop' and t.item_index = 0) or 'whoop-sleep' = any(t.tags))
      and abs(extract(epoch from (last_at - t.start_at))) < 60
      and t.start_at > first_at
      and t.start_at <= p_received_at + interval '1 minute'
      and t.start_at - first_at <= interval '24 hours'
    order by abs(extract(epoch from (last_at - t.start_at))) limit 1;
    if cand is not null then
      last_at := cand;
    end if;

    -- 起点紧邻 WHOOP 评分睡眠终点（< 60 秒）时，自动吸附到睡眠精确终点。
    cand := null;
    select t.end_at into cand
    from public.time_entries t
    join public.raw_inputs i on i.id = t.raw_input_id
    where i.owner_id = p_owner_id and t.deleted_at is null
      and t.end_at is not null
      and ((i.source = 'whoop' and t.item_index = 0) or 'whoop-sleep' = any(t.tags))
      and abs(extract(epoch from (first_at - t.end_at))) < 60
      and t.end_at < last_at
      and last_at - t.end_at <= interval '24 hours'
    order by abs(extract(epoch from (first_at - t.end_at))) limit 1;
    if cand is not null then
      first_at := cand;
    end if;

    snapped := snapped || jsonb_build_array(
      req || jsonb_build_object('start_at', first_at, 'end_at', last_at)
    );
  end loop;
  return snapped;
end;
$$;

create or replace function public.find_time_replacement_targets(p_input_id uuid,p_requests jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare r public.raw_inputs%rowtype; request jsonb; first_at timestamptz; last_at timestamptz;
  snapped jsonb; targets jsonb;
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
  snapped := public.snap_time_replacement_requests(r.owner_id, p_requests, r.received_at);
  select coalesce(jsonb_agg(value order by start_at,id),'[]') into targets from (
    select t.id,t.start_at,to_jsonb(t)||jsonb_build_object('category',c.name,'source',i.source) value
    from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
    join public.categories c on c.id=t.category_id
    where i.owner_id=r.owner_id and t.deleted_at is null and exists(
      select 1 from jsonb_array_elements(snapped) x
      where t.start_at<(x->>'end_at')::timestamptz and coalesce(t.end_at,'infinity')>(x->>'start_at')::timestamptz)
    order by t.start_at,t.id limit 51
  ) matching;
  return targets;
end;
$$;

create or replace function public.apply_time_replacements(p_input_id uuid,p_lease_token uuid,p_result jsonb,
  p_expected_targets jsonb,p_expected_ongoing jsonb default null)
returns public.raw_inputs language plpgsql set search_path='' as $$
declare r public.raw_inputs%rowtype; requests jsonb; snapped jsonb; targets jsonb; request jsonb; original jsonb;
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
    snapped:=public.snap_time_replacement_requests(r.owner_id,requests,r.received_at);
    if targets is distinct from p_expected_targets
      or (p_expected_ongoing is not null and public.get_steward_context(r.owner_id)->'ongoing' is distinct from p_expected_ongoing) then
      raise exception '时间记录刚刚发生变化，请重发日期、时段和活动，我会按最新记录调整。' using errcode='P0001'; end if;
    if jsonb_array_length(targets)>50 then
      raise exception '本次涉及超过50条记录，请缩短时段后重发。' using errcode='P0001'; end if;
    if exists(select 1 from jsonb_array_elements(snapped) with ordinality a(value,n)
      join jsonb_array_elements(snapped) with ordinality b(value,n) on a.n<b.n
      where (a.value->>'start_at')::timestamptz<(b.value->>'end_at')::timestamptz
        and (a.value->>'end_at')::timestamptz>(b.value->>'start_at')::timestamptz) then
      raise exception '这次提供的时段彼此重叠，请给出互不重叠的最终时段。' using errcode='P0001'; end if;
    if exists(select 1 from jsonb_array_elements(targets) x where
      (x->>'source'='whoop' and (x->>'item_index')::integer=0) or x->'tags'?'whoop-sleep') then
      raise exception '该区间含WHOOP评分睡眠，请先核对设备睡眠；本次未修改任何记录。' using errcode='P0001'; end if;
    if exists(select 1 from jsonb_array_elements(targets) x where (x->>'deduction_minutes')::integer>0) then
      raise exception '原记录含扣减时长，无法确定扣减属于哪个片段，本次未修改。请先明确并修正原记录的扣减。' using errcode='P0001'; end if;
    for request in select value from jsonb_array_elements(snapped) order by (value->>'start_at')::timestamptz loop
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
      jsonb_build_object('requests',snapped,'originals',originals,'generated',generated))
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

revoke all on function public.apply_steward_records_before_groups(uuid,uuid,jsonb,jsonb),
  public.snap_time_replacement_requests(uuid,jsonb,timestamptz),
  public.find_time_replacement_targets(uuid,jsonb),
  public.apply_time_replacements(uuid,uuid,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_steward_records_before_groups(uuid,uuid,jsonb,jsonb),
  public.snap_time_replacement_requests(uuid,jsonb,timestamptz),
  public.find_time_replacement_targets(uuid,jsonb),
  public.apply_time_replacements(uuid,uuid,jsonb,jsonb,jsonb)
  to service_role;
