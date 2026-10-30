/**
 * [INPUT]: 依赖 analytics 输出的今日指标、个人基线与每日自述。
 * [OUTPUT]: 导出 buildGuidance 与 exportSummary；生成可追溯的本机建议。
 * [POS]: server 的建议边界；不调用 AI，不把设备估算当作诊断或饮食处方。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { isNumber } from "./analytics.mjs";

export const SOURCES = [
  {
    label: "CDC · 成人活动指南",
    url: "https://www.cdc.gov/physical-activity-basics/adding-adults/",
  },
  {
    label: "CDC · 成人睡眠",
    url: "https://www.cdc.gov/sleep/about/index.html",
  },
  {
    label: "WHO · 健康饮食",
    url: "https://www.who.int/news-room/fact-sheets/detail/healthy-diet",
  },
];

export function buildGuidance(snapshot) {
  const { latest: day, baseline, checkin, constraints } = snapshot;
  const evidence = [];
  const add = (label, text) => evidence.push({ label, text });
  const cards = [];
  let status = "waiting";
  let title = "先建立你的身体基线";
  let summary =
    "连接 WHOOP 后同步历史记录。今天的有效恢复数据到齐后，这里会给出训练方向。";
  const urgent = checkin?.symptoms?.some((s) =>
    ["胸痛", "静息时呼吸困难", "晕厥"].includes(s),
  );
  const recoveryReady =
    isNumber(day.recovery) &&
    !day.calibrating &&
    day.recoveryState === "SCORED";
  const hrvDelta =
    baseline.hrv.count >= 14 && baseline.hrv.value > 0 && isNumber(day.hrv)
      ? (day.hrv / baseline.hrv.value - 1) * 100
      : null;
  const rhrDelta =
    baseline.rhr.count >= 14 && isNumber(day.rhr)
      ? day.rhr - baseline.rhr.value
      : null;
  if (isNumber(day.recovery))
    add(
      "恢复",
      `今日恢复 ${Math.round(day.recovery)}%${day.calibrating ? "，设备仍在校准" : ""}`,
    );
  if (isNumber(day.sleepHours))
    add("睡眠", `昨夜实际睡眠 ${day.sleepHours.toFixed(1)} 小时`);
  if (hrvDelta !== null)
    add(
      "HRV",
      `相对前 28 天均值 ${hrvDelta >= 0 ? "+" : ""}${Math.round(hrvDelta)}%（${baseline.hrv.count} 次）`,
    );
  if (rhrDelta !== null)
    add(
      "静息心率",
      `相对前 28 天均值 ${rhrDelta >= 0 ? "+" : ""}${rhrDelta.toFixed(1)} bpm`,
    );
  if (urgent) {
    status = "urgent";
    title = "暂停训练，立即寻求医疗帮助";
    summary =
      "你记录了胸痛、静息时呼吸困难或晕厥。请联系当地急救服务，症状不能由手环分数排除。";
  } else if (
    checkin?.symptoms?.includes("发热") ||
    (checkin?.soreness ?? 0) >= 7 ||
    checkin?.energy === 1
  ) {
    status = "rest";
    title = "今天把恢复放在第一位";
    summary =
      "你的主观记录提示身体不适或明显疲劳。先暂停高强度训练，依据症状寻求专业评估。";
  } else if (recoveryReady) {
    if (
      day.recovery < 34 ||
      (hrvDelta !== null &&
        rhrDelta !== null &&
        hrvDelta < -15 &&
        rhrDelta >= 5) ||
      (isNumber(day.sleepHours) && day.sleepHours < 6)
    ) {
      status = "rest";
      title = "降低负荷，留出恢复空间";
      summary =
        "今天至少有一个恢复信号偏弱。若没有不适，可从 10–20 分钟轻松步行和温和活动开始，取消冲刺与力竭训练。";
    } else if (day.recovery < 67 || (checkin?.energy ?? 3) <= 2) {
      status = "steady";
      title = "保持节奏，把强度留一点";
      summary =
        "今天适合保守推进。若身体无不适，可尝试 20–30 分钟能轻松交谈的活动，疲劳上升就缩短。";
    } else {
      status = "ready";
      title = "状态可用，循序推进";
      summary =
        "恢复分数较好。先热身，再按平时能完成的负荷训练；重新开始运动时，可从 20–30 分钟轻至中等强度活动起步。";
    }
  } else if (day.calibrating) {
    title = "设备仍在校准，先观察趋势";
    summary =
      "暂不根据恢复分数增加训练。保持熟悉的轻量活动，补充主观感受记录。";
  }
  cards.push({
    kind: "training",
    label: "运动安排",
    title: urgent
      ? "暂停运动"
      : status === "waiting"
        ? "从熟悉的轻量活动开始"
        : status === "rest"
          ? "减少负荷，避免力竭"
          : "把可持续放在强度之前",
    text: urgent
      ? summary
      : summary +
        (constraints
          ? " 你已填写身体限制，请以专业人员允许的活动范围为准。"
          : ""),
  });
  const sleepText =
    isNumber(day.sleepHours) && day.sleepHours < 7
      ? `昨夜实际睡眠 ${day.sleepHours.toFixed(1)} 小时。今晚尽量提前 30 分钟上床，保持固定起床时间；多数成年人每天需至少 7 小时睡眠。`
      : "固定睡觉和起床时间，为睡眠留足时间。多数成年人每天需至少 7 小时；若白天持续嗜睡，建议进一步评估。";
  cards.push({
    kind: "sleep",
    label: "睡眠恢复",
    title:
      isNumber(day.sleepHours) && day.sleepHours < 7
        ? "今晚多留一点睡眠时间"
        : "用规律作息巩固恢复",
    text: sleepText,
  });
  cards.push({
    kind: "nutrition",
    label: "饮食方向",
    title: "先吃规律，再谈精细调整",
    text: "规律进餐，搭配蔬菜、水果、全谷物和蛋白质来源，活动后按口渴与出汗情况补水。WHOOP 消耗是估算值，不能直接换算为进食目标；当前缺少饮食总量与体重趋势，不制定热量缺口或补剂方案。",
  });
  return {
    engine: "本机规则 · v1",
    status,
    title,
    summary,
    evidence,
    cards,
    sources: SOURCES,
    limits:
      "用于成年人日常趋势参考，不诊断疾病。训练还需结合症状、既往疾病和运动经历。",
    rules:
      "本机启发式：恢复 <34% 或睡眠 <6h 时降低负荷；HRV 低于个人均值 15% 且静息心率高 5 bpm 时降低负荷。基线至少需要 14 次有效记录；阈值不是医学诊断标准。",
  };
}

export function exportSummary(snapshot) {
  const fields = [
    "date",
    "recovery",
    "hrv",
    "rhr",
    "sleepHours",
    "sleepPerformance",
    "strain",
    "respiratoryRate",
    "calibrating",
  ];
  return {
    schema: "lifeos.health-summary.v1",
    generatedAt: new Date().toISOString(),
    purpose: "提升体能与恢复；供用户选择的 AI 服务读取，建议不得替代诊疗。",
    goal: snapshot.goal,
    experience: snapshot.experience,
    today: snapshot.today,
    baseline: snapshot.baseline,
    weekly: snapshot.weekly,
    days: snapshot.days
      .slice(-28)
      .map((d) =>
        Object.fromEntries(fields.map((key) => [key, d[key] ?? null])),
      ),
    currentCheckin: snapshot.checkin
      ? {
          energy: snapshot.checkin.energy,
          soreness: snapshot.checkin.soreness,
          symptoms: snapshot.checkin.symptoms,
        }
      : null,
    missing: ["未接入膳食营养总量", "未接入病历", "未接入连续实时心率"],
  };
}
