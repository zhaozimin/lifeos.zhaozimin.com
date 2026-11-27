/**
 * [INPUT]: 依赖基准日期、时间偏移与随机 UUID 生成器。
 * [OUTPUT]: 对外提供本地 UI 演示用的 21 天合成 Orca AI 轮次、本机/手机触点及纯人类完整时间段（休息/放松绝不因 AI 交互而被切分）。
 * [POS]: preview/ 的 AI 双轨合成数据模块；数据 100% 脱敏合成，不读取本机真实 Orca SQLite。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { randomUUID } from "node:crypto";
import type { AiAlignment, AiTelemetryRange, AiTouchpoint, AiTurn } from "../src/dashboard/types";

export interface DemoAiDataset {
  turns: AiTurn[];
  touchpoints: AiTouchpoint[];
  alignments: AiAlignment[];
  sliceRange: (from: string, to: string) => AiTelemetryRange;
}

function shanghaiIso(day: string, minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return new Date(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+08:00`).toISOString();
}

/**
 * 为指定演示日生成纯人类完整时间段（工作只计深度工作；休息/放松即使期间与 AI 交互也保持一整段独立记录）。
 */
export function buildDemoDayTimeRows(
  day: string,
  offset: number,
  nowMs: number,
): Array<{
  startMin: number;
  endMin: number;
  categoryId: number;
  activity: string;
  project: string | null;
  note: string;
  tags: string[];
  source: string;
}> {
  const rows: Array<{
    startMin: number;
    endMin: number;
    categoryId: number;
    activity: string;
    project: string | null;
    note: string;
    tags: string[];
    source: string;
  }> = [
    { startMin: 0, endMin: 420, categoryId: 5, activity: "夜间睡眠", project: null, note: "合成演示记录", tags: [], source: "web" },
    { startMin: 420, endMin: 480, categoryId: 4, activity: "早餐与准备", project: null, note: "合成演示记录 · 期间 AI 独立运行", tags: [], source: "web" },
    { startMin: 480, endMin: 600, categoryId: 1, activity: "撰写方案", project: "LifeOS演示项目", note: "合成演示记录 · 深度工作", tags: [], source: "web" },
    // 10:00–11:00 整段休息：即便期间与 AI 交互，也保持一整段独立休息，不被拆段
    { startMin: 600, endMin: 660, categoryId: 7, activity: "休息", project: null, note: "合成演示记录 · 整段休息（与 AI 独立并行）", tags: [], source: "web" },
    { startMin: 660, endMin: 720, categoryId: 3, activity: "日常事务", project: null, note: "合成演示记录", tags: [], source: "web" },
    { startMin: 720, endMin: 780, categoryId: 4, activity: "午餐", project: null, note: "合成演示记录", tags: [], source: "web" },
    { startMin: 780, endMin: 900, categoryId: 1, activity: "项目开发", project: "LifeOS演示项目", note: "合成演示记录 · 深度工作 + AI 高并发", tags: [], source: "web" },
    { startMin: 900, endMin: 960, categoryId: 6, activity: "散步与训练", project: null, note: "合成演示记录", tags: [], source: "web" },
    { startMin: 960, endMin: 1080, categoryId: 1, activity: "整理项目", project: "LifeOS演示项目", note: "合成演示记录 · 深度工作", tags: [], source: "web" },
    { startMin: 1080, endMin: 1140, categoryId: 4, activity: "晚餐", project: null, note: "合成演示记录", tags: [], source: "web" },
    // 19:00–21:00 整段放松：即便期间手机遥控 AI，也保持一整段独立记录
    { startMin: 1140, endMin: 1260, categoryId: 8, activity: "手机与放松", project: null, note: "合成演示记录 · 整段放松（与 AI 独立并行）", tags: [], source: "web" },
  ];

  return rows.filter((row) => !(offset === 0 && Date.parse(shanghaiIso(day, row.startMin)) > nowMs));
}

/**
 * 构建 21 天合成 Orca AI 遥测数据集，覆盖后台放飞、心流高并发峰值、本机+手机轻度协同与自动校对。
 */
export function buildDemoAiDataset(anchorDay: string, nowMs = Date.now()): DemoAiDataset {
  const turns: AiTurn[] = [];
  const touchpoints: AiTouchpoint[] = [];
  const alignments: AiAlignment[] = [];

  for (let offset = 20; offset >= 0; offset--) {
    const day = new Date(Date.parse(`${anchorDay}T12:00:00Z`) - offset * 864e5).toISOString().slice(0, 10);
    const highBurst = offset % 3 === 1;

    const dayTurns: Array<{
      startMin: number;
      endMin: number;
      provider: string;
      model: string;
      effort: string;
      project: string;
      waitMin?: number;
    }> = [
      // 07:12–07:50 早餐后台放飞（2×，无人类触点，不切分饮食）
      { startMin: 432, endMin: 468, provider: "claude", model: "claude-sonnet-4-6", effort: "medium", project: "演示内容工厂" },
      { startMin: 438, endMin: 472, provider: "codex", model: "gpt-5.3-codex", effort: "high", project: "LifeOS演示项目" },
      // 08:06–09:54 上午心流高并发（3–5×，多项目多模型不同推理强度）
      { startMin: 486, endMin: 562, provider: "claude", model: "claude-opus-4-6", effort: "high", project: "LifeOS演示项目" },
      { startMin: 492, endMin: 578, provider: "codex", model: "gpt-5.3-codex", effort: "xhigh", project: "演示引擎内核" },
      { startMin: 504, endMin: 586, provider: "antigravity", model: "gemini-3.1-pro", effort: "medium", project: "演示前端重构" },
      { startMin: 518, endMin: 556, provider: "claude", model: "claude-sonnet-4-6", effort: "low", project: "演示内容工厂", waitMin: 4 },
      ...(highBurst
        ? [{ startMin: 520, endMin: 552, provider: "grok", model: "grok-4", effort: "high", project: "演示调研" }]
        : []),
      // 10:14–10:50 上午休息中轻度协同审核（3 项目 × 3 模型）
      { startMin: 614, endMin: 649, provider: "claude", model: "claude-opus-4-6", effort: "high", project: "LifeOS演示项目" },
      { startMin: 618, endMin: 646, provider: "codex", model: "gpt-5.3-codex", effort: "xhigh", project: "演示前端重构" },
      { startMin: 626, endMin: 644, provider: "antigravity", model: "gemini-3.1-pro", effort: "medium", project: "演示内容工厂" },
      // 13:12–14:52 下午高峰并发（5–7×，触发朱色 5+× 峰值条带）
      { startMin: 792, endMin: 884, provider: "claude", model: "claude-opus-4-6", effort: "xhigh", project: "LifeOS演示项目" },
      { startMin: 796, endMin: 876, provider: "codex", model: "gpt-5.3-codex", effort: "high", project: "演示引擎内核" },
      { startMin: 804, endMin: 868, provider: "antigravity", model: "gemini-3.1-pro", effort: "xhigh", project: "演示前端重构" },
      { startMin: 810, endMin: 862, provider: "claude", model: "claude-sonnet-4-6", effort: "medium", project: "演示自动化" },
      { startMin: 816, endMin: 854, provider: "grok", model: "grok-4", effort: "high", project: "演示测试套件" },
      ...(highBurst
        ? [
            { startMin: 820, endMin: 850, provider: "antigravity", model: "gemini-3.1-flash", effort: "low", project: "演示文档站" },
            { startMin: 824, endMin: 848, provider: "codex", model: "gpt-5.3-codex", effort: "medium", project: "演示调研" },
          ]
        : []),
      // 16:15–17:42 傍晚收尾（2×）
      { startMin: 975, endMin: 1052, provider: "claude", model: "claude-sonnet-4-6", effort: "medium", project: "LifeOS演示项目" },
      { startMin: 990, endMin: 1060, provider: "antigravity", model: "gemini-3.1-pro", effort: "high", project: "演示文档站" },
      // 20:06–20:36 晚间手机遥控轻度协同（偶数偏移日）
      ...(offset % 2 === 0
        ? [
            { startMin: 1206, endMin: 1236, provider: "claude", model: "claude-sonnet-4-6", effort: "medium", project: "演示自动化" },
            { startMin: 1212, endMin: 1234, provider: "antigravity", model: "gemini-3.1-pro", effort: "high", project: "演示前端重构" },
          ]
        : []),
    ];

    dayTurns.forEach((t, idx) => {
      const startIso = shanghaiIso(day, t.startMin);
      const endIso = shanghaiIso(day, t.endMin);
      if (offset === 0 && Date.parse(startIso) > nowMs) return;
      const clippedEndMs = offset === 0 ? Math.min(Date.parse(endIso), nowMs) : Date.parse(endIso);
      const rawMs = Math.max(60_000, clippedEndMs - Date.parse(startIso));
      const waitMs = Math.min(rawMs - 60_000, (t.waitMin || 0) * 60_000);
      turns.push({
        id: randomUUID(),
        source: "orca_native",
        provider: t.provider,
        sessionKey: `demo-sess-${day}-${idx % 4}`,
        model: t.model,
        reasoningEffort: t.effort,
        projectLabel: t.project,
        startedUtc: startIso,
        endedUtc: new Date(Date.parse(startIso) + rawMs).toISOString(),
        activeMs: Math.max(60_000, rawMs - waitMs),
        waitHumanMs: waitMs,
        toolCallCount: 4 + (idx % 7),
        subagentCount: idx % 3 === 0 ? 1 : 0,
        outcome: "completed",
      });
    });

    const dayTouchpoints: Array<{ min: number; origin: "host" | "mobile"; provider: string }> = [
      { min: 486, origin: "host", provider: "claude" },
      { min: 518, origin: "host", provider: "codex" },
      { min: 548, origin: "host", provider: "antigravity" },
      // 10:14–10:48 四次审核触点（触发自动切分）
      { min: 614, origin: "host", provider: "claude" },
      { min: 626, origin: "host", provider: "codex" },
      { min: 638, origin: "mobile", provider: "antigravity" },
      { min: 648, origin: "host", provider: "claude" },
      // 下午深度开发
      { min: 792, origin: "host", provider: "claude" },
      { min: 816, origin: "host", provider: "codex" },
      { min: 844, origin: "host", provider: "antigravity" },
      { min: 975, origin: "host", provider: "claude" },
      // 晚间手机遥控
      ...(offset % 2 === 0
        ? [
            { min: 1206, origin: "mobile" as const, provider: "claude" },
            { min: 1219, origin: "mobile" as const, provider: "antigravity" },
            { min: 1234, origin: "mobile" as const, provider: "claude" },
          ]
        : []),
    ];

    dayTouchpoints.forEach((tp, idx) => {
      const iso = shanghaiIso(day, tp.min);
      if (offset === 0 && Date.parse(iso) > nowMs) return;
      touchpoints.push({
        id: randomUUID(),
        provider: tp.provider,
        sessionKey: `demo-sess-${day}-${idx % 4}`,
        kind: "user_prompt",
        deviceOrigin: tp.origin,
        occurredUtc: iso,
      });
    });
  }

  return {
    turns,
    touchpoints,
    alignments,
    sliceRange(from: string, to: string) {
      const fromMs = Date.parse(`${from}T00:00:00+08:00`);
      const toMs = Date.parse(`${to}T00:00:00+08:00`) + 864e5;
      return {
        from,
        to,
        turns: turns.filter((t) => {
          const s = Date.parse(t.startedUtc);
          const e = Date.parse(t.endedUtc);
          return e > fromMs && s < toMs;
        }),
        touchpoints: touchpoints.filter((tp) => {
          const ts = Date.parse(tp.occurredUtc);
          return ts >= fromMs && ts < toMs;
        }),
        alignments: alignments.filter((a) => a.localDate >= from && a.localDate <= to),
      };
    },
  };
}
