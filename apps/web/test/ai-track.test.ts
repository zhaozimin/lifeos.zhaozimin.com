/**
 * [INPUT]: 依赖 node:test、aiTrack 纯计算函数、preview 内存库与 worker/native 路由。
 * [OUTPUT]: 验证 AI 并发扫描线切片、后台放飞统计、心流/轻度协同拆分与 /v1/time/ai 本地预览端到端契约。
 * [POS]: apps/web/test 的 AI 双轨专项测试。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  formatModelDisplayName,
  formatReasoningEffort,
  isAiCollabSegment,
  sliceAiDay,
  summarizeAiRange,
} from "../src/dashboard/lib/aiTrack";
import { placeVariableCallouts } from "../src/dashboard/lib/timelineCallouts";
import type { AiTelemetryRange, Segment } from "../src/dashboard/types";
import { demoDatabase } from "../preview/database";
import { native } from "../worker/native";

function makeSegment(partial: Partial<Segment> & { id: string; startedAt: string; endedAt: string; categoryName: string; nature: Segment["category"]["nature"] }): Segment {
  const { categoryName, nature, ...rest } = partial;
  return {
    title: "测试时段",
    category: { name: categoryName, nature },
    projectName: null,
    startedUtc: new Date(`${partial.startedAt}:00+08:00`).toISOString(),
    endedUtc: new Date(`${partial.endedAt}:00+08:00`).toISOString(),
    createdAt: new Date(`${partial.startedAt}:00+08:00`).toISOString(),
    updatedAt: new Date(`${partial.endedAt}:00+08:00`).toISOString(),
    deletedAt: null,
    deductionMinutes: 0,
    deductionNote: null,
    note: null,
    tags: [],
    source: "manual",
    revision: 1,
    grossMinutes: 60,
    pureMinutes: 60,
    ...rest,
  };
}

test("sliceAiDay 扫描线合并并发带并扣减等待死时间", () => {
  const telemetry: AiTelemetryRange = {
    from: "2026-11-21",
    to: "2026-11-21",
    turns: [
      {
        id: "t1",
        source: "orca_native",
        provider: "claude",
        sessionKey: "s1",
        model: "claude-opus-4-6",
        projectLabel: "LifeOS",
        startedUtc: "2026-11-21T08:00:00+08:00",
        endedUtc: "2026-11-21T08:30:00+08:00",
        activeMs: 30 * 60_000,
        waitHumanMs: 0,
        toolCallCount: 5,
        subagentCount: 0,
        outcome: "completed",
      },
      {
        id: "t2",
        source: "orca_native",
        provider: "codex",
        sessionKey: "s2",
        model: "gpt-5.3-codex",
        projectLabel: "LifeOS",
        startedUtc: "2026-11-21T08:10:00+08:00",
        endedUtc: "2026-11-21T08:40:00+08:00",
        activeMs: 15 * 60_000, // 30m 墙钟里 15m 有效、15m 等待审批
        waitHumanMs: 15 * 60_000,
        toolCallCount: 4,
        subagentCount: 0,
        outcome: "completed",
      },
    ],
    touchpoints: [
      {
        id: "tp1",
        provider: "claude",
        sessionKey: "s1",
        kind: "user_prompt",
        deviceOrigin: "host",
        occurredUtc: "2026-11-21T08:00:00+08:00",
      },
      {
        id: "tp2",
        provider: "codex",
        sessionKey: "s2",
        kind: "user_prompt",
        deviceOrigin: "mobile",
        occurredUtc: "2026-11-21T08:12:00+08:00",
      },
    ],
    alignments: [],
  };

  const day = sliceAiDay(telemetry, "2026-11-21", "Asia/Shanghai");
  assert.equal(day.peakConcurrency, 2);
  assert.equal(day.wallMinutes, 40);
  assert.equal(day.agentMinutes, 45);
  assert.equal(day.bands.length, 3);
  assert.equal(day.bands[1].concurrency, 2);
  assert.equal(day.bands[1].level, 2);
  assert.equal(day.touchpointCount, 2);
  assert.equal(day.mobileTouchCount, 1);
});

test("summarizeAiRange 正确拆分心流深度、AI轻度协同与后台放飞红利", () => {
  const telemetry: AiTelemetryRange = {
    from: "2026-11-21",
    to: "2026-11-21",
    turns: [
      {
        id: "t-cruise",
        source: "orca_native",
        provider: "claude",
        sessionKey: "sc",
        model: "claude-sonnet-4-6",
        projectLabel: "Demo",
        startedUtc: "2026-11-21T07:10:00+08:00",
        endedUtc: "2026-11-21T07:40:00+08:00",
        activeMs: 30 * 60_000,
        waitHumanMs: 0,
        toolCallCount: 3,
        subagentCount: 0,
        outcome: "completed",
      },
      {
        id: "t-collab",
        source: "orca_native",
        provider: "codex",
        sessionKey: "sl",
        model: "gpt-5.3-codex",
        projectLabel: "Demo",
        startedUtc: "2026-11-21T10:15:00+08:00",
        endedUtc: "2026-11-21T10:45:00+08:00",
        activeMs: 30 * 60_000,
        waitHumanMs: 0,
        toolCallCount: 3,
        subagentCount: 0,
        outcome: "completed",
      },
    ],
    touchpoints: [],
    alignments: [
      {
        clusterKey: "c1",
        localDate: "2026-11-21",
        status: "applied",
        startUtc: "2026-11-21T10:12:00+08:00",
        endUtc: "2026-11-21T10:48:00+08:00",
        touchpointCount: 3,
        mobileTouchCount: 1,
        peakConcurrency: 2,
        agentMinutes: 30,
        reason: null,
      },
    ],
  };

  const segments: Segment[] = [
    makeSegment({ id: "s1", startedAt: "2026-11-21T07:00", endedAt: "2026-11-21T08:00", categoryName: "饮食", nature: "recovery" }),
    makeSegment({ id: "s2", startedAt: "2026-11-21T08:00", endedAt: "2026-11-21T10:00", categoryName: "工作", nature: "core", grossMinutes: 120, pureMinutes: 120 }),
    makeSegment({
      id: "s3",
      startedAt: "2026-11-21T10:12",
      endedAt: "2026-11-21T10:48",
      categoryName: "工作",
      nature: "core",
      tags: ["ai-collab", "orca-auto"],
      source: "device",
      grossMinutes: 36,
      pureMinutes: 36,
    }),
  ];

  assert.equal(isAiCollabSegment(segments[1]), false);
  assert.equal(isAiCollabSegment(segments[2]), true);

  const metrics = summarizeAiRange(
    telemetry,
    ["2026-11-21"],
    segments,
    "2026-11-21T23:59",
    "2026-11-21T15:59:00Z",
    "Asia/Shanghai",
  );
  assert.equal(metrics.deepWorkMinutes, 120);
  assert.equal(metrics.lightCollabMinutes, 36);
  assert.equal(metrics.backgroundCruiseMinutes, 30);
  assert.equal(metrics.autoCalibratedCount, 1);
});

test("preview 内存库与 worker/native 正确提供独立 /v1/time/ai 且不拆切人类休息段", async () => {
  const { client } = demoDatabase();
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const aiRes = await native(client, {
    method: "GET",
    path: "/v1/time/ai",
    params: { from: yesterday, to: yesterday },
  }) as AiTelemetryRange;
  assert.ok(aiRes.turns.length >= 10, "演示库应包含合成 Orca AI 轮次");
  assert.ok(aiRes.touchpoints.length >= 6, "演示库应包含本机与手机触点");
  assert.equal(aiRes.alignments.length, 0, "独立双轨演示不再自动拆切人类时间段");

  const sumRes = await native(client, {
    method: "GET",
    path: "/v1/time/summary/range",
    params: { from: yesterday, to: yesterday },
  }) as { effectiveWorkMinutes: number; deepWorkMinutes: number; lightCollabMinutes: number };
  assert.equal(sumRes.lightCollabMinutes, 0, "休息保持整段，不再计入 AI 轻度协同");
  assert.equal(sumRes.deepWorkMinutes, sumRes.effectiveWorkMinutes);
  assert.ok(aiRes.turns.some((t) => Boolean(t.reasoningEffort)), "演示轮次应附带推理强度");
});

test("sliceAiDay 聚合协作簇与逐项目模型/推理强度，并校验可变高度细节栏无重叠排布", () => {
  assert.equal(formatModelDisplayName("claude-opus-4-6", "claude"), "Claude Opus 4.6");
  assert.equal(formatModelDisplayName("gpt-5.3-codex", "codex"), "GPT-5.3 Codex");
  assert.equal(formatModelDisplayName("gemini-3.1-pro", "antigravity"), "Gemini 3.1 Pro");
  assert.equal(formatReasoningEffort("xhigh")?.label, "极高推理");
  assert.equal(formatReasoningEffort("high")?.tier, "high");
  assert.equal(formatReasoningEffort(null), null);

  const { client } = demoDatabase();
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  return native(client, {
    method: "GET",
    path: "/v1/time/ai",
    params: { from: yesterday, to: yesterday },
  }).then((aiRes) => {
    const daySlice = sliceAiDay(aiRes as AiTelemetryRange, yesterday, "Asia/Shanghai");
    assert.ok(daySlice.clusters.length >= 4, "单日演示数据应聚合出多个 AI 协作簇");
    const multiCluster = daySlice.clusters.find((c) => c.sessions.length >= 3);
    assert.ok(multiCluster, "应存在包含 ≥3 并发项目/模型的协作簇");
    assert.ok(
      multiCluster.sessions.every((s) => Boolean(s.model) && Boolean(s.reasoningEffort)),
      "协作簇内每个项目条目应带模型与推理强度",
    );

    const placements = placeVariableCallouts(
      [
        { id: "a", startMinute: 600, endMinute: 620, height: 96 },
        { id: "b", startMinute: 615, endMinute: 645, height: 110 },
        { id: "c", startMinute: 650, endMinute: 660, height: 30 },
      ],
      { pixelsPerMinute: 0.6, canvasHeight: 864, labelGap: 6 },
    );
    assert.equal(placements.length, 3);
    assert.ok(placements[1].labelY >= placements[0].labelY + placements[0].height + 6);
    assert.ok(placements[2].labelY >= placements[1].labelY + placements[1].height + 6);
    assert.ok(placements[2].labelY + placements[2].height <= 864);
  });
});

