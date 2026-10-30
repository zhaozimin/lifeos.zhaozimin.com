-- [INPUT]: 私有时间账、WHOOP公开副本与固定站点发布配置。
-- [OUTPUT]: 匿名只读投影；私有底表与本人AAL2保持原权限。
-- [POS]: 访客数据出口；函数不接受调用者指定归属。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
create table public.visitor_settings (
 id smallint primary key check(id=1),
 owner_id uuid not null references auth.users(id),
 enabled boolean not null default false,
 share_activity_titles boolean not null default false
);
alter table public.visitor_settings enable row level security;
revoke all on public.visitor_settings from public,anon,authenticated;
grant all on public.visitor_settings to service_role;
create function public.visitor_policy() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.visitor_settings where id=1 and enabled)
$$;
revoke all on function public.visitor_policy() from public;
grant execute on function public.visitor_policy() to anon,authenticated,service_role;

create table public.visitor_health_publications (
 owner_id uuid not null references auth.users(id),
 range_days integer not null check(range_days in(7,30,90)),
 value jsonb not null,
 updated_at timestamptz not null default now(),
 primary key(owner_id,range_days)
);
alter table public.visitor_health_publications enable row level security;
revoke all on public.visitor_health_publications from public,anon,authenticated;
grant all on public.visitor_health_publications to service_role;

create function public.publish_visitor_health(p_owner_id uuid,p_values jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'service role required' using errcode='42501';end if;
 insert into public.visitor_health_publications(owner_id,range_days,value)
 select p_owner_id,n,(p_values->n::text) from unnest(array[7,30,90]) n
 where p_values ? n::text
 on conflict(owner_id,range_days) do update set value=excluded.value,updated_at=now();
end;
$$;
revoke all on function public.publish_visitor_health(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.publish_visitor_health(uuid,jsonb) to service_role;

create function public.visitor_time(p_from timestamptz,p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare cfg public.visitor_settings;result jsonb;
begin
 select * into cfg from public.visitor_settings where id=1 and enabled;
 if not found then raise exception 'visitor disabled' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '367 days'
 then raise exception 'invalid visitor range' using errcode='22023';end if;
 select jsonb_build_object(
 'categories',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'nature',c.nature,'code',c.code,'is_active',c.is_active)),'[]')
  from public.categories c where c.owner_id=cfg.owner_id and c.kind='time'),
 'entries',(select coalesce(jsonb_agg(x.row order by x.start_at),'[]') from (
  select t.start_at,jsonb_build_object('id',t.id,'start_at',t.start_at,'end_at',t.end_at,'category_id',t.category_id,
   'activity',case when cfg.share_activity_titles then t.activity else c.name end,
   'deduction_minutes',t.deduction_minutes,'source',r.source) row
  from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
  join public.categories c on c.id=t.category_id
  where r.owner_id=cfg.owner_id and t.deleted_at is null and t.start_at<p_to and (t.end_at>p_from or t.end_at is null)
  order by t.start_at limit 10000) x)) into result;
 return result;
end;
$$;
revoke all on function public.visitor_time(timestamptz,timestamptz) from public;
grant execute on function public.visitor_time(timestamptz,timestamptz) to anon,authenticated,service_role;

create function public.visitor_health(p_range integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_range not in(7,30,90) then raise exception 'invalid visitor range' using errcode='22023';end if;
 select h.value into result from public.visitor_settings s
 join public.visitor_health_publications h on h.owner_id=s.owner_id and h.range_days=p_range
 where s.id=1 and s.enabled;
 if result is null then raise exception 'visitor health unavailable' using errcode='42501';end if;
 return result;
end;
$$;
revoke all on function public.visitor_health(integer) from public;
grant execute on function public.visitor_health(integer) to anon,authenticated,service_role;

create function public.time_sleep_summary_for_owner(owner uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_to<p_from or p_to-p_from>366 then raise exception 'invalid sleep summary range' using errcode='22023';end if;
 if not exists(select 1 from public.time_group_policies where owner_id=owner and sleep_authority) then return null;end if;
 with scored as(select w.source_id,w.payload,
  (w.payload#>>'{score,stage_summary,total_light_sleep_time_milli}')::bigint+
  (w.payload#>>'{score,stage_summary,total_slow_wave_sleep_time_milli}')::bigint+
  (w.payload#>>'{score,stage_summary,total_rem_sleep_time_milli}')::bigint millis
  from public.whoop_records w join public.time_group_policies p on p.owner_id=w.owner_id
  where w.owner_id=owner and w.kind='sleeps' and w.payload->>'score_state'='SCORED'
   and (p.include_naps or w.payload->>'nap'='false')
   and ((w.payload->>'end')::timestamptz at time zone 'Asia/Shanghai')::date between p_from and p_to)
 select jsonb_build_object('source','WHOOP','sleepMinutes',coalesce(sum(floor(millis/60000.0)),0),
  'sleepMillis',coalesce(sum(millis),0),'nights',count(*) filter(where payload->>'nap'='false'),
  'naps',count(*) filter(where payload->>'nap'='true'),
  'conflicts',(select count(*) from public.time_sleep_alignments a where a.owner_id=owner and a.status<>'applied'
   and a.sleep_id in(select source_id from scored)),
  'pending',(select count(*) from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
   where r.owner_id=owner and t.deleted_at is null and t.tags@>array['whoop-pending']
    and (t.start_at at time zone 'Asia/Shanghai')::date between p_from and p_to)) into result from scored where millis>0;
 return result;
end;
$$;
revoke all on function public.time_sleep_summary_for_owner(uuid,date,date) from public,anon,authenticated;
create or replace function public.get_time_sleep_summary(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or (auth.jwt()->>'aal') is distinct from 'aal2' then raise exception 'owner aal2 required' using errcode='42501';end if;
 return public.time_sleep_summary_for_owner(auth.uid(),p_from,p_to);
end;
$$;
create function public.visitor_sleep_summary(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner uuid;
begin
 select owner_id into owner from public.visitor_settings where id=1 and enabled;
 if owner is null then raise exception 'visitor disabled' using errcode='42501';end if;
 return public.time_sleep_summary_for_owner(owner,p_from,p_to);
end;
$$;
revoke all on function public.visitor_sleep_summary(date,date) from public;
grant execute on function public.visitor_sleep_summary(date,date) to anon,authenticated,service_role;
