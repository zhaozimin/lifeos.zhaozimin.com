-- [INPUT]: 历史扣减、进行中时段和含转账的账本。
-- [OUTPUT]: 与网页统计同口径的每日小结。
-- [POS]: 旧小结的兼容迁移；覆盖用毛区间，分类使用净分钟。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

create or replace function public.get_daily_summary(p_owner_id uuid, p_at timestamptz default now())
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_day date := (p_at at time zone 'Asia/Shanghai')::date;
  v_start timestamptz := v_day::timestamp at time zone 'Asia/Shanghai';
  v_end timestamptz := p_at;
  v_time jsonb; v_money jsonb; v_gaps jsonb;
  v_covered bigint; v_gap_count integer;
  v_gap_limit constant integer := 5;
  v_gap_min constant interval := interval '5 minutes';
begin
  if p_owner_id is null or p_at is null then
    raise exception 'summary parameters required' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('name',name,'minutes',minutes) order by minutes desc,name),'[]'::jsonb)
    into v_time from (
      select c.name, sum(public.net_time_minutes(t.start_at,t.end_at,t.deduction_minutes,v_start,v_end,v_end))::bigint as minutes
      from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
      join public.categories c on c.id=t.category_id
      where r.owner_id=p_owner_id and t.deleted_at is null
        and coalesce(t.end_at,v_end)>v_start and t.start_at<v_end
      group by c.id,c.name
    ) t where minutes>0;
  select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'direction',direction,'cents',cents)
    order by currency,direction),'[]'::jsonb) into v_money from (
      select t.currency,t.direction,sum(t.amount_cents)::text as cents
      from public.transactions t join public.raw_inputs r on r.id=t.raw_input_id
      where r.owner_id=p_owner_id and t.deleted_at is null
        and t.direction<>'transfer' and t.occurred_at>=v_start and t.occurred_at<v_end
      group by t.currency,t.direction
    ) m;

  -- 先合并重叠区间，再计算空白。分类累计与去重覆盖分别保留。
  with intervals as (
    select distinct greatest(t.start_at,v_start) as s,least(coalesce(t.end_at,v_end),v_end) as e
    from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
    where r.owner_id=p_owner_id and t.deleted_at is null
      and coalesce(t.end_at,v_end)>v_start and t.start_at<v_end
  ), preceding as (
    select s,e,max(e) over(order by s,e rows between unbounded preceding and 1 preceding) as previous_end
    from intervals
  ), numbered as (
    select s,e,sum(case when previous_end is null or s>previous_end then 1 else 0 end)
      over(order by s,e rows unbounded preceding) as island from preceding
  ), merged as (
    select min(s) as s,max(e) as e from numbered group by island
  ), edges as (
    select v_start as s,v_start as e union select s,e from merged union select v_end,v_end
  ), adjacent as (
    select s,max(e) over(order by s,e rows between unbounded preceding and 1 preceding) as previous_end
    from edges
  ), gaps as (
    select previous_end as s,s as e from adjacent where s-previous_end>=v_gap_min
  )
  select coalesce((select floor(sum(extract(epoch from(e-s)))/60)::bigint from merged),0),
    (select count(*)::integer from gaps),
    coalesce((select jsonb_agg(jsonb_build_object('start_at',s,'end_at',e,
      'minutes',floor(extract(epoch from(e-s))/60)::bigint) order by s)
      from (select s,e from gaps order by e-s desc,s limit v_gap_limit) g),'[]'::jsonb)
    into v_covered,v_gap_count,v_gaps;
  return jsonb_build_object('command','daily','day',v_day,'as_of',v_end,'time',v_time,'money',v_money,
    'covered_minutes',v_covered,'gap_minutes',greatest(0,floor(extract(epoch from(v_end-v_start))/60)::bigint-v_covered),
    'gaps',v_gaps,'gaps_truncated',v_gap_count>v_gap_limit,
    'gap_min_minutes',extract(epoch from v_gap_min)::integer/60);
end;
$$;
