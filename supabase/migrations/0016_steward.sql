-- [INPUT]: 不可变原话、有效租约、真实资金账户与受限管家计划。
-- [OUTPUT]: 原子活动切换、人民币入账、原话标签和可核查的撤销因果。
-- [POS]: 微信管家执行器；复用原解析事务，不授予模型数据库权限。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

create function public.get_steward_context(p_owner_id uuid) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object(
  'accounts',coalesce((select jsonb_agg(jsonb_build_object('name',data->>'name','type',data->>'type')
    order by data->>'name') from public.local_records
    where owner_id=p_owner_id and kind='account' and deleted_at is null),'[]'::jsonb),
  'ongoing',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'revision',t.revision,
    'start_at',t.start_at,'activity',t.activity,'category',c.code) order by t.start_at)
    from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
    join public.categories c on c.id=t.category_id
    where r.owner_id=p_owner_id and t.deleted_at is null and t.end_at is null),'[]'::jsonb)
);
$$;

create function public.apply_steward(p_input_id uuid,p_lease_token uuid,p_result jsonb,p_expected_ongoing jsonb default null)
returns public.raw_inputs language plpgsql set search_path='' as $$
declare r public.raw_inputs%rowtype; previous public.time_entries%rowtype;
  entry jsonb; event jsonb; account_name text; facts text; boundary timestamptz;
  category smallint; open_count integer; new_id uuid; new_revision bigint;
  context_ids jsonb:='[]'; effects jsonb:='[]'; stopped timestamptz;
  plan jsonb; question text; entry_index integer;
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
          and abs(extract(epoch from(i.received_at-r.received_at)))<=90)
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
      boundary:=date_trunc('minute',(event->>'at')::timestamptz);
      if boundary is null or boundary>r.received_at+interval '1 minute' then
        raise exception '请确认这项活动的实际开始或结束时间。' using errcode='P0001'; end if;
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
      previous:=null;
      select t.* into previous from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
        where i.owner_id=r.owner_id and t.deleted_at is null and t.end_at is null for update of t;
      if previous.id is not null and boundary-previous.start_at>interval '24 hours' then
        raise exception '当前活动已超过24小时，请先在网页确认真实结束点。' using errcode='P0001'; end if;
      if event->>'action'='switch' then
        select id into category from public.categories where owner_id=r.owner_id and kind='time'
          and code=event->>'category' and is_active;
        if category is null or coalesce(length(trim(event->>'activity')),0)=0 then
          raise exception 'invalid switch category or activity' using errcode='22023'; end if;
        if previous.id is not null and previous.category_id=category and previous.activity=event->>'activity' then
          if boundary<previous.start_at then
            raise exception '切换时间早于当前活动起点，请确认钟点。' using errcode='P0001'; end if;
          context_ids:=jsonb_build_array(previous.id); continue;
        end if;
      elsif event->>'category' is not null or event->>'activity' is not null then
        raise exception 'stop cannot open activity' using errcode='22023';
      end if;
      if previous.id is not null then
        if boundary<=previous.start_at then
          raise exception '这个钟点未晚于当前活动起点，请确认实际钟点；误记请发“撤销”。' using errcode='P0001'; end if;
        if exists(select 1 from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
          where i.owner_id=r.owner_id and t.deleted_at is null and t.id<>previous.id and
          t.start_at<boundary and coalesce(t.end_at,'infinity'::timestamptz)>previous.start_at) then
          raise exception '当前活动与已有记录重叠，请先在网页核对结束点。' using errcode='P0001'; end if;
        update public.time_entries set end_at=boundary where id=previous.id returning revision into new_revision;
        effects:=jsonb_build_array(jsonb_build_object('id',previous.id,'revision',new_revision,'end_at',boundary));
        context_ids:=jsonb_build_array(previous.id);
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

create or replace function public.get_input_records(p_input_id uuid) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object(
  'time_entries',coalesce((select jsonb_agg(jsonb_build_object(
    'start_at',t.start_at,'end_at',t.end_at,'duration_min',t.duration_min,'activity',t.activity,'category',c.name)
    order by t.start_at,t.id) from public.time_entries t join public.categories c on c.id=t.category_id
    where t.deleted_at is null and (t.raw_input_id=p_input_id or t.id in
      (select value::uuid from public.raw_inputs r,
        jsonb_array_elements_text(coalesce(r.parse_result->'_time_context_ids','[]')) where r.id=p_input_id))),'[]'::jsonb),
  'transactions',coalesce((select jsonb_agg(jsonb_build_object('occurred_at',t.occurred_at,'direction',t.direction,
    'amount_cents',t.amount_cents,'currency',t.currency,'category',c.name,'note',t.note,
    'account',nullif(concat_ws(' / ',a.account_name,case a.channel when 'wechat_pay' then '微信支付'
      when 'alipay' then '支付宝' when 'cash' then '现金' else a.channel end),'') ) order by t.item_index)
    from public.transactions t join public.categories c on c.id=t.category_id
    cross join lateral(select coalesce(t.from_account,t.to_account,t.account) account_name,
      coalesce(t.details->>'payment_method',case when coalesce(t.from_account,t.to_account) is not null
        and t.account<>coalesce(t.from_account,t.to_account) then t.account end) channel) a
    where t.raw_input_id=p_input_id and t.deleted_at is null),'[]'::jsonb)
);
$$;

alter function public.run_command(uuid,uuid,text) rename to run_command_base;
create function public.run_command(p_input_id uuid,p_lease_token uuid,p_command text)
returns public.raw_inputs language plpgsql set search_path='' as $$
declare r public.raw_inputs%rowtype; target public.raw_inputs%rowtype; effect jsonb;
  restored integer:=0; affected integer; skipped boolean:=false;
begin
  select * into strict r from public.raw_inputs where id=p_input_id for update;
  if r.status='parsed' then return r; end if;
  if r.input_kind<>'command' or r.lease_token is null or r.lease_token is distinct from p_lease_token then
    raise exception 'invalid command lease' using errcode='55000'; end if;
  if p_command='undo' then
    lock table public.time_entries in share row exclusive mode;
    select * into target from public.raw_inputs where owner_id=r.owner_id and input_kind='record'
      and revoked_at is null and status<>'ignored' and received_at<=r.received_at and id<>r.id
      order by received_at desc,created_at desc for update limit 1;
  end if;
  select * into r from public.run_command_base(p_input_id,p_lease_token,p_command);
  if p_command='undo' and target.id is not null then
    for effect in select value from jsonb_array_elements(coalesce(target.parse_result->'_time_effects','[]')) loop
      update public.time_entries t set end_at=null where t.id=(effect->>'id')::uuid and t.deleted_at is null
        and t.revision=(effect->>'revision')::bigint and t.end_at=(effect->>'end_at')::timestamptz
        and not exists(select 1 from public.time_entries x join public.raw_inputs i on i.id=x.raw_input_id
          where i.owner_id=r.owner_id and x.deleted_at is null and x.id<>t.id
            and coalesce(x.end_at,'infinity'::timestamptz)>t.start_at);
      get diagnostics affected=row_count;
      restored:=restored+affected; skipped:=skipped or affected=0;
    end loop;
    update public.raw_inputs set parse_result=r.parse_result||jsonb_build_object('restored_previous',restored,
      'record_count',coalesce((r.parse_result->>'record_count')::integer,0)+restored,'restore_skipped',skipped)
      where id=r.id returning * into r;
  end if;
  return r;
end;
$$;

revoke all on function public.get_steward_context(uuid),public.apply_steward(uuid,uuid,jsonb,jsonb),
  public.run_command(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.run_command_base(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.get_steward_context(uuid),public.apply_steward(uuid,uuid,jsonb,jsonb),
  public.run_command(uuid,uuid,text) to service_role;
