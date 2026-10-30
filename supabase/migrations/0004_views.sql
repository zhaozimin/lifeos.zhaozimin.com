-- [INPUT]: 已提交账目、分类及原话归属。
-- [OUTPUT]: 按日时间与收支视图，以及仅供服务端读取的账目快照。
-- [POS]: 读取边界；跨午夜按实际重叠时长拆分，视图继承底表 RLS。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

create view public.v_daily_time with (security_invoker = true) as
select r.owner_id, d.day::date as day, t.category_id,
  floor(sum(extract(epoch from (
    least(t.end_at, (d.day + interval '1 day') at time zone 'Asia/Shanghai') -
    greatest(t.start_at, d.day at time zone 'Asia/Shanghai')
  ))) / 60)::bigint as minutes
from public.time_entries t
join public.raw_inputs r on r.id = t.raw_input_id
cross join lateral generate_series(
  date_trunc('day', t.start_at at time zone 'Asia/Shanghai'),
  date_trunc('day', (t.end_at - interval '1 microsecond') at time zone 'Asia/Shanghai'),
  interval '1 day'
) as d(day)
where t.deleted_at is null
group by r.owner_id, d.day, t.category_id;

create view public.v_daily_money with (security_invoker = true) as
select r.owner_id, (t.occurred_at at time zone 'Asia/Shanghai')::date as day,
  t.direction, t.currency, t.category_id, sum(t.amount_cents) as cents
from public.transactions t join public.raw_inputs r on r.id = t.raw_input_id
where t.deleted_at is null
group by r.owner_id, day, t.direction, t.currency, t.category_id;

revoke all on public.v_daily_time, public.v_daily_money from anon, authenticated;
grant select on public.v_daily_time, public.v_daily_money to authenticated, service_role;

create function public.get_input_records(p_input_id uuid) returns jsonb
language sql stable set search_path = '' as $$
select jsonb_build_object(
  'time_entries', coalesce((select jsonb_agg(jsonb_build_object(
    'start_at', t.start_at, 'end_at', t.end_at, 'duration_min', t.duration_min,
    'activity', t.activity, 'category', c.name
  ) order by t.item_index) from public.time_entries t
    join public.categories c on c.id = t.category_id
    where t.raw_input_id = p_input_id and t.deleted_at is null), '[]'::jsonb),
  'transactions', coalesce((select jsonb_agg(jsonb_build_object(
    'occurred_at', t.occurred_at, 'direction', t.direction, 'amount_cents', t.amount_cents,
    'currency', t.currency, 'category', c.name, 'account', t.account, 'note', t.note
  ) order by t.item_index) from public.transactions t
    join public.categories c on c.id = t.category_id
    where t.raw_input_id = p_input_id and t.deleted_at is null), '[]'::jsonb)
);
$$;
revoke all on function public.get_input_records(uuid) from public, anon, authenticated;
grant execute on function public.get_input_records(uuid) to service_role;
