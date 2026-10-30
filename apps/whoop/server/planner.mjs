/**
 * [INPUT]: 依赖当天快照、恢复规则、日程与本次同步凭据。
 * [OUTPUT]: 导出当天训练报告、等待状态和 Markdown。
 * [POS]: server 的纯报告引擎；同步或评分未完成时不发布训练剂量。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { buildGuidance, SOURCES } from "./guidance.mjs";
import { isNumber } from "./analytics.mjs";
import { clockMinutes, clockText, reportPreferences } from "./calendar.mjs";

function meals(preferences, date) {
  if (preferences.foodRestrictions.trim()) return [
    { name: "早餐", text: "从已确认可吃的食物中搭配主食、蛋白质和水果；按你填写的忌口替换食材。" },
    { name: "午餐", text: "选择已确认可吃的蔬菜、主食和蛋白质来源。当前规则不能核对复杂忌口，请先确认食材。" },
    { name: "晚餐", text: "规律进餐，选择符合忌口的熟悉食物；睡前避免大量进食和饮酒。" },
  ];
  const variant = Math.floor(Date.parse(`${date}T12:00Z`) / 86400000) % 3;
  const vegetarian = preferences.diet === "纯素" || preferences.diet === "蛋奶素";
  const vegan = preferences.diet === "纯素";
  const breakfasts = vegan
    ? ["燕麦粥＋无糖豆浆＋香蕉", "全麦面包＋豆腐炒蔬菜＋橙子", "杂粮粥＋豆干＋苹果"]
    : ["燕麦＋牛奶或无糖豆浆＋鸡蛋＋水果", "全麦面包＋鸡蛋＋番茄＋原味酸奶", "杂粮粥＋鸡蛋或豆干＋一份水果"];
  const lunches = vegetarian
    ? ["糙米饭＋豆腐＋西兰花与胡萝卜", "杂粮饭＋鹰嘴豆＋炒青菜", "全麦面条＋豆干＋蘑菇与绿叶菜"]
    : ["糙米饭＋鸡肉或豆腐＋西兰花与胡萝卜", "杂粮饭＋鱼或豆腐＋两种时蔬", "全麦面条＋瘦肉或豆干＋蘑菇与绿叶菜"];
  const dinners = vegetarian
    ? ["红薯＋扁豆蔬菜汤", "杂粮饭＋豆腐＋两种熟蔬菜", "土豆＋豆干＋蘑菇青菜"]
    : ["红薯＋鱼或豆腐＋绿叶菜", "杂粮饭＋鸡肉或扁豆＋两种熟蔬菜", "土豆＋瘦肉或豆干＋蘑菇青菜"];
  return [
    { name: "早餐", text: breakfasts[variant] },
    { name: "午餐", text: lunches[variant] },
    { name: "晚餐", text: dinners[variant] },
  ];
}

function training(snapshot, status, targetDate) {
  if (status === "urgent") return { mode: "暂停运动", minutes: 0,
    steps: ["你记录了胸痛、静息时呼吸困难或晕厥，请立即联系当地急救服务。不要等待手环评分。"],
    adjustment: "症状优先于恢复分数，先接受医疗评估。" };
  const restrictions = snapshot.constraints && snapshot.constraints !== "无";
  if (restrictions) return { mode: "先确认活动范围", minutes: null,
    steps: ["你填写了身体限制。规则引擎无法解释医嘱；只安排已获允许的熟悉轻量活动，不自动开具动作清单。"],
    adjustment: "先在接入设置核对限制，并以医生或康复师给出的范围为准。" };
  if (status === "rest" || status === "waiting") return { mode: "恢复与轻量活动", minutes: 15,
    steps: ["无发热、疼痛或其他不适时，轻松步行 10–20 分钟；疲劳时缩短或休息。", "用 5 分钟做舒适范围的关节活动，取消冲刺和力竭训练。"],
    adjustment: "晨起仍疲惫、发热或酸痛明显时，休息；数据缺失时不增加负荷。" };
  const strengthDay = [2, 5].includes(new Date(`${targetDate}T12:00Z`).getUTCDay());
  if (status === "ready" && strengthDay) return { mode: "轻量全身力量", minutes: 25,
    steps: ["先热身 5 分钟，再做坐站起、墙壁俯卧撑和轻阻力划船。", "每项 1–2 组，每组 8–12 次，保留余力；只做熟悉且无痛的动作。", "组间充分休息，以动作稳定为准，不追求大重量。"],
    adjustment: "今天恢复偏低或主观疲劳时，改为轻松步行或休息；动作引起疼痛就停止。" };
  return { mode: "轻至中等强度有氧", minutes: status === "steady" ? 20 : 30,
    steps: ["热身 5 分钟；选择步行或熟悉的自行车活动。", `主体活动 ${status === "steady" ? "15–20" : "20–30"} 分钟，以可以完整交谈为准，结束后放松 5 分钟。`,
      snapshot.weekly.workouts === 0 ? "近 7 天没有已记录训练，先恢复习惯，不用补课式加量。" : "沿用近期能舒适完成的负荷，不因单日高分突然加量。"],
    adjustment: "今天出现低恢复、明显疲惫或不适时，缩短为轻松步行或休息。" };
}

export function buildPlan(snapshot, { targetDate, now = new Date(), settings = {}, sync = null, refresh = null, trigger = "manual", slot = null } = {}) {
  const preferences = reportPreferences(settings);
  const day = snapshot.latest.timestamp ? snapshot.latest :
    snapshot.days.filter((d) => d.timestamp && new Date(d.timestamp) <= now).at(-1) || snapshot.latest;
  const currentDay = day.date === targetDate;
  const guidance = buildGuidance({ ...snapshot, latest: day });
  const evidence = guidance.evidence.map((e) => {
    const text = ["HRV", "静息心率"].includes(e.label) ? `${e.label} ${e.text}` : e.text;
    return { ...e, text: currentDay ? text : `${day.date} · ${text.replace("今日", "最近一次").replace("昨夜", "该次主睡眠")}` };
  });
  if (isNumber(snapshot.averages.sleepHours.value)) evidence.push({ label: "睡眠趋势",
    text: `近 7 天平均睡眠 ${snapshot.averages.sleepHours.value.toFixed(1)} 小时（${snapshot.averages.sleepHours.count} 次）` });
  const ageMs = day.timestamp ? now - new Date(day.timestamp) : Infinity;
  const fresh = currentDay && day.recoveryState === "SCORED" && !day.calibrating && isNumber(day.recovery) &&
    day.sleepState === "SCORED" && isNumber(day.sleepHours) && ageMs >= 0 && ageMs <= 36 * 3600000;
  const synced = refresh?.succeeded === true && Number.isFinite(Date.parse(refresh.finishedAt)) &&
    Date.parse(refresh.finishedAt) >= Date.parse(refresh.startedAt) && Date.parse(refresh.finishedAt) <= now.getTime();
  const reason = !synced ? refresh?.reason || "sync-required" : !fresh ? "pending-score" : null;
  const publication = {
    state: synced && fresh ? trigger === "preview" ? "preview" : "published" : "waiting",
    reason, refresh,
    message: !synced ? refresh?.reason === "disconnected" ? "WHOOP 未连接，重新连接并同步成功后再发布今日训练。" :
      "最新同步尚未成功，暂不发布今日训练；服务会自动重试。" :
      !fresh ? "当天睡眠和恢复尚未评分完成，暂不发布训练剂量；服务会每 5 分钟重新同步。" :
        trigger === "preview" ? "晨间预览：本次已同步；正式发布时间会再同步并更新。" : "已先同步 WHOOP，再依据当天已评分的睡眠与恢复发布。",
  };
  const status = guidance.status === "urgent" ? "urgent" : publication.state === "waiting" ? "waiting" : guidance.status;
  const shortSleep = isNumber(day.sleepHours) && day.sleepHours < 7;
  const opportunityHours = shortSleep ? 8.5 : 8;
  const wakeMinutes = clockMinutes(preferences.wakeTime);
  const bedMinutes = wakeMinutes - opportunityHours * 60;
  const exercise = status === "waiting" ? { mode: "等待最新数据后发布训练", minutes: null,
    steps: [publication.message, "醒来后让手环先同步到 WHOOP，等待当天睡眠与恢复评分。", "评分未到前不依据昨日分数增加负荷。"],
    adjustment: "训练发布后仍结合今天的精力、酸痛和身体不适调整。" } : training(snapshot, status, targetDate);
  const missing = [];
  if (!fresh) missing.push("当天有效睡眠和恢复数据不齐、校准中或超过 36 小时；不发布训练剂量。");
  if (snapshot.baseline.hrv.count < 14) missing.push("个人 HRV 基线少于 14 次，不据此增加训练。");
  if (!snapshot.checkin) missing.push("尚无当日精力、酸痛与症状记录，训练前请补充。");
  if (!preferences.age) missing.push("尚未填写年龄；作息和活动采用成人一般参考。");
  if (!synced) missing.push("本次最新同步未成功；历史读数仅作背景，不作为今日训练发布依据。");
  if (!sync?.finishedAt) missing.push("尚无成功同步时间，数据时效需要确认。");
  const title = status === "urgent" ? "先处理身体不适" : status === "rest" ? "今天先恢复，再谈加量" : status === "waiting" ? "等待最新同步与当天评分" : "今天循序训练，稳住恢复";
  return {
    schema: "lifeos.daily-plan.v2", engine: "本机规则 · 晨间报告 v2", period: "today", publication, targetDate,
    generatedAt: now.toISOString(), timeZone: preferences.timeZone, trigger, slot,
    status, title, goal: snapshot.goal,
    basis: { physiologicalDate: day.date, expectedDate: snapshot.today, timezoneOffset: day.timezoneOffset || snapshot.timezoneOffset,
      lastSyncAt: sync?.finishedAt || null, fresh, evidence,
      metrics: { recovery: day.recovery, hrv: day.hrv, rhr: day.rhr, sleepHours: day.sleepHours, strain: day.strain },
      weekly: snapshot.weekly },
    sleep: { bedtime: clockText(bedMinutes), windDown: clockText(bedMinutes - 30),
      wakeTime: preferences.wakeTime, opportunityHours,
      text: `${shortSleep ? `最近一晚实际睡眠 ${day.sleepHours.toFixed(1)} 小时，优先补足睡眠机会。` : "保持规律作息。"}上床至起床预留 ${opportunityHours} 小时，不等于保证睡着这么久；这是作息参考，可按实际需要调整。`,
      habits: ["睡前半小时减少屏幕刺激，保持卧室安静、凉爽。", "下午和晚上避免咖啡因，睡前避免大量进食与饮酒。", "起床后接触自然光，白天规律活动；不要为早起压缩睡眠。"] },
    nutrition: { meals: meals(preferences, targetDate), diet: preferences.diet,
      text: "每餐搭配主食、蛋白质和蔬菜，水果分次吃。份量按饥饿、饱腹感和训练量调整；不直接按手环消耗计算进食量。",
      hydration: "随餐及活动前后按口渴和出汗补水；不设统一饮水升数。", note: "食谱为可替换示例，不设热量缺口、精确营养克数或补剂。" },
    exercise,
    morningCheck: ["起床后先让手环同步，查看当天恢复、睡眠和主观精力。", exercise.adjustment,
      "出现胸痛、静息时呼吸困难或晕厥，停止训练并及时寻求急救。"],
    missing, sources: SOURCES, rules: guidance.rules,
    limits: "今天的训练只依据发布前同步到的当天已评分数据。手环读数不能排除疾病；身体感受与症状优先于分数。",
  };
}

export function planMarkdown(plan) {
  const lines = [ `# ${plan.targetDate} 健康建议`, "", plan.title,
    `生成：${plan.generatedAt} · ${plan.timeZone} · 修订 ${plan.revision || 1}`, "",
    `发布状态：${plan.publication?.message || "历史报告"}`, "",
    plan.period === "today" ? "## 今晚作息" : "## 作息",
    `${plan.period === "today" ? "今晚" : "前一晚"} ${plan.sleep.windDown} 开始放松，${plan.sleep.bedtime} 上床；${plan.period === "today" ? "次日" : "当天"} ${plan.sleep.wakeTime} 起床。`, plan.sleep.text,
    ...plan.sleep.habits.map((s) => `- ${s}`), "", "## 三餐示例",
    ...plan.nutrition.meals.map((m) => `- ${m.name}：${m.text}`), plan.nutrition.text, plan.nutrition.hydration, plan.nutrition.note,
    "", `## 运动：${plan.exercise.mode}`, ...plan.exercise.steps.map((s) => `- ${s}`),
    "", plan.period === "today" ? "## 训练前检查" : "## 明晨调整", ...plan.morningCheck.map((s) => `- ${s}`),
    "", "## 依据", ...plan.basis.evidence.map((e) => `- ${e.text}`),
    ...plan.missing.map((s) => `- 数据缺口：${s}`), "", plan.rules, plan.limits,
    "", ...plan.sources.map((s) => `- [${s.label}](${s.url})`) ];
  return lines.join("\n");
}
