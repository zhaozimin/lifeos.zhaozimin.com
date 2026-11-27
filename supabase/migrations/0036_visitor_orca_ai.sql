-- [INPUT]: 依赖 0024_visitor.sql 的 visitor_settings/visitor_time 与 0035_orca_ai_alignment.sql 的 Orca AI 遥测表及 get_orca_ai_range。
-- [OUTPUT]: 在 visitor_settings 新增默认关闭的 share_ai_telemetry 开关；提供匿名投影 RPC visitor_orca_ai_range，并在开关开启时于 visitor_time 仅透出白名单系统标记（ai-collab/orca-auto）。
-- [POS]: 访客模式 AI 双轨公开出口；遵循默认关闭、底表零授权、仅暴露脱敏遥测与白名单系统标记的安全边界。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

alter table public.visitor_settings
  add column if not exists share_ai_telemetry boolean not null default false;

-- ============================================================
-- 1. 内部共享投影（供本人 AAL2 与访客匿名投影复用，禁止客户端直调）
-- ============================================================

create or replace function public.orca_ai_range_for_owner(
  p_owner uuid,
  p_from date,
  p_to date
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := 'Asia/Shanghai';
  from_ts timestamptz;
  to_ts timestamptz;
begin
  if p_owner is null then
    raise exception 'owner required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or (p_to - p_from) > 366 then
    raise exception 'invalid ai date range' using errcode = '22023';
  end if;

  from_ts := (p_from::text || ' 00:00:00')::timestamp at time zone tz;
  to_ts := ((p_to + 1)::text || ' 00:00:00')::timestamp at time zone tz;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'turns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'source', t.source,
        'provider', t.provider,
        'sessionKey', t.session_key,
        'projectLabel', t.project_label,
        'model', t.model,
        'reasoningEffort', t.reasoning_effort,
        'startedUtc', t.started_at,
        'endedUtc', t.ended_at,
        'activeMs', t.active_ms,
        'waitHumanMs', t.wait_human_ms,
        'toolCallCount', t.tool_call_count,
        'subagentCount', t.subagent_count,
        'outcome', t.outcome
      ) order by t.started_at, t.id)
      from public.ai_work_turns t
      where t.owner_id = p_owner and t.started_at < to_ts and t.ended_at > from_ts
    ), '[]'::jsonb),
    'touchpoints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'occurredUtc', p.occurred_at,
        'kind', p.kind,
        'deviceOrigin', p.device_origin,
        'provider', p.provider,
        'sessionKey', p.session_key
      ) order by p.occurred_at, p.id)
      from public.ai_touchpoints p
      where p.owner_id = p_owner and p.occurred_at >= from_ts and p.occurred_at < to_ts
    ), '[]'::jsonb),
    'alignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clusterKey', a.cluster_key,
        'status', a.status,
        'localDate', a.local_date,
        'startUtc', a.start_at,
        'endUtc', a.end_at,
        'touchpointCount', a.touchpoint_count,
        'mobileTouchCount', a.mobile_touch_count,
        'peakConcurrency', a.peak_concurrency,
        'agentMinutes', a.agent_minutes,
        'reason', a.reason
      ) order by a.start_at)
      from public.time_ai_alignments a
      where a.owner_id = p_owner and a.local_date between p_from and p_to
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.orca_ai_range_for_owner(uuid, date, date) from public, anon, authenticated;

-- 本人 AAL2 入口复用内部投影，权限契约不变
create or replace function public.get_orca_ai_range(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or (auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'aal2 required' using errcode = '42501';
  end if;
  return public.orca_ai_range_for_owner(auth.uid(), p_from, p_to);
end;
$$;

revoke all on function public.get_orca_ai_range(date, date) from public, anon;
grant execute on function public.get_orca_ai_range(date, date) to authenticated, service_role;

-- ============================================================
-- 2. 访客匿名 AI 遥测投影 RPC（服从 enabled + share_ai_telemetry）
-- ============================================================

create or replace function public.visitor_orca_ai_range(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  owner uuid;
begin
  select owner_id into owner
  from public.visitor_settings
  where id = 1 and enabled and share_ai_telemetry;
  if owner is null then
    raise exception 'visitor ai disabled' using errcode = '42501';
  end if;
  return public.orca_ai_range_for_owner(owner, p_from, p_to);
end;
$$;

revoke all on function public.visitor_orca_ai_range(date, date) from public;
grant execute on function public.visitor_orca_ai_range(date, date) to anon, authenticated, service_role;

-- ============================================================
-- 3. 扩展 visitor_time：仅在 share_ai_telemetry 开启时透出白名单系统标记
--    默认关闭时保持与 0024_visitor.sql 完全一致的 7 字段输出；
--    绝不暴露私人 tags、note、project 或未开放的原始活动标题。
-- ============================================================

create or replace function public.visitor_time(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  cfg public.visitor_settings;
  result jsonb;
begin
  select * into cfg from public.visitor_settings where id = 1 and enabled;
  if not found then
    raise exception 'visitor disabled' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '367 days' then
    raise exception 'invalid visitor range' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'nature', c.nature,
        'code', c.code,
        'is_active', c.is_active
      )), '[]')
      from public.categories c
      where c.owner_id = cfg.owner_id and c.kind = 'time'
    ),
    'entries', (
      select coalesce(jsonb_agg(x.row order by x.start_at), '[]')
      from (
        select
          t.start_at,
          case
            when cfg.share_ai_telemetry and ('ai-collab' = any(coalesce(t.tags, '{}'))) then
              jsonb_build_object(
                'id', t.id,
                'start_at', t.start_at,
                'end_at', t.end_at,
                'category_id', t.category_id,
                'activity', case when cfg.share_activity_titles then t.activity else 'AI轻度协同' end,
                'deduction_minutes', t.deduction_minutes,
                'source', r.source,
                'system_tags', (
                  select coalesce(jsonb_agg(tag order by tag), '[]'::jsonb)
                  from unnest(coalesce(t.tags, '{}')) as tag
                  where tag in ('ai-collab', 'orca-auto')
                )
              )
            else
              jsonb_build_object(
                'id', t.id,
                'start_at', t.start_at,
                'end_at', t.end_at,
                'category_id', t.category_id,
                'activity', case when cfg.share_activity_titles then t.activity else c.name end,
                'deduction_minutes', t.deduction_minutes,
                'source', r.source
              )
          end as row
        from public.time_entries t
        join public.raw_inputs r on r.id = t.raw_input_id
        join public.categories c on c.id = t.category_id
        where r.owner_id = cfg.owner_id
          and t.deleted_at is null
          and t.start_at < p_to
          and (t.end_at > p_from or t.end_at is null)
        order by t.start_at
        limit 10000
      ) x
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.visitor_time(timestamptz, timestamptz) from public;
grant execute on function public.visitor_time(timestamptz, timestamptz) to anon, authenticated, service_role;
