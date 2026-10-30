-- [INPUT]: 原话、真实计时状态、限量追问和受限记录执行器。
-- [OUTPUT]: 新时段先闭旧计时、按题型接收补充、确定性停止与取消。
-- [POS]: 微信计时修复；原子保留历史与撤销因果，不让旧追问接管新指令。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

create or replace function public.apply_steward_records(p_input_id uuid,p_lease_token uuid,p_result jsonb,p_expected_ongoing jsonb default null)
returns public.raw_inputs language plpgsql set search_path='' as $$
declare r public.raw_inputs%rowtype; previous public.time_entries%rowtype;
  entry jsonb; event jsonb; account_name text; facts text; boundary timestamptz;
  category smallint; open_count integer; new_id uuid; new_revision bigint;
  context_ids jsonb:='[]'; effects jsonb:='[]'; stopped timestamptz;
  plan jsonb; question text; entry_index integer; first_start timestamptz;
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
      -- 先在首个新时段起点闭合旧计时，再检查新时段；旧计时不能以无限区间阻塞切换。
      select min((e->>'start_at')::timestamptz) into first_start
        from jsonb_array_elements(p_result->'time_entries') e;
      select t.* into previous from public.time_entries t join public.raw_inputs i on i.id=t.raw_input_id
        where i.owner_id=r.owner_id and t.deleted_at is null and t.end_at is null for update of t;
      if previous.id is not null and first_start>previous.start_at then
        update public.time_entries set end_at=first_start where id=previous.id returning revision into new_revision;
        effects:=jsonb_build_array(jsonb_build_object('id',previous.id,'revision',new_revision,'end_at',first_start));
        context_ids:=context_ids||jsonb_build_array(previous.id);
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
        effects:=effects||jsonb_build_array(jsonb_build_object('id',previous.id,'revision',new_revision,'end_at',boundary));
        context_ids:=context_ids||jsonb_build_array(previous.id);
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

create or replace function public.claim_next_input(p_owner_id uuid, p_records_enabled boolean)
returns setof public.raw_inputs language plpgsql set search_path = '' as $$
declare r public.raw_inputs%rowtype; waiting public.raw_inputs%rowtype;
begin
  select * into r from public.raw_inputs
  where owner_id = p_owner_id and revoked_at is null
    and (lease_until is null or lease_until < now())
    and (
      (status in ('parsed', 'awaiting_clarification') and receipt_text is null)
      or (status = 'ignored' and input_kind = 'unsupported' and receipt_text is null)
      or (status in ('pending', 'failed') and attempts < 5 and next_attempt_at <= now()
        and (p_records_enabled or input_kind <> 'record'))
    )
  order by received_at, created_at for update skip locked limit 1;
  if not found then return; end if;

  if r.input_kind = 'record' and r.status = 'pending' and r.attempts = 0
    and r.parse_result is null and r.clarification_for is null and r.reply_input_id is null then
    select * into waiting from public.raw_inputs
    where owner_id = p_owner_id and status = 'awaiting_clarification'
      and revoked_at is null and id <> r.id and received_at <= r.received_at
      and source=r.source and received_at>=r.received_at-interval '30 minutes'
      and (
        (clarification_prompt~'(金额|多少钱|花了多少)' and btrim(r.text)~'^[¥￥]?[0-9]+([.][0-9]{1,2})?\s*(元|块|人民币)?[。！!]?\s*$')
        or (clarification_prompt~'(资金账户|哪个账户|账户名)' and exists(
          select 1 from public.local_records a where a.owner_id=p_owner_id and a.kind='account' and a.deleted_at is null
            and regexp_replace(btrim(r.text),'[。！!]+$','') in
              (a.data->>'name','用'||(a.data->>'name'),(a.data->>'name')||'付的','用的是'||(a.data->>'name'))))
        or (clarification_prompt like '90秒内%' and btrim(r.text)~'^(是|是的|对|确认|另外一笔|另一笔|确实两笔|不是|不是的|否|no|yes)[。！!]?\s*$')
        or (clarification_prompt~'(几点|起止|开始时间|结束时间|开始或结束)' and btrim(r.text)~'^[0-9一二三四五六七八九十两]+([:：][0-9]{2}|点([0-9一二三四五六七八九十两]+分?|半)?)[。！!]?\s*$')
      )
    order by received_at desc for update skip locked limit 1;
    if found then
      update public.raw_inputs set status = 'ignored', clarification_for = waiting.id
        where id = r.id;
      update public.raw_inputs set status = 'pending', reply_input_id = r.id,
        receipt_text = null, delivered_at = null, next_attempt_at = now(),
        lease_token = null, lease_until = null, attempts = 0
        where id = waiting.id returning * into r;
    end if;
  end if;

  update public.raw_inputs set lease_token = gen_random_uuid(),
    lease_until = now() + interval '3 minutes',
    attempts = attempts + case when status in ('pending','failed') then 1 else 0 end
    where id = r.id returning * into r;
  return next r;
end;
$$;


alter function public.run_command(uuid,uuid,text) rename to run_command_before_timing_controls;
create function public.run_command(p_input_id uuid,p_lease_token uuid,p_command text)
returns public.raw_inputs language plpgsql set search_path='' as $$
declare r public.raw_inputs%rowtype; cancelled integer; context jsonb;
begin
  if p_command not in ('stop','cancel') then
    return public.run_command_before_timing_controls(p_input_id,p_lease_token,p_command);
  end if;
  select * into strict r from public.raw_inputs where id=p_input_id for update;
  if r.status='parsed' or r.revoked_at is not null then return r; end if;
  if r.input_kind<>'command' or r.lease_token is null or r.lease_token is distinct from p_lease_token then
    raise exception 'invalid command lease' using errcode='55000'; end if;
  -- 清除未投递的旧追问，正文版本仍由0020保存。
  update public.raw_inputs set status='ignored',clarification_prompt=null,lease_token=null,lease_until=null,
    receipt_text=null,receipt_revision=receipt_revision+1
    where owner_id=r.owner_id and source=r.source and id<>r.id and revoked_at is null
      and status='awaiting_clarification' and received_at<=r.received_at;
  get diagnostics cancelled=row_count;
  if p_command='stop' then
    context:=public.get_steward_context(r.owner_id);
    select * into r from public.apply_steward(r.id,p_lease_token,jsonb_build_object(
      'time_entries','[]'::jsonb,'transactions','[]'::jsonb,'clarify',null,
      'time_events',jsonb_build_array(jsonb_build_object('action','stop','at',r.received_at,
        'activity',null,'category',null,'note',null))),context->'ongoing');
    if r.status<>'parsed' then return r; end if;
    update public.raw_inputs set parse_result=r.parse_result||jsonb_build_object(
      'command','stop','cancelled_waits',cancelled,'stopped_count',jsonb_array_length(context->'ongoing'))
      where id=r.id returning * into r;
  else
    update public.raw_inputs set status='parsed',parse_result=jsonb_build_object('command','cancel','cancelled_waits',cancelled),
      clarification_prompt=null,error_code=null,lease_token=null,lease_until=null,receipt_text=null,
      receipt_revision=receipt_revision+1,delivered_at=null,reply_attempts=0,reply_next_at=now()
      where id=r.id returning * into r;
  end if;
  return r;
end;
$$;
revoke all on function public.run_command(uuid,uuid,text),public.run_command_before_timing_controls(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.run_command(uuid,uuid,text),public.run_command_before_timing_controls(uuid,uuid,text)
  to service_role;
