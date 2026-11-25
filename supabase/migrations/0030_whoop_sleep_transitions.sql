-- [INPUT]: WHOOP已评分睡眠、大类策略、时间账本与微信计时执行器。
-- [OUTPUT]: 睡眠邻近短空白推定刷手机、跨夜生活自理醒后转刷手机、如厕超时10分钟自动转休息。
-- [POS]: 睡眠与如厕过渡规则迁移；零重叠、保留原话与审计，支持幂等重算与因果撤销。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

alter table public.time_sleep_alignments
  add column if not exists rule_version smallint not null default 1;

-- ============================================================
-- 1. 如厕识别与默认休息分类纯函数（供微信执行器与WHOOP校准共用）
-- ============================================================

create or replace function public.is_toilet_activity(p_activity text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(p_activity, '') ~ '(上厕所|如厕|拉屎|大便|小便)'
    and coalesce(p_activity, '') !~ '(洗漱|洗澡|洗脸|休息)';
$$;

create or replace function public.has_explicit_toilet_end(p_facts text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(p_facts, '') ~ '(上完厕所|拉完屎|拉屎完毕|上厕所完毕|如厕完毕|如厕完|厕完毕|完厕所|上厕所结束|拉屎结束|如厕结束)';
$$;

create or replace function public.resolve_rest_category(p_owner_id uuid)
returns smallint language sql stable set search_path='' as $$
  select id from public.categories
  where owner_id = p_owner_id and kind = 'time' and is_active
    and (name = '清醒休息' or code in ('time-group-rest', 'uncategorized'))
  order by case when name = '清醒休息' then 0 when code = 'time-group-rest' then 1 else 2 end
  limit 1;
$$;

-- ============================================================
-- 2. 微信计时闭合：未明示结束且超过10分钟的如厕自动转休息
-- ============================================================

create or replace function public.apply_steward_records_before_groups(
  p_input_id uuid, p_lease_token uuid, p_result jsonb, p_expected_ongoing jsonb default null
) returns public.raw_inputs language plpgsql set search_path='' as $$
declare r public.raw_inputs%rowtype; previous public.time_entries%rowtype;
  entry jsonb; event jsonb; account_name text; facts text; boundary timestamptz;
  category smallint; rest_category smallint; open_count integer; new_id uuid; rest_id uuid; new_revision bigint;
  context_ids jsonb:='[]'; effects jsonb:='[]'; stopped timestamptz;
  plan jsonb; question text; entry_index integer; first_start timestamptz; close_at timestamptz;
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
    if jsonb_array_length(p_result->'time_entries')>0 or
      jsonb_array_length(coalesce(p_result->'time_events','[]'))>0 then
      -- 单人账本短事务串行化，防止网页补录与切换竞态。
      lock table public.time_entries in share row exclusive mode;
    end if;
    if jsonb_array_length(p_result->'time_entries')>0 or jsonb_array_length(coalesce(p_result->'time_events','[]'))>0 then
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
      -- 先在首个新时段起点闭合旧计时；如厕未明示结束且超10分钟时截断并补休息。
      select min((e->>'start_at')::timestamptz) into first_start
        from jsonb_array_elements(p_result->'time_entries') e;
      select t.* into previous from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
        where i.owner_id=r.owner_id and t.deleted_at is null and t.end_at is null for update of t;
      if previous.id is not null and first_start>previous.start_at then
        if public.is_toilet_activity(previous.activity) and not public.has_explicit_toilet_end(facts)
          and first_start>previous.start_at+interval '10 minutes'
          and not exists(select 1 from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
            where i.owner_id=r.owner_id and t.deleted_at is null and t.id<>previous.id
              and t.start_at<first_start and coalesce(t.end_at,'infinity'::timestamptz)>previous.start_at) then
          close_at:=previous.start_at+interval '10 minutes';
          rest_category:=public.resolve_rest_category(r.owner_id);
          update public.time_entries set end_at=close_at where id=previous.id returning revision into new_revision;
          effects:=jsonb_build_array(jsonb_build_object('id',previous.id,'revision',new_revision,'end_at',close_at));
          context_ids:=context_ids||jsonb_build_array(previous.id);
          if rest_category is not null then
            insert into public.time_entries(raw_input_id,item_index,start_at,end_at,category_id,activity,tags,note)
              values(r.id,51,close_at,first_start,rest_category,'休息',array['toilet-auto-rest'],
                '按本人规则推定：上厕所超过10分钟未点结束，10分钟后自动转为休息。') returning id into rest_id;
            context_ids:=context_ids||jsonb_build_array(rest_id);
          end if;
        else
          update public.time_entries set end_at=first_start where id=previous.id returning revision into new_revision;
          effects:=jsonb_build_array(jsonb_build_object('id',previous.id,'revision',new_revision,'end_at',first_start));
          context_ids:=context_ids||jsonb_build_array(previous.id);
        end if;
      end if;
    end if;
    for entry in select value from jsonb_array_elements(p_result->'time_entries') loop
      if exists(select 1 from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
        where i.owner_id=r.owner_id and t.deleted_at is null and
        t.start_at<(entry->>'end_at')::timestamptz and
        coalesce(t.end_at,'infinity'::timestamptz)>(entry->>'start_at')::timestamptz) then
        raise exception '这段时间与已有记录重叠，请先在网页核对或修改对应记录。' using errcode='P0001'; end if;
    end loop;
    select * into r from public.apply_parse(p_input_id,p_lease_token,
      p_result||jsonb_build_object('transactions','[]'::jsonb));
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
    plan:=p_result||jsonb_build_object('_time_effects',effects,'_time_context_ids',context_ids,'_stopped_at',stopped);
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
-- 3. WHOOP睡眠邻近短空白（1分钟~4小时）增量补齐刷手机
-- ============================================================

create or replace function public.fill_whoop_sleep_gaps(
  p_owner_id uuid, p_sleep_id text, p_sleep_entry_id uuid, p_raw_id uuid,
  p_sleep_start timestamptz, p_sleep_end timestamptz, p_phone_category smallint,
  p_include_naps boolean, p_generated jsonb
) returns jsonb language plpgsql set search_path='' as $$
declare generated jsonb:=coalesce(p_generated,'[]'::jsonb);
  idx integer; new_id uuid; prev_end timestamptz; next_entry_start timestamptz;
  next_sleep_start timestamptz; next_start timestamptz;
begin
  select coalesce(max(item_index),0) into idx from public.time_entries where raw_input_id=p_raw_id;
  if not exists(select 1 from jsonb_array_elements(generated) g where g->>'role' in ('before','before-gap')) then
    select max(coalesce(t.end_at,'infinity'::timestamptz)) into prev_end
    from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
    where r.owner_id=p_owner_id and t.deleted_at is null
      and t.id<>p_sleep_entry_id and t.start_at<p_sleep_start;
    if prev_end is not null and prev_end<p_sleep_start
      and p_sleep_start-prev_end>=interval '1 minute'
      and p_sleep_start-prev_end<=interval '4 hours' then
      idx:=idx+1; new_id:=gen_random_uuid();
      insert into public.time_entries(id,raw_input_id,item_index,start_at,end_at,category_id,activity,tags,note)
        values(new_id,p_raw_id,idx,prev_end,p_sleep_start,p_phone_category,'刷手机',
          array['whoop-phone-estimate','whoop-gap-estimate'],
          '按本人规则推定：睡前与WHOOP入睡间的短空白记为刷手机；非设备检测到手机。');
      select generated||jsonb_build_array(jsonb_build_object(
        'id',new_id,'revision',t.revision,'role','before-gap','sourceId',null,'baseline',to_jsonb(t)))
        into generated from public.time_entries t where t.id=new_id;
    end if;
  end if;
  if not exists(select 1 from jsonb_array_elements(generated) g where g->>'role' in ('after','after-gap'))
    and not exists(select 1 from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
      where r.owner_id=p_owner_id and t.deleted_at is null and t.id<>p_sleep_entry_id
        and t.start_at<=p_sleep_end and coalesce(t.end_at,'infinity'::timestamptz)>p_sleep_end) then
    select min(t.start_at) into next_entry_start
    from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
    where r.owner_id=p_owner_id and t.deleted_at is null
      and t.id<>p_sleep_entry_id and t.start_at>p_sleep_end;
    select min((w.payload->>'start')::timestamptz) into next_sleep_start
    from public.whoop_records w
    where w.owner_id=p_owner_id and w.kind='sleeps' and w.payload->>'score_state'='SCORED'
      and (p_include_naps or w.payload->>'nap'='false') and w.payload->>'id'<>p_sleep_id
      and (w.payload->>'start')::timestamptz>p_sleep_end;
    next_start:=least(next_entry_start,next_sleep_start);
    if next_start is not null and next_start-p_sleep_end>=interval '1 minute'
      and next_start-p_sleep_end<=interval '4 hours' then
      idx:=idx+1; new_id:=gen_random_uuid();
      insert into public.time_entries(id,raw_input_id,item_index,start_at,end_at,category_id,activity,tags,note)
        values(new_id,p_raw_id,idx,p_sleep_end,next_start,p_phone_category,'刷手机',
          array['whoop-phone-estimate','whoop-gap-estimate'],
          '按本人规则推定：WHOOP醒来与次段活动间的短空白记为刷手机；非设备检测到手机。');
      select generated||jsonb_build_array(jsonb_build_object(
        'id',new_id,'revision',t.revision,'role','after-gap','sourceId',null,'baseline',to_jsonb(t)))
        into generated from public.time_entries t where t.id=new_id;
    end if;
  end if;
  return generated;
end;
$$;

-- ============================================================
-- 4. WHOOP校准v2：邻近短空白 + 跨夜生活自理醒后转刷手机 + 睡前如厕10分封顶
-- ============================================================

create or replace function public.reconcile_whoop_time(p_owner_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare policy public.time_group_policies%rowtype;s jsonb;stages jsonb;hash text;sid text;
 old public.time_sleep_alignments%rowtype;part jsonb;origin public.time_entries%rowtype;current_row public.time_entries%rowtype;
 changed boolean;closed_origins jsonb;needs_v2 boolean;
 sleep_start timestamptz;sleep_end timestamptz;actual bigint;awake bigint;nodata bigint;gross integer;
 sleep_category smallint;phone_category smallint;originals jsonb;generated jsonb;updated_generated jsonb;
 raw_id uuid;new_id uuid;sleep_entry_id uuid;sleep_raw_id uuid;
 boundary_start timestamptz;boundary_end timestamptz;cap_at timestamptz;idx integer;deduction integer;
 phone boolean;self_care_overnight boolean;role_name text;use_phone boolean;
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
  sleep_start:=(s->>'start')::timestamptz;sleep_end:=(s->>'end')::timestamptz;stages:=s#>'{score,stage_summary}';
  select * into old from public.time_sleep_alignments where owner_id=p_owner_id and sleep_id=sid for update;
  if found and old.status='applied' and old.payload_hash=hash then
   -- 仅对命中v2规则的v1旧校准做安全重算；其余已校准记录只增量检查邻近短空白。
   needs_v2:=old.rule_version<2 and exists(
    select 1 from jsonb_array_elements(old.originals) e
    join public.categories c on c.id=(e->>'category_id')::smallint
    where (c.name='生活自理' and (e->>'start_at')::timestamptz<sleep_start
      and ((e->>'end_at') is null or (e->>'end_at')::timestamptz>sleep_end)
      and ((e->>'end_at') is null or (e->>'end_at')::timestamptz-(e->>'start_at')::timestamptz<=interval '24 hours'))
     or (public.is_toilet_activity(e->>'activity') and (e->>'start_at')::timestamptz<sleep_start
      and least(coalesce((e->>'end_at')::timestamptz,sleep_start),sleep_start)>(e->>'start_at')::timestamptz+interval '10 minutes')
   );
   if not needs_v2 then
    if not exists(select 1 from jsonb_array_elements(old.generated) g where g->>'role' in ('before','before-gap'))
     or not exists(select 1 from jsonb_array_elements(old.generated) g where g->>'role' in ('after','after-gap')) then
     sleep_entry_id:=null;sleep_raw_id:=null;
     select t.id,t.raw_input_id into sleep_entry_id,sleep_raw_id
      from jsonb_array_elements(old.generated) g join public.time_entries t on t.id=(g->>'id')::uuid
      where g->>'role'='sleep' and t.deleted_at is null limit 1;
     if sleep_entry_id is not null then
      updated_generated:=public.fill_whoop_sleep_gaps(
       p_owner_id,sid,sleep_entry_id,sleep_raw_id,sleep_start,sleep_end,phone_category,policy.include_naps,old.generated);
      if jsonb_array_length(updated_generated)>jsonb_array_length(old.generated) then
       update public.time_sleep_alignments set generated=updated_generated,rule_version=2,updated_at=now()
        where owner_id=p_owner_id and sleep_id=sid;
       applied:=applied+1;continue;
      end if;
     end if;
    end if;
    unchanged:=unchanged+1;continue;
   end if;
  end if;
  actual:=(stages->>'total_light_sleep_time_milli')::bigint+(stages->>'total_slow_wave_sleep_time_milli')::bigint+
   (stages->>'total_rem_sleep_time_milli')::bigint;
  awake:=(stages->>'total_awake_time_milli')::bigint;nodata:=(stages->>'total_no_data_time_milli')::bigint;
  gross:=floor(extract(epoch from(sleep_end-sleep_start))/60)::integer;
  if sleep_start is null or sleep_end is null or sleep_end<=sleep_start or sleep_end>now() or actual is null
   or actual<=0 or actual>extract(epoch from(sleep_end-sleep_start))*1000+1000 or awake<0 or nodata<0 then
   insert into public.time_sleep_alignments(owner_id,sleep_id,payload_hash,status,reason,rule_version)
    values(p_owner_id,sid,hash,'invalid','INVALID_SCORED_SLEEP',2) on conflict(owner_id,sleep_id)
    do update set status='invalid',reason=excluded.reason,rule_version=2,updated_at=now();invalid:=invalid+1;continue;
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
  sleep_entry_id:=gen_random_uuid();
  deduction:=greatest(0,gross-floor(actual/60000.0)::integer);
  insert into public.time_entries(id,raw_input_id,item_index,start_at,end_at,category_id,activity,deduction_minutes,deduction_note,tags,note)
   values(sleep_entry_id,raw_id,0,sleep_start,sleep_end,sleep_category,'睡眠',deduction,
    'WHOOP浅睡+深睡+REM为实际睡眠；夜间清醒及无数据不计睡眠。',
    array['whoop-sleep',case when s->>'nap'='true' then 'whoop-nap' else 'whoop-night' end],
    '来源：WHOOP已评分睡眠。睡眠区间内的清醒没有逐段时间戳，不推断为刷手机。');
  select jsonb_build_array(jsonb_build_object('id',sleep_entry_id,'revision',t.revision,'role','sleep','baseline',to_jsonb(t))) into generated
   from public.time_entries t where t.id=sleep_entry_id;idx:=0;
  for part in select value from jsonb_array_elements(originals) loop
   origin:=jsonb_populate_record(null::public.time_entries,part);
   select name into source_group from public.categories where id=origin.category_id;
   phone:=(source_group in ('睡眠','清醒休息','娱乐') or 'whoop-pending'=any(origin.tags))
    and (origin.end_at is null or origin.end_at-origin.start_at<=interval '24 hours');
   self_care_overnight:=(source_group='生活自理') and origin.start_at<sleep_start
    and (origin.end_at is null or origin.end_at>sleep_end)
    and (origin.end_at is null or origin.end_at-origin.start_at<=interval '24 hours');
   for boundary_start,boundary_end in
    select origin.start_at,least(origin.end_at,sleep_start) where origin.start_at<sleep_start
    union all select greatest(origin.start_at,sleep_end),origin.end_at where origin.end_at is null or origin.end_at>sleep_end loop
    if boundary_end is not null and boundary_end<=boundary_start then continue;end if;
    role_name:=case when boundary_start>=sleep_end then 'after' else 'before' end;
    -- 睡前如厕未结束且超过10分钟：前10分钟保留原如厕，余量按休息→睡前刷手机推定。
    if role_name='before' and not phone and public.is_toilet_activity(origin.activity)
      and boundary_end>boundary_start+interval '10 minutes' then
     cap_at:=boundary_start+interval '10 minutes';
     idx:=idx+1;new_id:=gen_random_uuid();
     insert into public.time_entries(id,raw_input_id,item_index,start_at,end_at,category_id,activity,deduction_minutes,deduction_note,project,tags,note)
      values(new_id,raw_id,idx,boundary_start,cap_at,origin.category_id,origin.activity,0,origin.deduction_note,origin.project,
       array_remove(coalesce(origin.tags,'{}'),'whoop-pending')||array['whoop-boundary-fragment'],
       concat_ws(E'\n',nullif(origin.note,''),'按本人规则：上厕所超过10分钟未点结束，前10分钟保留原活动。'));
     select generated||jsonb_build_array(jsonb_build_object('id',new_id,'revision',t.revision,'role','before','sourceId',origin.id,'baseline',to_jsonb(t)))
      into generated from public.time_entries t where t.id=new_id;
     idx:=idx+1;new_id:=gen_random_uuid();
     insert into public.time_entries(id,raw_input_id,item_index,start_at,end_at,category_id,activity,deduction_minutes,deduction_note,project,tags,note)
      values(new_id,raw_id,idx,cap_at,boundary_end,phone_category,'刷手机',0,null,origin.project,
       array_remove(coalesce(origin.tags,'{}'),'whoop-pending')||array['whoop-phone-estimate','toilet-auto-rest'],
       concat_ws(E'\n',nullif(origin.note,''),'按本人规则推定：上厕所超过10分钟未点结束自动转休息，睡前过渡至WHOOP入睡记为刷手机；非设备检测到手机。'));
     select generated||jsonb_build_array(jsonb_build_object('id',new_id,'revision',t.revision,'role','before','sourceId',origin.id,'baseline',to_jsonb(t)))
      into generated from public.time_entries t where t.id=new_id;
     continue;
    end if;
    use_phone:=phone or (role_name='after' and self_care_overnight);
    idx:=idx+1;new_id:=gen_random_uuid();
    title:=case when use_phone then '刷手机' else origin.activity end;
    category:=case when use_phone then phone_category else origin.category_id end;
    tags:=array_remove(coalesce(origin.tags,'{}'),'whoop-pending')||array[case when use_phone then 'whoop-phone-estimate' else 'whoop-boundary-fragment' end];
    note:=concat_ws(E'\n',nullif(origin.note,''),case
     when phone then '按本人规则推定：手动睡觉/起床窗口与WHOOP睡眠首尾差额记为刷手机；非设备检测到手机。'
     when role_name='after' and self_care_overnight then '按本人规则推定：跨夜未结束的生活自理在WHOOP醒来后转为刷手机；非设备检测到手机。'
     else 'WHOOP睡眠覆盖区间已校准；此段保留原活动。' end);
    deduction:=case when boundary_end is null or origin.end_at is null then 0 else least(
     floor(extract(epoch from(boundary_end-boundary_start))/60)::integer,
     floor(origin.deduction_minutes*extract(epoch from(boundary_end-boundary_start))/nullif(extract(epoch from(origin.end_at-origin.start_at)),0))::integer) end;
    insert into public.time_entries(id,raw_input_id,item_index,start_at,end_at,category_id,activity,deduction_minutes,deduction_note,project,tags,note)
     values(new_id,raw_id,idx,boundary_start,boundary_end,category,title,deduction,origin.deduction_note,origin.project,tags,note);
    select generated||jsonb_build_array(jsonb_build_object('id',new_id,'revision',t.revision,
      'role',role_name,'sourceId',origin.id,'baseline',to_jsonb(t)))
     into generated from public.time_entries t where t.id=new_id;
   end loop;
  end loop;
  generated:=public.fill_whoop_sleep_gaps(
   p_owner_id,sid,sleep_entry_id,raw_id,sleep_start,sleep_end,phone_category,policy.include_naps,generated);
  insert into public.time_sleep_alignments(owner_id,sleep_id,payload_hash,status,start_at,end_at,asleep_millis,awake_millis,no_data_millis,originals,generated,rule_version)
   values(p_owner_id,sid,hash,'applied',sleep_start,sleep_end,actual,awake,nodata,originals,generated,2)
   on conflict(owner_id,sleep_id) do update set payload_hash=excluded.payload_hash,status='applied',start_at=excluded.start_at,end_at=excluded.end_at,
    asleep_millis=excluded.asleep_millis,awake_millis=excluded.awake_millis,no_data_millis=excluded.no_data_millis,
    originals=excluded.originals,generated=excluded.generated,reason=null,rule_version=2,updated_at=now();
  applied:=applied+1;
 end loop;
 perform set_config('lifeos.whoop_time_write','',true);
 return jsonb_build_object('enabled',true,'applied',applied,'unchanged',unchanged,'conflicts',conflicts,'invalid',invalid,'include_naps',policy.include_naps);
end;
$$;

revoke all on function public.is_toilet_activity(text),public.has_explicit_toilet_end(text),
  public.resolve_rest_category(uuid),public.fill_whoop_sleep_gaps(uuid,text,uuid,uuid,timestamptz,timestamptz,smallint,boolean,jsonb),
  public.apply_steward_records_before_groups(uuid,uuid,jsonb,jsonb),public.reconcile_whoop_time(uuid)
  from public,anon,authenticated;
grant execute on function public.is_toilet_activity(text),public.has_explicit_toilet_end(text),
  public.resolve_rest_category(uuid),public.fill_whoop_sleep_gaps(uuid,text,uuid,uuid,timestamptz,timestamptz,smallint,boolean,jsonb),
  public.apply_steward_records_before_groups(uuid,uuid,jsonb,jsonb),public.reconcile_whoop_time(uuid)
  to service_role;
