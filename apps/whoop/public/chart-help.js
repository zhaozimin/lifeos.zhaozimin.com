/**
 * [INPUT]: 依赖日期读数、明确的当前参考基线和 html.js。
 * [OUTPUT]: 导出指标解释、解读载荷与 SVG 命中区域。
 * [POS]: public 的纯解读层；说明含义和比较边界，不把变化判为疾病。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { escapeHtml as esc } from "./html.js";
const RECOVERY = "https://developer.whoop.com/docs/developing/user-data/recovery/";
const SLEEP = "https://developer.whoop.com/docs/developing/user-data/sleep/";
const STRAIN = "https://www.whoop.com/us/en/thelocker/how-does-whoop-strain-work-101/";
export const validNumber = (n) => typeof n === "number" && Number.isFinite(n);
export const METRIC_HELP = {
  recovery: { name: "恢复评分", unit: "%", meaning: "WHOOP 把 HRV、静息心率等信号合成 0–100% 的恢复参考，用来看当天承受负荷的准备程度。", reading: "先结合睡眠和身体感受看。分数较高也不等于适合突然加量。", source: RECOVERY },
  recoveryAverage: { name: "7 天恢复均值", unit: "%", meaning: "把最近 7 天的有效恢复值取平均，用来减弱单日波动。", reading: "至少 4 个有效值才显示。它是近期趋势，不是当天恢复分数。" },
  hrv: { name: "心率变异性 HRV", unit: "ms", meaning: "相邻心跳的间隔并不完全一样；HRV 描述这种变化幅度，ms 是毫秒。", reading: "主要和自己的历史比较。升高或降低一天，不能单独证明体能改善或生病。", source: "https://www.whoop.com/us/en/thelocker/heart-rate-variability-how-to-read-and-improve-your-hrv/" },
  rhr: { name: "静息心率", unit: "bpm", meaning: "身体安静时的心跳频率；bpm 表示每分钟心跳次数。", reading: "和自己的多日水平比较，并结合疲劳和睡眠看；并非越低越好。", source: RECOVERY },
  sleepHours: { name: "实际睡眠", unit: "h", meaning: "浅睡、深睡和 REM 的合计，不含清醒与无数据时段。", reading: "先看连续几晚是否充足。设备分期和时长都是估算，躺床时间不等于睡着的时间。", source: SLEEP },
  sleepNeeded: { name: "WHOOP 估算需求", unit: "h", meaning: "设备结合基础需求、睡眠负债、近期负荷和午睡抵扣计算的参考时长。", reading: "用于和实睡对照，不是医学处方，也不保证每晚都精确适用。", source: SLEEP },
  sleepPerformance: { name: "睡眠需求完成度", unit: "%", meaning: "WHOOP 返回的睡眠完成度评分，与实际睡眠小时是不同指标。", reading: "这里保留设备原值，结合实睡时长和醒来后的精力理解。", source: SLEEP },
  sleepEfficiency: { name: "睡眠效率", unit: "%", meaning: "主睡眠记录时段内，设备判定为睡着的时间比例。", reading: "它描述睡眠连续性；效率高不代表总时长足够。", source: SLEEP },
  strain: { name: "每日身体负荷", unit: "/21", meaning: "WHOOP 用 0–21 的非线性分数概括身体承受的负荷。", reading: "负荷高不代表训练效果一定更好；日负荷也不是各次训练分数之和。", source: STRAIN },
  respiratoryRate: { name: "睡眠呼吸频率", unit: "次/分", meaning: "睡眠期间每分钟呼吸次数的设备估算。", reading: "看自己的多日变化。持续变化或伴随不适时，结合症状核实，不凭一次读数诊断。", source: SLEEP },
  spo2: { name: "设备血氧估算", unit: "%", meaning: "设备估计血液携氧水平的百分比。", reading: "佩戴与测量条件会影响读数。这张图不设置医学诊断阈值，反复偏低或有不适需核实。", source: RECOVERY },
  skinTemp: { name: "夜间皮肤温度", unit: "°C", meaning: "手环接触位置的皮肤温度估算，不是核心体温。", reading: "看相同佩戴条件下的趋势；环境和佩戴变化也会影响读数，不能据此判定发热。", source: RECOVERY },
  light: { name: "浅睡", unit: "h", meaning: "WHOOP 估算的浅睡时间，是实际睡眠的一部分。", reading: "和深睡、REM 一起看，不给单个睡眠分期设个人达标线。", source: SLEEP },
  deep: { name: "深睡", unit: "h", meaning: "WHOOP 估算的慢波睡眠时间，是实际睡眠的一部分。", reading: "分期来自设备估算；单晚较短不能据此诊断恢复异常。", source: SLEEP },
  rem: { name: "REM 睡眠", unit: "h", meaning: "WHOOP 估算的快速眼动睡眠时间，是实际睡眠的一部分。", reading: "观察多晚变化，并结合总睡眠和白天精力，不凭单晚分期下结论。", source: SLEEP },
  awake: { name: "清醒时段", unit: "h", meaning: "主睡眠记录中，设备判定为清醒的时间。", reading: "计入记录时段的总柱高，但不计入实际睡眠。", source: SLEEP },
  noData: { name: "无数据时段", unit: "h", meaning: "该段记录没有可用的睡眠分期数据。", reading: "它不代表清醒、零睡眠或恢复差；不能补进实际睡眠。", source: SLEEP },
  bedtime: { name: "主睡眠开始", unit: "clock", meaning: "WHOOP 主睡眠记录开始的当地时间。", reading: "同列连接到醒来时间。跨过午夜后仍属于同一次主睡眠；旅行时需留意记录时区。", source: SLEEP },
  wakeHour: { name: "主睡眠结束", unit: "clock", meaning: "WHOOP 主睡眠记录结束的当地时间。", reading: "这段起止时间含清醒时段，不等于实际睡眠小时。", source: SLEEP },
  recordedMinutes: { name: "已记录运动时长", unit: "分钟", meaning: "只累计 WHOOP 中已经记录的运动时长。", reading: "不包含所有日常活动，也未换算中等强度活动分钟。零只代表没有已记录时长。" },
  workoutCount: { name: "已记录训练", unit: "次", meaning: "这个时段内独立运动记录的条数。", reading: "次数反映记录频率，不等于训练效果。" },
  weight: { name: "体重", unit: "kg", meaning: "你在生活记录中手动填写的体重。", reading: "尽量在相近时段、条件下测量；单次变化不能直接解释为增肌或减脂。" },
  energy: { name: "主观精力", unit: "/5", meaning: "你的每日自述：1 为明显疲惫，5 为精力充沛。", reading: "它是身体感受，不是设备测量。和睡眠、负荷一起看更有上下文。" },
  soreness: { name: "主观酸痛", unit: "/10", meaning: "你的每日自述：0 为没有，10 为非常明显。", reading: "酸痛不等于有效训练；疼痛或不适加重时应调整活动并核实原因。" },
};

export function formatReading(value, key) {
  if (!validNumber(value)) return "暂无有效值";
  const unit = METRIC_HELP[key]?.unit || "";
  if (unit === "clock") {
    const minute = ((Math.round(value * 60) % 1440) + 1440) % 1440;
    return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  }
  if (unit === "h") {
    const minute = Math.round(value * 60);
    return `${Math.floor(minute / 60)} 小时 ${minute % 60} 分`;
  }
  return `${Number(value.toFixed(2))}${unit === "%" || unit.startsWith("/") ? "" : " "}${unit}`;
}

function compareReading(item) {
  if (!validNumber(item.value) || item.calibrating) return null;
  const baseline = item.baseline;
  if (!baseline) return null;
  if (baseline.count < 14 || !validNumber(baseline.value))
    return `当前参考基线只有 ${baseline.count || 0} 次有效值，满 14 次后再比较，暂不判断高低。`;
  const difference = item.value - baseline.value;
  const unit = item.key === "strain" ? "分" : METRIC_HELP[item.key]?.unit === "%" ? "个百分点" : METRIC_HELP[item.key]?.unit === "h" ? "小时" : METRIC_HELP[item.key]?.unit || "";
  const direction = Math.abs(difference) < .05 ? "接近" : difference > 0 ? "高于" : "低于";
  const change = Math.abs(difference) < .05 ? "" : METRIC_HELP[item.key]?.unit === "h" ?
    ` ${formatReading(Math.abs(difference), item.key)}` : ` ${Number(Math.abs(difference).toFixed(2))} ${unit}`;
  const percent = item.key === "hrv" && baseline.value > 0 && Math.abs(difference) >= .05 ? `（${difference > 0 ? "+" : ""}${((difference / baseline.value) * 100).toFixed(1)}%）` : "";
  return `${direction}当前参考均值${change}${percent}。参考值 ${formatReading(baseline.value, item.key)}，来自${item.referenceDate ? ` ${item.referenceDate} 之前` : "此前"} 28 天的 ${baseline.count} 次有效记录。`;
}

export function explainHelp(payload) {
  const readings = (payload.readings || []).map((item) => {
    const info = METRIC_HELP[item.key] || { name: item.key, meaning: "此指标尚无解释。", reading: "" };
    const recoveryReading = item.key === "recovery" && !item.aggregate && validNumber(item.value) ?
      item.value < 34 ? "落在 WHOOP 红色恢复区间（0–33%）。结合睡眠和身体感受查看今日训练，不把它当作疾病诊断。" :
        item.value < 67 ? "落在 WHOOP 黄色恢复区间（34–66%）。仍需结合睡眠和疲劳，不能单凭这个分数判断能练多重。" :
          "落在 WHOOP 绿色恢复区间（67–100%）。较高分也不等于可以突然增加负荷或忽略不适。" : info.reading;
    return { name: info.name, value: formatReading(item.value, item.key), meaning: info.meaning,
      comparison: compareReading(item),
      reading: item.calibrating ? "设备仍在校准，此值不用于恢复判断或基线比较。" :
        !validNumber(item.value) ? "缺失、待评分或校准时保留为空；没有数据不等于零或状态变差。" : recoveryReading,
      source: info.source };
  });
  const notes = [...(payload.notes || [])];
  const actual = payload.readings?.find((r) => r.key === "sleepHours")?.value;
  const need = payload.readings?.find((r) => r.key === "sleepNeeded")?.value;
  if (validNumber(actual) && validNumber(need)) {
    const gap = actual - need;
    notes.unshift(Math.abs(gap) < .05 ? "这晚实睡接近设备估算需求。" :
      `这晚实睡比设备估算需求${gap > 0 ? "多" : "少"} ${formatReading(Math.abs(gap), "sleepHours")}；需求是设备参考。`);
  }
  if (payload.readings?.some((r) => r.cycleOpen && r.key === "strain")) notes.push("当天生理周期尚未结束，负荷还会更新。");
  if (payload.readings?.some((r) => r.baseline && payload.date && r.referenceDate && payload.date !== r.referenceDate))
    notes.push("这里使用当前参考基线读历史图，并非该日期当时的基线。");
  return { title: payload.title || (readings.length === 1 ? readings[0].name : "这一天怎样理解"),
    date: payload.date || "指标说明", readings, notes,
    sources: [...new Set(readings.map((r) => r.source).filter(Boolean))] };
}

export function dayHelp(day, keys, baselines = {}, referenceDate, extra = {}) {
  return { date: day.date, readings: keys.map((key) => ({ key, value: day[key] ?? null,
    baseline: baselines[key], referenceDate,
    calibrating: ["recovery", "hrv", "rhr"].includes(key) && day.calibrating,
    cycleOpen: day.cycleOpen })), ...extra };
}
export function helpAttrs(payload, { tabIndex = 0, label } = {}) {
  const name = label || `${payload.date || ""} ${payload.title || (payload.readings || []).map((r) => METRIC_HELP[r.key]?.name || r.key).join("、")}，查看解读`;
  return `data-help="${esc(JSON.stringify(payload))}" tabindex="${tabIndex}" role="button" aria-label="${esc(name.trim())}" aria-haspopup="dialog" aria-expanded="false"`;
}
export function helpButton(payload) {
  return `<button type="button" class="chart-help-button" ${helpAttrs(payload, { label: `${payload.title || "指标含义"}，查看解读` })}>?</button>`;
}
export function helpLayer(payloads, { x, left, right, top, bottom }) {
  return `<g class="chart-help-layer"><line class="inspection-guide" y1="${top}" y2="${bottom}" hidden/>${payloads.map((payload, i) => {
    const start = i === 0 ? left : (x(i - 1) + x(i)) / 2;
    const end = i === payloads.length - 1 ? right : (x(i) + x(i + 1)) / 2;
    return `<rect class="chart-hit" x="${start}" y="${top}" width="${Math.max(.1, end - start)}" height="${bottom - top}" data-point-index="${i}" data-guide-x="${x(i)}" ${helpAttrs(payload, { tabIndex: i === payloads.length - 1 ? 0 : -1 })}/>`;
  }).join("")}</g>`;
}
export const readerHint = () => '<div class="chart-reader-hint"><span class="reader-hint-icon">?</span><span><strong>看不懂数值？</strong>把鼠标移到曲线、柱形或指标上，查看含义和个人对照；点击可固定解读。触屏直接点，键盘用 Tab 和方向键。</span></div>';
