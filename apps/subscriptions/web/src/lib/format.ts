/**
 * [INPUT]: 依赖 types 的周期、紧急度、订阅字段
 * [OUTPUT]: 提供中文整数、周期标签、倒计时与金额展示。本人yuan空值当¥0；访客金额固定打码
 * [POS]: web/lib 的展示层格式化，不计算天数
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Cycle, Status, Subscription } from "../types";
import {isVisitor} from '../visitor';

const CHINESE_DIGITS = "零一二三四五六七八九";
const CHINESE_UNITS: Array<[bigint, string]> = [
  [10n ** 16n, "京"], [10n ** 12n, "兆"], [10n ** 8n, "亿"], [10n ** 4n, "万"],
  [1000n, "千"], [100n, "百"], [10n, "十"],
];

export function chineseInteger(value: string): string {
  const input = BigInt(value);
  if (input < 0n) throw new RangeError("中文数字仅支持非负整数");
  function spell(number: bigint): string {
    if (number < 10n) return CHINESE_DIGITS[Number(number)];
    for (const [base, unit] of CHINESE_UNITS) {
      if (number < base) continue;
      const rest = number % base;
      return spell(number / base) + unit + (rest === 0n ? "" : (rest < base / 10n ? "零" : "") + spell(rest));
    }
    return "";
  }
  return spell(input).replace(/^一十/, "十");
}

export const CYCLE_OPTIONS: { value: Cycle; label: string }[] = [
  { value: "monthly", label: "每月" },
  { value: "quarterly", label: "每季" },
  { value: "yearly", label: "每年" },
  { value: "custom", label: "自定义天数" },
];

export function cycleLabel(cycle: Cycle, cycleDays: number | null): string {
  if (cycle === "custom") return isVisitor()&&cycleDays===null?"自定义周期":`${cycleDays ?? "?"} 天`;
  return CYCLE_OPTIONS.find((item) => item.value === cycle)?.label ?? cycle;
}

export function hostOf(website: string): string {
  try {
    return new URL(website).host.replace(/^www\./, "");
  } catch {
    return website;
  }
}

export function countdownLabel(item: Subscription): string {
  const days = item.days_left;
  if (item.status === "paused") {
    return days > 0 ? `已暂停 · 恢复后还剩 ${days} 天` : "已暂停 · 服务已停用";
  }
  if (item.status === "cancelled" && days >= 0) {
    return days === 0 ? "今天到期" : `服务还剩 ${days} 天`;
  }
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  if (days === 0) return item.auto_renew ? "今天扣款" : "今天到期";
  return `还剩 ${days} 天`;
}

export function countdownNumber(item: Subscription): string {
  if (item.days_left < 0) return String(Math.abs(item.days_left));
  return String(item.days_left);
}

export function statusLabel(status: Status): string {
  if (status === "paused") return "已暂停";
  if (status === "cancelled") return "已取消";
  if (status === "expired") return "已到期";
  return "生效中";
}

export function paymentLabel(item: Subscription): string {
  if (!item.payment_method_name) return "未指定支付";
  if (item.payment_method_account) {
    return `${item.payment_method_name} ${item.payment_method_account}`;
  }
  return item.payment_method_name;
}

export function accountLabel(item: Subscription): string {
  if (!item.account_label) return "未指定账号";
  return `${item.account_label} · ${item.account_identifier ?? ""}`.replace(/ · $/, "");
}

export function yuan(value: string | null | undefined): string {
  if(isVisitor())return '••••';
  if (!value) return "¥0";
  const [whole, frac] = value.split(".");
  return frac === "00" ? `¥${whole}` : `¥${value}`;
}
