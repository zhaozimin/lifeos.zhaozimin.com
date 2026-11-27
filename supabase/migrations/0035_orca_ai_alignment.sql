-- [INPUT]: Orca本机脱敏AI轮次与触点遥测、本人时间账本与十一大类策略。
-- [OUTPUT]: ai_work_turns/ai_touchpoints/time_ai_alignments三表、幂等发布、双信号全自动切分校对与AAL2只读查询RPC。
-- [POS]: Orca AI时间双轨真源；同构于0023/0030 WHOOP校准范式，软删原休息段、保留版本与人工修改冲突保护。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

-- ============================================================
-- 1. 独立 AI 遥测与校对基线表（严格剥离原文，仅存时间戳与脱敏统计）
-- ============================================================

create table public.ai_work_turns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  source text not null check (source in ('orca_native', 'claude_cli', 'codex_cli', 'opencode')),
  provider text not null check (length(provider) between 1 and 40),
  session_key text not null check (length(session_key) between 1 and 128),
  turn_key text not null check (length(turn_key) between 1 and 160),
  project_label text check (project_label is null or length(project_label) <= 120),
  model text check (model is null or length(model) <= 120),
  reasoning_effort text check (reasoning_effort is null or length(reasoning_effort) <= 32),
  started_at timestamptz not null,
  ended_at timestamptz not null check (ended_at >= started_at),
  active_ms integer not null check (active_ms >= 0),
  wait_human_ms integer not null default 0 check (wait_human_ms >= 0),
  tool_call_count integer not null default 0 check (tool_call_count >= 0),
  subagent_count integer not null default 0 check (subagent_count >= 0),
  outcome text check (outcome is null or length(outcome) <= 40),
  updated_at timestamptz not null default now(),
  unique (owner_id, source, turn_key)
);

create index ai_work_turns_owner_span_idx
  on public.ai_work_turns (owner_id, started_at, ended_at);

create table public.ai_touchpoints (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  event_key text not null check (length(event_key) between 1 and 160),
  occurred_at timestamptz not null,
  kind text not null check (kind in ('user_prompt', 'approval_reply', 'question_reply')),
  device_origin text not null default 'unknown' check (device_origin in ('host', 'mobile', 'unknown')),
  provider text not null check (length(provider) between 1 and 40),
  session_key text not null check (length(session_key) between 1 and 128),
  updated_at timestamptz not null default now(),
  unique (owner_id, event_key)
);

create index ai_touchpoints_owner_time_idx
  on public.ai_touchpoints (owner_id, occurred_at);

create table public.time_ai_alignments (
  owner_id uuid not null references auth.users(id),
  cluster_key text not null,
  payload_hash text not null,
  status text not null check (status in ('applied', 'conflict', 'dismissed')),
  local_date date not null,
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  touchpoint_count integer not null check (touchpoint_count >= 1),
  mobile_touch_count integer not null default 0 check (mobile_touch_count >= 0),
  peak_concurrency smallint not null default 1 check (peak_concurrency >= 1),
  agent_minutes numeric(8, 1) not null default 0 check (agent_minutes >= 0),
  originals jsonb not null default '[]',
  generated jsonb not null default '[]',
  reason text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, cluster_key)
);

create index time_ai_alignments_owner_date_idx
  on public.time_ai_alignments (owner_id, local_date);

-- ============================================================
-- 2. RLS 权限收敛：仅本人 AAL2 可读，仅 service_role 可写
-- ============================================================

alter table public.ai_work_turns enable row level security;
alter table public.ai_touchpoints enable row level security;
alter table public.time_ai_alignments enable row level security;

revoke all on public.ai_work_turns, public.ai_touchpoints, public.time_ai_alignments
  from public, anon, authenticated;
grant select on public.ai_work_turns, public.ai_touchpoints, public.time_ai_alignments
  to authenticated;
grant all on public.ai_work_turns, public.ai_touchpoints, public.time_ai_alignments
  to service_role;

create policy owner_read on public.ai_work_turns for select to authenticated using
  (owner_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');
create policy owner_read on public.ai_touchpoints for select to authenticated using
  (owner_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');
create policy owner_read on public.time_ai_alignments for select to authenticated using
  (owner_id = (select auth.uid()) and (select auth.jwt()->>'aal') = 'aal2');

-- ============================================================
-- 3. 幂等发布 RPC：接收本机/VPS 推送的脱敏 AI 轮次与触点
-- ============================================================

create function public.publish_orca_ai(
  p_owner_id uuid,
  p_turns jsonb default '[]'::jsonb,
  p_touchpoints jsonb default '[]'::jsonb
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  item jsonb;
  t_count integer := 0;
  tp_count integer := 0;
begin
  if jsonb_typeof(p_turns) <> 'array' or jsonb_typeof(p_touchpoints) <> 'array' then
    raise exception 'invalid orca ai payload' using errcode = '22023';
  end if;
  if jsonb_array_length(p_turns) > 20000 or jsonb_array_length(p_touchpoints) > 40000 then
    raise exception 'orca ai batch too large' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_turns) loop
    insert into public.ai_work_turns (
      owner_id, source, provider, session_key, turn_key, project_label, model, reasoning_effort,
      started_at, ended_at, active_ms, wait_human_ms, tool_call_count, subagent_count, outcome, updated_at
    ) values (
      p_owner_id,
      coalesce(nullif(item->>'source', ''), 'orca_native'),
      item->>'provider',
      item->>'session_key',
      item->>'turn_key',
      nullif(item->>'project_label', ''),
      nullif(item->>'model', ''),
      nullif(item->>'reasoning_effort', ''),
      (item->>'started_at')::timestamptz,
      (item->>'ended_at')::timestamptz,
      greatest(0, coalesce((item->>'active_ms')::integer, 0)),
      greatest(0, coalesce((item->>'wait_human_ms')::integer, 0)),
      greatest(0, coalesce((item->>'tool_call_count')::integer, 0)),
      greatest(0, coalesce((item->>'subagent_count')::integer, 0)),
      nullif(item->>'outcome', ''),
      now()
    )
    on conflict (owner_id, source, turn_key) do update set
      provider = excluded.provider,
      session_key = excluded.session_key,
      project_label = excluded.project_label,
      model = excluded.model,
      reasoning_effort = excluded.reasoning_effort,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      active_ms = excluded.active_ms,
      wait_human_ms = excluded.wait_human_ms,
      tool_call_count = excluded.tool_call_count,
      subagent_count = excluded.subagent_count,
      outcome = excluded.outcome,
      updated_at = now();
    t_count := t_count + 1;
  end loop;

  for item in select value from jsonb_array_elements(p_touchpoints) loop
    insert into public.ai_touchpoints (
      owner_id, event_key, occurred_at, kind, device_origin, provider, session_key, updated_at
    ) values (
      p_owner_id,
      item->>'event_key',
      (item->>'occurred_at')::timestamptz,
      coalesce(nullif(item->>'kind', ''), 'user_prompt'),
      coalesce(nullif(item->>'device_origin', ''), 'unknown'),
      item->>'provider',
      item->>'session_key',
      now()
    )
    on conflict (owner_id, event_key) do update set
      occurred_at = excluded.occurred_at,
      kind = excluded.kind,
      device_origin = excluded.device_origin,
      provider = excluded.provider,
      session_key = excluded.session_key,
      updated_at = now();
    tp_count := tp_count + 1;
  end loop;

  return jsonb_build_object('turns', t_count, 'touchpoints', tp_count);
end;
$$;

revoke all on function public.publish_orca_ai(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.publish_orca_ai(uuid, jsonb, jsonb) to service_role;

-- ============================================================
-- 4. 双信号全自动切分校对引擎（均衡模式：15m间隔 / 10m最小块 / 2m前+4m后缓冲）
-- ============================================================

create function public.reconcile_orca_ai_time(
  p_owner_id uuid,
  p_from_date date default null,
  p_to_date date default null,
  p_settled_before timestamptz default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  tz text := 'Asia/Shanghai';
  gap_interval interval := interval '15 minutes';
  min_minutes integer := 10;
  pre_buffer interval := interval '2 minutes';
  post_buffer interval := interval '4 minutes';
  settled_cutoff timestamptz := coalesce(p_settled_before, now() - gap_interval);
  from_ts timestamptz := ((coalesce(p_from_date, (now() at time zone tz)::date - 14)::text || ' 00:00:00')::timestamp at time zone tz);
  to_ts timestamptz := (((coalesce(p_to_date, (now() at time zone tz)::date) + 1)::text || ' 00:00:00')::timestamp at time zone tz);
  work_cat smallint;
  eligible_cats smallint[];
  cl record;
  old_al public.time_ai_alignments%rowtype;
  part jsonb;
  current_row public.time_entries%rowtype;
  origin public.time_entries%rowtype;
  changed boolean;
  closed_origins jsonb;
  c_start timestamptz;
  c_end timestamptz;
  c_key text;
  c_hash text;
  c_day date;
  peak_c smallint;
  agent_min numeric(8, 1);
  originals jsonb;
  generated jsonb;
  raw_id uuid;
  new_id uuid;
  idx integer;
  seg_start timestamptz;
  seg_end timestamptz;
  total_collab_min integer;
  deduction integer;
  collab_note text;
  applied integer := 0;
  unchanged integer := 0;
  conflicts integer := 0;
  skipped integer := 0;
begin
  select id into work_cat
    from public.categories
    where owner_id = p_owner_id and kind = 'time' and is_active and name = '工作'
    limit 1;
  if work_cat is null then
    return jsonb_build_object('enabled', false, 'reason', 'WORK_CATEGORY_MISSING');
  end if;

  select coalesce(array_agg(id), '{}') into eligible_cats
    from public.categories
    where owner_id = p_owner_id and kind = 'time' and is_active
      and name in ('清醒休息', '休息', '娱乐', '待确认');
  if array_length(eligible_cats, 1) is null then
    return jsonb_build_object('enabled', false, 'reason', 'NO_ELIGIBLE_CATEGORIES');
  end if;

  -- 与微信切换和 WHOOP 校准共用短事务表锁，避免并发撕裂时间轴。
  lock table public.time_entries in share row exclusive mode;

  for cl in
    with ordered as (
      select
        event_key,
        occurred_at,
        device_origin,
        case
          when lag(occurred_at) over (order by occurred_at, event_key) is null then 1
          when occurred_at - lag(occurred_at) over (order by occurred_at, event_key) > gap_interval then 1
          else 0
        end as is_new
      from public.ai_touchpoints
      where owner_id = p_owner_id
        and occurred_at >= from_ts - gap_interval
        and occurred_at < to_ts
    ),
    grouped as (
      select
        event_key,
        occurred_at,
        device_origin,
        sum(is_new) over (order by occurred_at, event_key) as grp
      from ordered
    )
    select
      min(event_key) as first_event_key,
      min(occurred_at) as first_tp,
      max(occurred_at) as last_tp,
      count(*)::integer as tp_count,
      count(*) filter (where device_origin = 'mobile')::integer as mobile_count
    from grouped
    group by grp
    having count(*) >= 2
      and max(occurred_at) <= settled_cutoff
      and max(occurred_at) >= from_ts
      and min(occurred_at) < to_ts
    order by min(occurred_at)
  loop
    c_start := date_trunc('minute', cl.first_tp - pre_buffer);
    c_end := date_trunc('minute', cl.last_tp + post_buffer + interval '59 seconds');
    if extract(epoch from (c_end - c_start)) / 60 < min_minutes then
      skipped := skipped + 1;
      continue;
    end if;

    -- 核验该窗口内确实存在活跃 AI 轮次（双信号交叉，杜绝无 AI 时的误判）。
    with overlap_turns as (
      select
        greatest(started_at, c_start) as s,
        least(ended_at, c_end) as e,
        active_ms,
        extract(epoch from (ended_at - started_at)) * 1000.0 as raw_ms
      from public.ai_work_turns
      where owner_id = p_owner_id
        and started_at < c_end + interval '2 minutes'
        and ended_at > c_start - interval '2 minutes'
    ),
    clipped as (
      select s, e,
        case
          when e <= s then 0.0
          when raw_ms <= 0 then 0.0
          else (extract(epoch from (e - s)) * 1000.0) * least(1.0, active_ms::numeric / raw_ms)
        end as eff_ms
      from overlap_turns
    ),
    sweep as (
      select t, sum(delta) over (order by t, delta desc) as conc
      from (
        select s as t, 1 as delta from clipped where e > s
        union all
        select e as t, -1 as delta from clipped where e > s
      ) ev
    )
    select
      coalesce((select max(conc)::smallint from sweep), 0),
      round(coalesce((select sum(eff_ms) / 60000.0 from clipped), 0)::numeric, 1)
    into peak_c, agent_min;

    if peak_c < 1 then
      skipped := skipped + 1;
      continue;
    end if;

    c_day := (c_start at time zone tz)::date;
    c_key := 'cluster:' || cl.first_event_key;
    c_hash := encode(sha256(convert_to(
      c_start::text || '|' || c_end::text || '|' || cl.tp_count::text || '|' ||
      cl.mobile_count::text || '|' || peak_c::text || '|' || agent_min::text,
      'UTF8'
    )), 'hex');

    select * into old_al from public.time_ai_alignments
      where owner_id = p_owner_id and cluster_key = c_key for update;
    if found and old_al.status = 'dismissed' then
      unchanged := unchanged + 1;
      continue;
    end if;
    if found and old_al.status = 'applied' and old_al.payload_hash = c_hash then
      unchanged := unchanged + 1;
      continue;
    end if;

    -- 若此前已切分但簇范围有增量更新，先校验是否有人工修改；人工改过则标 conflict 保护不覆写。
    if old_al.cluster_key is not null and old_al.status = 'applied' then
      changed := false;
      closed_origins := '{}';
      for part in select value from jsonb_array_elements(old_al.generated) loop
        select * into current_row from public.time_entries where id = (part->>'id')::uuid;
        if not found or current_row.deleted_at is not null then
          changed := true;
          exit;
        end if;
        if (to_jsonb(current_row) - array['revision', 'updated_at', 'duration_min'])
            is distinct from ((part->'baseline') - array['revision', 'updated_at', 'duration_min']) then
          if part->>'role' = 'after' and part#>>'{baseline,end_at}' is null and current_row.end_at >= old_al.end_at
            and (to_jsonb(current_row) - array['revision', 'updated_at', 'duration_min', 'end_at'])
              = ((part->'baseline') - array['revision', 'updated_at', 'duration_min', 'end_at']) then
            closed_origins := closed_origins || jsonb_build_object(part->>'sourceId', current_row.end_at);
          else
            changed := true;
            exit;
          end if;
        end if;
      end loop;
      if changed or exists (
        select 1 from jsonb_array_elements(old_al.originals) e
        left join public.time_entries t on t.id = (e->>'id')::uuid
        where t.id is null or t.deleted_at is null or t.revision <> (e->>'revision')::bigint + 1
      ) then
        update public.time_ai_alignments
          set status = 'conflict', reason = 'SOURCE_CHANGED_AFTER_ALIGNMENT', updated_at = now()
          where owner_id = p_owner_id and cluster_key = c_key;
        conflicts := conflicts + 1;
        continue;
      end if;
      update public.time_entries set deleted_at = now()
        where id in (select (e->>'id')::uuid from jsonb_array_elements(old_al.generated) e);
      update public.time_entries
        set deleted_at = null, end_at = coalesce((closed_origins->>id::text)::timestamptz, end_at)
        where id in (select (e->>'id')::uuid from jsonb_array_elements(old_al.originals) e);
    elsif old_al.cluster_key is not null and old_al.status = 'conflict' then
      conflicts := conflicts + 1;
      continue;
    end if;

    -- 查找落在可切分大类（清醒休息/休息/娱乐/待确认）内、且非睡眠/非已校对的候选原段。
    select coalesce(jsonb_agg(to_jsonb(t) order by t.start_at, t.id), '[]') into originals
      from public.time_entries t
      join public.raw_inputs r on r.id = t.raw_input_id
      where r.owner_id = p_owner_id
        and t.deleted_at is null
        and t.category_id = any(eligible_cats)
        and not ('whoop-sleep' = any(coalesce(t.tags, '{}')))
        and not ('ai-collab' = any(coalesce(t.tags, '{}')))
        and t.start_at < c_end
        and coalesce(t.end_at, settled_cutoff) > c_start;

    if jsonb_array_length(originals) = 0 then
      skipped := skipped + 1;
      continue;
    end if;

    -- 确认被切分出的实际轻度协同净分钟数 >= 10 分钟，避免切出碎片。
    select coalesce(sum(
      greatest(0, floor(extract(epoch from (
        least(coalesce((e->>'end_at')::timestamptz, c_end), c_end) -
        greatest((e->>'start_at')::timestamptz, c_start)
      )) / 60)::integer)
    ), 0) into total_collab_min
    from jsonb_array_elements(originals) e;

    if total_collab_min < min_minutes then
      skipped := skipped + 1;
      continue;
    end if;

    update public.time_entries set deleted_at = now()
      where id in (select (e->>'id')::uuid from jsonb_array_elements(originals) e);

    raw_id := gen_random_uuid();
    insert into public.raw_inputs (
      id, owner_id, source, external_id, text, received_at, payload, input_kind, status, receipt_text, delivered_at
    ) values (
      raw_id, p_owner_id, 'orca', 'ai:' || c_key || ':' || raw_id::text,
      'Orca AI轻度协同自动校对', c_end,
      jsonb_build_object('cluster_key', c_key, 'payload_hash', c_hash, 'peak_concurrency', peak_c, 'agent_minutes', agent_min),
      'record', 'parsed', 'Orca自动同步，不发送微信回执', now()
    ) on conflict do nothing;

    generated := '[]'::jsonb;
    idx := 0;
    collab_note := format(
      'Orca自动校对（均衡模式15m/10m）：峰值×%s并发 · %s次交互%s · 撬动%s分钟AI算力。',
      peak_c,
      cl.tp_count,
      case when cl.mobile_count > 0 then format('（含手机遥控%s次）', cl.mobile_count) else '' end,
      agent_min
    );

    for part in select value from jsonb_array_elements(originals) loop
      origin := jsonb_populate_record(null::public.time_entries, part);
      seg_start := greatest(origin.start_at, c_start);
      seg_end := least(coalesce(origin.end_at, c_end), c_end);

      -- 1) 前段保留原分类
      if origin.start_at < seg_start then
        idx := idx + 1;
        new_id := gen_random_uuid();
        deduction := case when origin.end_at is null then 0 else least(
          floor(extract(epoch from (seg_start - origin.start_at)) / 60)::integer,
          floor(origin.deduction_minutes * extract(epoch from (seg_start - origin.start_at))
            / nullif(extract(epoch from (origin.end_at - origin.start_at)), 0))::integer
        ) end;
        insert into public.time_entries (
          id, raw_input_id, item_index, start_at, end_at, category_id, activity,
          deduction_minutes, deduction_note, project, tags, note
        ) values (
          new_id, raw_id, idx, origin.start_at, seg_start, origin.category_id, origin.activity,
          deduction, origin.deduction_note, origin.project,
          coalesce(origin.tags, '{}') || array['ai-boundary-fragment'],
          origin.note
        );
        select generated || jsonb_build_array(jsonb_build_object(
          'id', new_id, 'revision', t.revision, 'role', 'before', 'sourceId', origin.id, 'baseline', to_jsonb(t)
        )) into generated from public.time_entries t where t.id = new_id;
      end if;

      -- 2) 中段切分为「工作 · AI轻度协同」（保持十一大类不变，打 ai-collab 标签）
      if seg_end > seg_start then
        idx := idx + 1;
        new_id := gen_random_uuid();
        insert into public.time_entries (
          id, raw_input_id, item_index, start_at, end_at, category_id, activity,
          deduction_minutes, project, tags, note
        ) values (
          new_id, raw_id, idx, seg_start, seg_end, work_cat, 'AI轻度协同',
          0, origin.project,
          array['ai-collab', 'orca-auto'],
          concat_ws(E'\n', collab_note, nullif('原记录：' || origin.activity, '原记录：'))
        );
        select generated || jsonb_build_array(jsonb_build_object(
          'id', new_id, 'revision', t.revision, 'role', 'collab', 'sourceId', origin.id, 'baseline', to_jsonb(t)
        )) into generated from public.time_entries t where t.id = new_id;
      end if;

      -- 3) 后段保留原分类（原段进行中时继续保持 end_at is null）
      if origin.end_at is null or origin.end_at > seg_end then
        idx := idx + 1;
        new_id := gen_random_uuid();
        deduction := case when origin.end_at is null then 0 else least(
          floor(extract(epoch from (origin.end_at - seg_end)) / 60)::integer,
          floor(origin.deduction_minutes * extract(epoch from (origin.end_at - seg_end))
            / nullif(extract(epoch from (origin.end_at - origin.start_at)), 0))::integer
        ) end;
        insert into public.time_entries (
          id, raw_input_id, item_index, start_at, end_at, category_id, activity,
          deduction_minutes, deduction_note, project, tags, note
        ) values (
          new_id, raw_id, idx, seg_end, origin.end_at, origin.category_id, origin.activity,
          deduction, origin.deduction_note, origin.project,
          coalesce(origin.tags, '{}') || array['ai-boundary-fragment'],
          origin.note
        );
        select generated || jsonb_build_array(jsonb_build_object(
          'id', new_id, 'revision', t.revision, 'role', 'after', 'sourceId', origin.id, 'baseline', to_jsonb(t)
        )) into generated from public.time_entries t where t.id = new_id;
      end if;
    end loop;

    insert into public.time_ai_alignments (
      owner_id, cluster_key, payload_hash, status, local_date, start_at, end_at,
      touchpoint_count, mobile_touch_count, peak_concurrency, agent_minutes,
      originals, generated, reason, updated_at
    ) values (
      p_owner_id, c_key, c_hash, 'applied', c_day, c_start, c_end,
      cl.tp_count, cl.mobile_count, peak_c, agent_min,
      originals, generated, null, now()
    )
    on conflict (owner_id, cluster_key) do update set
      payload_hash = excluded.payload_hash,
      status = 'applied',
      local_date = excluded.local_date,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      touchpoint_count = excluded.touchpoint_count,
      mobile_touch_count = excluded.mobile_touch_count,
      peak_concurrency = excluded.peak_concurrency,
      agent_minutes = excluded.agent_minutes,
      originals = excluded.originals,
      generated = excluded.generated,
      reason = null,
      updated_at = now();

    applied := applied + 1;
  end loop;

  return jsonb_build_object(
    'enabled', true,
    'applied', applied,
    'unchanged', unchanged,
    'conflicts', conflicts,
    'skipped', skipped
  );
end;
$$;

revoke all on function public.reconcile_orca_ai_time(uuid, date, date, timestamptz) from public, anon, authenticated;
grant execute on function public.reconcile_orca_ai_time(uuid, date, date, timestamptz) to service_role;

-- ============================================================
-- 5. 本人 AAL2 区间查询 RPC：为 Web 双轨时间轴与统计页提供真源数据
-- ============================================================

create function public.get_orca_ai_range(p_from date, p_to date)
returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  owner uuid := auth.uid();
  tz text := 'Asia/Shanghai';
  from_ts timestamptz;
  to_ts timestamptz;
begin
  if owner is null or (auth.jwt()->>'aal') <> 'aal2' then
    raise exception 'aal2 required' using errcode = '42501';
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
      where t.owner_id = owner and t.started_at < to_ts and t.ended_at > from_ts
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
      where p.owner_id = owner and p.occurred_at >= from_ts and p.occurred_at < to_ts
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
      where a.owner_id = owner and a.local_date between p_from and p_to
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_orca_ai_range(date, date) from public, anon;
grant execute on function public.get_orca_ai_range(date, date) to authenticated, service_role;
