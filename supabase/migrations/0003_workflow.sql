-- [INPUT]: 原话、分类、账目和仅供服务端持有的 service_role 权限。
-- [OUTPUT]: 幂等接收、租约领取、解析提交、失败延期及原子指令。
-- [POS]: 业务事务边界；每次 RPC 要么全部提交，要么全部回滚。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

create function public.ingest_input(
  p_owner_id uuid, p_source text, p_external_id text, p_text text,
  p_received_at timestamptz, p_payload jsonb, p_input_kind text,
  p_initial_receipt text default null
) returns uuid language plpgsql set search_path = '' as $$
declare result uuid;
begin
  insert into public.raw_inputs(owner_id, source, external_id, text, received_at,
    payload, input_kind, receipt_text)
  values(p_owner_id, p_source, p_external_id, p_text, p_received_at,
    p_payload, p_input_kind, p_initial_receipt)
  on conflict(owner_id, source, external_id) do update set external_id = excluded.external_id
  returning id into result;
  return result;
end;
$$;

create function public.claim_next_input(p_owner_id uuid, p_records_enabled boolean)
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

create function public.apply_parse(p_input_id uuid, p_lease_token uuid, p_result jsonb)
returns public.raw_inputs language plpgsql set search_path = '' as $$
declare r public.raw_inputs%rowtype; item record; category smallint;
  time_count integer; money_count integer; question text; next_status public.input_status;
begin
  select * into strict r from public.raw_inputs where id = p_input_id for update;
  if r.revoked_at is not null or r.status in ('parsed', 'ignored') then return r; end if;
  if r.lease_token is distinct from p_lease_token or r.lease_token is null then
    raise exception 'input lease changed' using errcode = '55000';
  end if;
  if jsonb_typeof(p_result -> 'time_entries') is distinct from 'array'
    or jsonb_typeof(p_result -> 'transactions') is distinct from 'array' then
    raise exception 'invalid parse arrays' using errcode = '22023';
  end if;
  time_count := jsonb_array_length(p_result -> 'time_entries');
  money_count := jsonb_array_length(p_result -> 'transactions');
  if time_count > 50 or money_count > 50 then
    raise exception 'too many records' using errcode = '22023';
  end if;
  question := nullif(p_result ->> 'clarify', '');
  if question is not null and (time_count + money_count > 0 or length(question) > 500) then
    raise exception 'clarification conflicts with records' using errcode = '22023';
  end if;

  for item in select value, ordinality from jsonb_array_elements(p_result -> 'time_entries') with ordinality loop
    select id into category from public.categories where owner_id = r.owner_id
      and kind = 'time' and code = item.value ->> 'category' and is_active;
    if not found then raise exception 'invalid time category' using errcode = '23514'; end if;
    insert into public.time_entries(raw_input_id, item_index, start_at, end_at, category_id, activity, note)
    values(r.id, item.ordinality - 1, (item.value ->> 'start_at')::timestamptz,
      (item.value ->> 'end_at')::timestamptz, category, item.value ->> 'activity', item.value ->> 'note')
    on conflict(raw_input_id, item_index) do nothing;
  end loop;
  for item in select value, ordinality from jsonb_array_elements(p_result -> 'transactions') with ordinality loop
    select id into category from public.categories where owner_id = r.owner_id
      and kind = 'money' and code = item.value ->> 'category' and is_active;
    if not found then raise exception 'invalid money category' using errcode = '23514'; end if;
    insert into public.transactions(raw_input_id, item_index, occurred_at, direction, amount_cents,
      currency, category_id, account, merchant, note)
    values(r.id, item.ordinality - 1, (item.value ->> 'occurred_at')::timestamptz,
      item.value ->> 'direction', (item.value ->> 'amount_cents')::bigint,
      item.value ->> 'currency', category, item.value ->> 'account',
      item.value ->> 'merchant', item.value ->> 'note')
    on conflict(raw_input_id, item_index) do nothing;
  end loop;

  next_status := case when question is not null then 'awaiting_clarification'::public.input_status
    when time_count + money_count = 0 then 'ignored'::public.input_status else 'parsed'::public.input_status end;
  update public.raw_inputs set status = next_status, parse_result = p_result,
    clarification_prompt = question, error_code = null, lease_token = null, lease_until = null,
    receipt_text = null, receipt_revision = receipt_revision + 1,
    delivered_at = null, reply_attempts = 0, reply_next_at = now()
    where id = r.id returning * into r;
  return r;
end;
$$;

create function public.fail_input(p_input_id uuid, p_lease_token uuid, p_error_code text)
returns public.raw_inputs language plpgsql set search_path = '' as $$
declare r public.raw_inputs%rowtype;
begin
  select * into strict r from public.raw_inputs where id = p_input_id for update;
  if r.revoked_at is not null or r.status in ('parsed','ignored') then return r; end if;
  if r.lease_token is distinct from p_lease_token or r.lease_token is null then return r; end if;
  update public.raw_inputs set status = 'failed', error_code = left(p_error_code, 80),
    next_attempt_at = now() + interval '10 minutes', lease_token = null, lease_until = null,
    receipt_text = case when r.error_code is null then null else receipt_text end,
    receipt_revision = receipt_revision + case when r.error_code is null then 1 else 0 end,
    delivered_at = case when r.error_code is null then null else delivered_at end,
    reply_attempts = case when r.error_code is null then 0 else reply_attempts end
    where id = r.id returning * into r;
  return r;
end;
$$;

create function public.run_command(p_input_id uuid, p_lease_token uuid, p_command text)
returns public.raw_inputs language plpgsql set search_path = '' as $$
declare r public.raw_inputs%rowtype; target public.raw_inputs%rowtype;
  result jsonb; record_count integer := 0; affected integer; v_day date;
begin
  select * into strict r from public.raw_inputs where id = p_input_id for update;
  if r.status = 'parsed' then return r; end if;
  if r.input_kind <> 'command' or r.lease_token is distinct from p_lease_token
    or r.lease_token is null then raise exception 'invalid command lease' using errcode = '55000'; end if;
  if p_command = 'undo' then
    select * into target from public.raw_inputs
      where owner_id = r.owner_id and input_kind = 'record' and revoked_at is null
        and status <> 'ignored' and received_at <= r.received_at and id <> r.id
      order by received_at desc, created_at desc for update limit 1;
    if found then
      update public.raw_inputs set revoked_at = now(), lease_token = null, lease_until = null,
        status = case when status = 'parsed' then status else 'ignored'::public.input_status end
        where id = target.id;
      update public.time_entries set deleted_at = now() where raw_input_id = target.id and deleted_at is null;
      get diagnostics affected = row_count; record_count := record_count + affected;
      update public.transactions set deleted_at = now() where raw_input_id = target.id and deleted_at is null;
      get diagnostics affected = row_count; record_count := record_count + affected;
    end if;
    result := jsonb_build_object('command','undo','undone',target.id is not null,'record_count',record_count);
  elsif p_command = 'help' then
    result := jsonb_build_object('command','help');
  elsif p_command = 'today' then
    v_day := (r.received_at at time zone 'Asia/Shanghai')::date;
    result := jsonb_build_object('command','today',
      'time', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'minutes', t.minutes))
        from public.v_daily_time t join public.categories c on c.id = t.category_id
        where t.owner_id = r.owner_id and t.day = v_day), '[]'::jsonb),
      'money', coalesce((select jsonb_agg(to_jsonb(t)) from (
        select currency, direction, sum(cents) as cents from public.v_daily_money m
        where m.owner_id = r.owner_id and m.day = v_day group by currency, direction
      ) t), '[]'::jsonb));
  else raise exception 'unknown command' using errcode = '22023';
  end if;
  update public.raw_inputs set status = 'parsed', parse_result = result, error_code = null,
    lease_token = null, lease_until = null, receipt_text = null,
    receipt_revision = receipt_revision + 1, delivered_at = null,
    reply_attempts = 0, reply_next_at = now() where id = r.id returning * into r;
  return r;
end;
$$;

revoke all on function public.ingest_input(uuid,text,text,text,timestamptz,jsonb,text,text),
  public.claim_next_input(uuid,boolean), public.apply_parse(uuid,uuid,jsonb),
  public.fail_input(uuid,uuid,text), public.run_command(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.ingest_input(uuid,text,text,text,timestamptz,jsonb,text,text),
  public.claim_next_input(uuid,boolean), public.apply_parse(uuid,uuid,jsonb),
  public.fail_input(uuid,uuid,text), public.run_command(uuid,uuid,text) to service_role;
