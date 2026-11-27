/**
 * [INPUT]: 依赖 AiTelemetryRange、Segment 账本与记录时区墙钟格式化。
 * [OUTPUT]: 对外提供单日 AI 并发条带与协作簇切片、逐项目模型/推理强度明细、模型与推理强度格式化、人类触点映射、深度/轻度工作拆分、后台放飞与多日杠杆统计纯函数。
 * [POS]: dashboard/lib 的 AI 双轨纯计算层；供 DayTimeline、WeekTimeline、AiModelMeta、DayPage 与 StatsPage 共享。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { AiAlignment, AiTelemetryRange, AiTouchpoint, AiTurn, Segment } from "../types";
import { sliceSegmentForDay } from "./timeline";

export interface AiBandSessionItem {
  key: string;
  projectLabel: string;
  provider: string;
  model: string | null;
  reasoningEffort: string | null;
  activeMinutes: number;
  waitHumanMinutes: number;
  toolCallCount: number;
  subagentCount: number;
  turnCount: number;
}

export interface AiConcurrencyBand {
  id: string;
  clusterId: string;
  startMinute: number;
  endMinute: number;
  concurrency: number;
  level: 1 | 2 | 3 | 4;
  providers: string[];
  models: string[];
  projects: string[];
  sessions: AiBandSessionItem[];
  turnCount: number;
  agentMinutes: number;
  waitHumanMinutes: number;
  toolCallCount: number;
  touchpointCount: number;
  mobileTouchCount: number;
}

export interface AiActivityCluster {
  id: string;
  startMinute: number;
  endMinute: number;
  peakConcurrency: number;
  level: 1 | 2 | 3 | 4;
  agentMinutes: number;
  wallMinutes: number;
  waitHumanMinutes: number;
  toolCallCount: number;
  touchpointCount: number;
  mobileTouchCount: number;
  bandIds: string[];
  sessions: AiBandSessionItem[];
  providers: string[];
  projects: string[];
  calibrated: boolean;
}

export interface AiDayTouchpoint {
  id: string;
  minute: number;
  timeLabel: string;
  deviceOrigin: AiTouchpoint["deviceOrigin"];
  provider: string;
  kind: AiTouchpoint["kind"];
  clusterId: string | null;
}

export interface AiDaySlice {
  day: string;
  bands: AiConcurrencyBand[];
  clusters: AiActivityCluster[];
  touchpoints: AiDayTouchpoint[];
  alignments: AiAlignment[];
  agentMinutes: number;
  wallMinutes: number;
  peakConcurrency: number;
  leverageRatio: number;
  turnCount: number;
  touchpointCount: number;
  mobileTouchCount: number;
  byProvider: Record<string, number>;
}

export interface AiRangeMetrics {
  agentMinutes: number;
  wallMinutes: number;
  peakConcurrency: number;
  leverageRatio: number;
  turnCount: number;
  touchpointCount: number;
  mobileTouchCount: number;
  deepWorkMinutes: number;
  lightCollabMinutes: number;
  backgroundCruiseMinutes: number;
  autoCalibratedCount: number;
  conflictCount: number;
  byProvider: Array<{ provider: string; agentMinutes: number; turnCount: number }>;
  days: Array<{
    date: string;
    agentMinutes: number;
    wallMinutes: number;
    peakConcurrency: number;
    deepWorkMinutes: number;
    lightCollabMinutes: number;
  }>;
}

const PROVIDER_DISPLAY: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  antigravity: "Antigravity",
  grok: "Grok",
  opencode: "OpenCode",
};

export function formatProviderName(provider: string): string {
  return PROVIDER_DISPLAY[provider.toLowerCase()] || provider;
}

/**
 * 将底层模型 ID 转为可读的紧凑展示名（例如 claude-opus-4-6 → Claude Opus 4.6）。
 */
export function formatModelDisplayName(model: string | null | undefined, provider: string): string {
  const raw = (model || "").trim();
  if (!raw) return formatProviderName(provider);
  const lower = raw.toLowerCase();
  const claudeMatch = lower.match(/^claude-(opus|sonnet|haiku)-(\d+(?:[.-]\d+)?)/);
  if (claudeMatch) {
    const family = claudeMatch[1][0].toUpperCase() + claudeMatch[1].slice(1);
    return `Claude ${family} ${claudeMatch[2].replace(/-/g, ".")}`;
  }
  const gptMatch = lower.match(/^gpt-([\d.]+)(?:-([a-z0-9]+))?/);
  if (gptMatch) {
    const suffix = gptMatch[2] ? ` ${gptMatch[2][0].toUpperCase()}${gptMatch[2].slice(1)}` : "";
    return `GPT-${gptMatch[1]}${suffix}`;
  }
  const geminiMatch = lower.match(/^gemini-([\d.]+)-([a-z0-9-]+)/);
  if (geminiMatch) {
    const tag = geminiMatch[2]
      .split("-")
      .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
      .join(" ");
    return `Gemini ${geminiMatch[1]} ${tag}`;
  }
  const grokMatch = lower.match(/^grok-([\d.]+)(?:-([a-z0-9-]+))?/);
  if (grokMatch) {
    const tail = grokMatch[2] ? ` ${grokMatch[2]}` : "";
    return `Grok ${grokMatch[1]}${tail}`;
  }
  return raw;
}

export interface ReasoningEffortMeta {
  label: string;
  short: string;
  tier: "low" | "medium" | "high" | "xhigh";
}

export function formatReasoningEffort(
  effort: string | null | undefined,
): ReasoningEffortMeta | null {
  const raw = (effort || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "minimal" || raw === "low" || raw === "fast") {
    return { label: "低推理", short: "Low", tier: "low" };
  }
  if (raw === "medium" || raw === "med" || raw === "normal" || raw === "default") {
    return { label: "中推理", short: "Medium", tier: "medium" };
  }
  if (raw === "high") {
    return { label: "高推理", short: "High", tier: "high" };
  }
  if (raw === "xhigh" || raw === "max" || raw === "ultra" || raw === "extra_high") {
    return { label: "极高推理", short: "xHigh", tier: "xhigh" };
  }
  return { label: raw, short: raw, tier: "medium" };
}

export function isAiCollabSegment(segment: Pick<Segment, "tags">): boolean {
  return Array.isArray(segment.tags) && segment.tags.includes("ai-collab");
}

export function formatMinuteClock(minute: number): string {
  const clamped = Math.max(0, Math.min(1440, Math.round(minute)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function dayEpochBounds(day: string, timeZone: string): [number, number] {
  if (timeZone === "Asia/Shanghai" || timeZone === "Asia/Chongqing" || timeZone === "PRC") {
    const start = Date.parse(`${day}T00:00:00+08:00`);
    return [start, start + 86400_000];
  }
  const approxStart = Date.parse(`${day}T00:00:00Z`);
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.format(new Date(approxStart)).replace(" ", "T");
  const offsetMs = Date.parse(`${parts}Z`) - approxStart;
  const start = approxStart - offsetMs;
  return [start, start + 86400_000];
}

function concurrencyLevel(concurrency: number): 1 | 2 | 3 | 4 {
  if (concurrency >= 5) return 4;
  if (concurrency >= 3) return 3;
  if (concurrency >= 2) return 2;
  return 1;
}

const CLUSTER_MERGE_GAP_MINUTES = 12;

function sessionItemKey(turn: AiTurn): string {
  return [
    (turn.projectLabel || "未标注项目").trim(),
    turn.provider.toLowerCase(),
    (turn.model || "").toLowerCase(),
    (turn.reasoningEffort || "").toLowerCase(),
  ].join("\0");
}

function aggregateSessionItems(
  entries: Array<{ turn: AiTurn; sliceMinutes: number; effRatio: number }>,
): AiBandSessionItem[] {
  const map = new Map<string, AiBandSessionItem>();
  for (const item of entries) {
    const key = sessionItemKey(item.turn);
    const existing = map.get(key);
    const activeMin = item.sliceMinutes * item.effRatio;
    const waitMin = item.sliceMinutes * (1 - item.effRatio);
    if (existing) {
      existing.activeMinutes += activeMin;
      existing.waitHumanMinutes += waitMin;
      existing.toolCallCount += item.turn.toolCallCount;
      existing.subagentCount += item.turn.subagentCount;
      existing.turnCount += 1;
    } else {
      map.set(key, {
        key,
        projectLabel: (item.turn.projectLabel || "未标注项目").trim(),
        provider: item.turn.provider,
        model: item.turn.model,
        reasoningEffort: item.turn.reasoningEffort ?? null,
        activeMinutes: activeMin,
        waitHumanMinutes: waitMin,
        toolCallCount: item.turn.toolCallCount,
        subagentCount: item.turn.subagentCount,
        turnCount: 1,
      });
    }
  }
  return [...map.values()].sort(
    (a, b) => b.activeMinutes - a.activeMinutes || a.projectLabel.localeCompare(b.projectLabel),
  );
}

/**
 * 把区间内的 AI 轮次与触点裁剪到指定自然日（0..1440 分钟），
 * 通过扫描线输出无重叠并发条带，并按时间邻近度聚合为右侧细节栏的 AI 协作簇。
 */
export function sliceAiDay(
  telemetry: AiTelemetryRange | null | undefined,
  day: string,
  timeZone = "Asia/Shanghai",
): AiDaySlice {
  const empty: AiDaySlice = {
    day,
    bands: [],
    clusters: [],
    touchpoints: [],
    alignments: [],
    agentMinutes: 0,
    wallMinutes: 0,
    peakConcurrency: 0,
    leverageRatio: 0,
    turnCount: 0,
    touchpointCount: 0,
    mobileTouchCount: 0,
    byProvider: {},
  };
  if (!telemetry) return empty;

  const [dayStartMs, dayEndMs] = dayEpochBounds(day, timeZone);
  const clipped: Array<{
    turn: AiTurn;
    startMin: number;
    endMin: number;
    effRatio: number;
  }> = [];

  for (const turn of telemetry.turns) {
    const rawStart = Date.parse(turn.startedUtc);
    const rawEnd = Date.parse(turn.endedUtc);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) continue;
    const s = Math.max(rawStart, dayStartMs);
    const e = Math.min(rawEnd, dayEndMs);
    if (e <= s) continue;
    const rawDur = rawEnd - rawStart;
    const effRatio = rawDur > 0 ? Math.min(1, Math.max(0, turn.activeMs / rawDur)) : 1;
    clipped.push({
      turn,
      startMin: (s - dayStartMs) / 60_000,
      endMin: (e - dayStartMs) / 60_000,
      effRatio,
    });
  }

  // 先整理当日触点与自动校对区间，方便同时挂载到 band 与 cluster
  const alignments = telemetry.alignments.filter((a) => a.localDate === day);
  const alignmentRanges = alignments
    .filter((a) => a.status === "applied")
    .map((a) => [
      Math.max(0, (Date.parse(a.startUtc) - dayStartMs) / 60_000),
      Math.min(1440, (Date.parse(a.endUtc) - dayStartMs) / 60_000),
    ] as const);

  const touchpoints: AiDayTouchpoint[] = [];
  let mobileTouchCount = 0;
  for (const tp of telemetry.touchpoints) {
    const ts = Date.parse(tp.occurredUtc);
    if (!Number.isFinite(ts) || ts < dayStartMs || ts >= dayEndMs) continue;
    const minute = (ts - dayStartMs) / 60_000;
    if (tp.deviceOrigin === "mobile") mobileTouchCount += 1;
    touchpoints.push({
      id: tp.id,
      minute,
      timeLabel: formatMinuteClock(minute),
      deviceOrigin: tp.deviceOrigin,
      provider: tp.provider,
      kind: tp.kind,
      clusterId: null,
    });
  }
  touchpoints.sort((a, b) => a.minute - b.minute);

  // 扫描线生成严格不重叠的并发条带
  const points = new Set<number>();
  for (const c of clipped) {
    points.add(c.startMin);
    points.add(c.endMin);
  }
  const sortedPts = [...points].sort((a, b) => a - b);
  const rawBands: Array<AiConcurrencyBand & { _sig: string }> = [];
  let peakConcurrency = 0;
  let wallMinutes = 0;
  let agentMinutes = 0;
  const byProvider: Record<string, number> = {};

  for (const c of clipped) {
    const mins = (c.endMin - c.startMin) * c.effRatio;
    agentMinutes += mins;
    byProvider[c.turn.provider] = (byProvider[c.turn.provider] || 0) + mins;
  }

  for (let i = 0; i < sortedPts.length - 1; i++) {
    const a = sortedPts[i];
    const b = sortedPts[i + 1];
    if (b - a <= 0.01) continue;
    const mid = (a + b) / 2;
    const active = clipped.filter((c) => c.startMin <= mid && c.endMin >= mid);
    if (!active.length) continue;

    const conc = active.length;
    if (conc > peakConcurrency) peakConcurrency = conc;
    wallMinutes += b - a;

    const providers = [...new Set(active.map((x) => x.turn.provider))].sort();
    const models = [...new Set(active.map((x) => x.turn.model).filter((m): m is string => Boolean(m)))].sort();
    const projects = [...new Set(active.map((x) => x.turn.projectLabel).filter((p): p is string => Boolean(p)))].sort();
    const sessions = aggregateSessionItems(
      active.map((x) => ({ turn: x.turn, sliceMinutes: b - a, effRatio: x.effRatio })),
    );
    const sig = sessions.map((s) => `${s.key}:${s.turnCount}`).join("|");
    const bandAgentMin = active.reduce((sum, x) => sum + (b - a) * x.effRatio, 0);
    const bandWaitMin = active.reduce((sum, x) => sum + (b - a) * (1 - x.effRatio), 0);
    const bandToolCalls = active.reduce((sum, x) => sum + x.turn.toolCallCount, 0);

    const prev = rawBands[rawBands.length - 1];
    // 仅当并发度与活跃项目/模型/推理强度组合完全一致时合并相邻短切片，保持悬停精度
    if (
      prev
      && Math.abs(prev.endMinute - a) < 0.25
      && prev.concurrency === conc
      && prev._sig === sig
    ) {
      prev.endMinute = b;
      prev.agentMinutes += bandAgentMin;
      prev.waitHumanMinutes += bandWaitMin;
      for (const s of sessions) {
        const target = prev.sessions.find((item) => item.key === s.key);
        if (target) {
          target.activeMinutes += s.activeMinutes;
          target.waitHumanMinutes += s.waitHumanMinutes;
        }
      }
    } else {
      rawBands.push({
        id: `${day}:${a.toFixed(2)}:${b.toFixed(2)}:${conc}`,
        clusterId: "",
        startMinute: a,
        endMinute: b,
        concurrency: conc,
        level: concurrencyLevel(conc),
        providers,
        models,
        projects,
        sessions,
        turnCount: conc,
        agentMinutes: bandAgentMin,
        waitHumanMinutes: bandWaitMin,
        toolCallCount: bandToolCalls,
        touchpointCount: 0,
        mobileTouchCount: 0,
        _sig: sig,
      });
    }
  }

  // 将连续或间隔 ≤ 12 分钟的并发条带聚合成面向右侧「细节」栏的 AI 协作簇
  const clusters: AiActivityCluster[] = [];
  let bandGroups: Array<typeof rawBands> = [];
  for (const band of rawBands) {
    const lastGroup = bandGroups[bandGroups.length - 1];
    if (lastGroup && band.startMinute - lastGroup[lastGroup.length - 1].endMinute <= CLUSTER_MERGE_GAP_MINUTES) {
      lastGroup.push(band);
    } else {
      bandGroups.push([band]);
    }
  }

  bandGroups.forEach((group, idx) => {
    const startMinute = group[0].startMinute;
    const endMinute = group[group.length - 1].endMinute;
    const clusterId = `${day}:cluster:${idx}`;
    for (const band of group) {
      band.clusterId = clusterId;
      const bandTps = touchpoints.filter((tp) => tp.minute >= band.startMinute - 1 && tp.minute <= band.endMinute + 1);
      band.touchpointCount = bandTps.length;
      band.mobileTouchCount = bandTps.filter((tp) => tp.deviceOrigin === "mobile").length;
    }

    const clusterTurns = clipped.filter((c) => c.endMin > startMinute && c.startMin < endMinute);
    const clusterSessions = aggregateSessionItems(
      clusterTurns.map((c) => ({
        turn: c.turn,
        sliceMinutes: Math.max(0, Math.min(c.endMin, endMinute) - Math.max(c.startMin, startMinute)),
        effRatio: c.effRatio,
      })),
    );
    const clusterTps = touchpoints.filter((tp) => tp.minute >= startMinute - 2 && tp.minute <= endMinute + 2);
    for (const tp of clusterTps) {
      if (tp.clusterId === null) tp.clusterId = clusterId;
    }
    const clusterPeak = group.reduce((m, b) => Math.max(m, b.concurrency), 1);
    const clusterAgent = group.reduce((s, b) => s + b.agentMinutes, 0);
    const clusterWall = group.reduce((s, b) => s + (b.endMinute - b.startMinute), 0);
    const clusterWait = group.reduce((s, b) => s + b.waitHumanMinutes, 0);
    const clusterTools = clusterTurns.reduce((s, c) => s + c.turn.toolCallCount, 0);
    const calibrated = alignmentRanges.some(([as, ae]) => Math.min(endMinute, ae) - Math.max(startMinute, as) >= 5);

    clusters.push({
      id: clusterId,
      startMinute,
      endMinute,
      peakConcurrency: clusterPeak,
      level: concurrencyLevel(clusterPeak),
      agentMinutes: Math.round(clusterAgent * 10) / 10,
      wallMinutes: Math.round(clusterWall * 10) / 10,
      waitHumanMinutes: Math.round(clusterWait * 10) / 10,
      toolCallCount: clusterTools,
      touchpointCount: clusterTps.length,
      mobileTouchCount: clusterTps.filter((tp) => tp.deviceOrigin === "mobile").length,
      bandIds: group.map((b) => b.id),
      sessions: clusterSessions,
      providers: [...new Set(clusterSessions.map((s) => s.provider))].sort(),
      projects: [...new Set(clusterSessions.map((s) => s.projectLabel))],
      calibrated,
    });
  });

  const bands: AiConcurrencyBand[] = rawBands.map(({ _sig: _ignored, ...rest }) => rest);
  const roundedAgent = Math.round(agentMinutes * 10) / 10;
  const roundedWall = Math.round(wallMinutes * 10) / 10;

  return {
    day,
    bands,
    clusters,
    touchpoints,
    alignments,
    agentMinutes: roundedAgent,
    wallMinutes: roundedWall,
    peakConcurrency,
    leverageRatio: roundedWall > 0 ? Math.round((roundedAgent / roundedWall) * 100) / 100 : 0,
    turnCount: clipped.length,
    touchpointCount: touchpoints.length,
    mobileTouchCount,
    byProvider,
  };
}

/**
 * 计算区间内的人机双轨核心指标：深度工作、AI轻度协同、后台放飞、AI算力工时与峰值并发。
 */
export function summarizeAiRange(
  telemetry: AiTelemetryRange | null | undefined,
  days: string[],
  segments: Segment[],
  nowMinute: string,
  nowUtc: string,
  timeZone = "Asia/Shanghai",
): AiRangeMetrics {
  let agentMinutes = 0;
  let wallMinutes = 0;
  let peakConcurrency = 0;
  let turnCount = 0;
  let touchpointCount = 0;
  let mobileTouchCount = 0;
  let deepWorkMinutes = 0;
  let lightCollabMinutes = 0;
  let backgroundCruiseMinutes = 0;
  const providerMap = new Map<string, { agentMinutes: number; turnCount: number }>();

  const perDay = days.map((day) => {
    const aiDay = sliceAiDay(telemetry, day, timeZone);
    agentMinutes += aiDay.agentMinutes;
    wallMinutes += aiDay.wallMinutes;
    if (aiDay.peakConcurrency > peakConcurrency) peakConcurrency = aiDay.peakConcurrency;
    turnCount += aiDay.turnCount;
    touchpointCount += aiDay.touchpointCount;
    mobileTouchCount += aiDay.mobileTouchCount;

    for (const [provider, mins] of Object.entries(aiDay.byProvider)) {
      const entry = providerMap.get(provider) || { agentMinutes: 0, turnCount: 0 };
      entry.agentMinutes += mins;
      providerMap.set(provider, entry);
    }

    let dayDeep = 0;
    let dayLight = 0;
    const nonWorkRanges: Array<[number, number]> = [];

    for (const seg of segments) {
      const cut = sliceSegmentForDay(seg, day, nowMinute, { timeZone, nowUtc });
      if (!cut) continue;
      if (isAiCollabSegment(seg)) {
        dayLight += cut.pure;
      } else if (seg.category.name === "工作" || seg.category.nature === "core") {
        if (seg.category.name === "工作") dayDeep += cut.pure;
      } else {
        nonWorkRanges.push([cut.startMinute, cut.endMinute]);
      }
    }

    // 后台放飞红利：AI 正在运行且对应时段人类处于非工作状态（吃早饭/纯粹休息/睡眠等，未被切为轻度协同）
    for (const band of aiDay.bands) {
      for (const [ns, ne] of nonWorkRanges) {
        const ov = Math.min(band.endMinute, ne) - Math.max(band.startMinute, ns);
        if (ov > 0) backgroundCruiseMinutes += ov;
      }
    }

    deepWorkMinutes += dayDeep;
    lightCollabMinutes += dayLight;

    return {
      date: day,
      agentMinutes: Math.round(aiDay.agentMinutes),
      wallMinutes: Math.round(aiDay.wallMinutes),
      peakConcurrency: aiDay.peakConcurrency,
      deepWorkMinutes: dayDeep,
      lightCollabMinutes: dayLight,
    };
  });

  if (telemetry) {
    for (const t of telemetry.turns) {
      const entry = providerMap.get(t.provider) || { agentMinutes: 0, turnCount: 0 };
      entry.turnCount += 1;
      providerMap.set(t.provider, entry);
    }
  }

  const alignments = telemetry?.alignments || [];
  const roundedAgent = Math.round(agentMinutes);
  const roundedWall = Math.round(wallMinutes);

  return {
    agentMinutes: roundedAgent,
    wallMinutes: roundedWall,
    peakConcurrency,
    leverageRatio: roundedWall > 0 ? Math.round((roundedAgent / roundedWall) * 100) / 100 : 0,
    turnCount,
    touchpointCount,
    mobileTouchCount,
    deepWorkMinutes,
    lightCollabMinutes,
    backgroundCruiseMinutes: Math.round(backgroundCruiseMinutes),
    autoCalibratedCount: alignments.filter((a) => a.status === "applied").length,
    conflictCount: alignments.filter((a) => a.status === "conflict").length,
    byProvider: [...providerMap.entries()]
      .map(([provider, v]) => ({ provider, agentMinutes: Math.round(v.agentMinutes), turnCount: v.turnCount }))
      .sort((a, b) => b.agentMinutes - a.agentMinutes),
    days: perDay,
  };
}
