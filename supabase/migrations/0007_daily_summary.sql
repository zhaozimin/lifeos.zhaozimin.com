-- [INPUT]: 本人账目、原话与现有回执队列。
-- [OUTPUT]: 按快照时刻的小结与每日本人推送的幂等入队。
-- [POS]: 复用 parsed 指令和回执投递，不调用模型，不扩展客户端权限。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

create function public.get_daily_summary(p_owner_id uuid, p_at timestamptz default now())
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
      select c.name, floor(sum(extract(epoch from
        (least(t.end_at,v_end)-greatest(t.start_at,v_start))))/60)::bigint as minutes
      from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
      join public.categories c on c.id=t.category_id
      where r.owner_id=p_owner_id and t.deleted_at is null
        and t.end_at>v_start and t.start_at<v_end
      group by c.id,c.name
    ) t where minutes>0;
  select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'direction',direction,'cents',cents)
    order by currency,direction),'[]'::jsonb) into v_money from (
      select t.currency,t.direction,sum(t.amount_cents)::text as cents
      from public.transactions t join public.raw_inputs r on r.id=t.raw_input_id
      where r.owner_id=p_owner_id and t.deleted_at is null
        and t.occurred_at>=v_start and t.occurred_at<v_end
      group by t.currency,t.direction
    ) m;

  -- 先合并重叠区间，再计算空白。分类累计与去重覆盖分别保留。
  with intervals as (
    select distinct greatest(t.start_at,v_start) as s,least(t.end_at,v_end) as e
    from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
    where r.owner_id=p_owner_id and t.deleted_at is null
      and t.end_at>v_start and t.start_at<v_end
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

create function public.enqueue_daily_summary(p_owner_id uuid, p_at timestamptz default now())
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_day date := (p_at at time zone 'Asia/Shanghai')::date;
  v_time time := (p_at at time zone 'Asia/Shanghai')::time;
  v_context uuid; v_id uuid;
begin
  if p_owner_id is null or p_at is null then
    raise exception 'summary parameters required' using errcode = '22023';
  end if;
  if v_time<time '23:30' then
    return jsonb_build_object('queued',false,'reason','outside_window');
  end if;
  select id into v_context from public.raw_inputs
    where owner_id=p_owner_id and source='wechat'
      and received_at>=v_day::timestamp at time zone 'Asia/Shanghai' and received_at<=p_at
      and jsonb_typeof(payload->'from_user_id')='string'
      and jsonb_typeof(payload->'context_token')='string'
      and length(payload->>'context_token')>0
    order by received_at desc,created_at desc,id desc limit 1;
  if v_context is null then
    return jsonb_build_object('queued',false,'reason','no_context');
  end if;
  insert into public.raw_inputs(owner_id,source,external_id,text,received_at,payload,input_kind,
    status,parse_result,reply_input_id,receipt_revision)
  values(p_owner_id,'system','daily:'||v_day,'每日小结',p_at,jsonb_build_object('kind','daily_summary'),
    'command','parsed',public.get_daily_summary(p_owner_id,p_at),v_context,1)
  on conflict(owner_id,source,external_id) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.raw_inputs
      where owner_id=p_owner_id and source='system' and external_id='daily:'||v_day;
    return jsonb_build_object('queued',false,'reason','already_queued','input_id',v_id);
  end if;
  return jsonb_build_object('queued',true,'reason','queued','input_id',v_id);
end;
$$;

revoke all on function public.get_daily_summary(uuid,timestamptz),
  public.enqueue_daily_summary(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.get_daily_summary(uuid,timestamptz),
  public.enqueue_daily_summary(uuid,timestamptz) to service_role;
