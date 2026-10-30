/**
 * [INPUT]: 依赖 Intl 与未信任的财务显示值；ECharts tooltip 会把 formatter 结果当 HTML 渲染。
 * [OUTPUT]: 对外提供 HTML 转义、CNY/简短金额、百分比、日期与其他 finance 统一显示格式。
 * [POS]: finance 的纯显示边界；用户文本进入 tooltip 前必经 escapeHtml，阻断可读 Token 的存储型 XSS。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {isVisitor} from '../../../access';
export function privateValue(value:string|number){return isVisitor()?'••••':String(value);}
const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPE[c]);
}

/** 货币格式 — 永远写完整数字，不做缩位（财务克制原则）。 */
export function formatCurrency(value: number, opts: { withSign?: boolean } = {}): string {
  if(isVisitor())return '••••';
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const formatted = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  if (opts.withSign && value !== 0) {
    return `${value < 0 ? "−" : "+"}¥${formatted}`;
  }
  return `${value < 0 ? "−" : ""}¥${formatted}`;
}

/** 简短金额（用于卡片大数字，仍保留 2 位小数）。 */
export function formatCurrencyCompact(value: number): string {
  if(isVisitor())return '••••';
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/** 百分比 */
export function formatPercent(value: number, digits = 1): string {
  if(isVisitor())return '••••';
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

/** 用于交易列表的相对日期 */
export function formatDate(iso: string): string {
  if (!iso) return "";
  const day = iso.slice(0, 10);
  return day;
}

export function formatDateTime(iso: string): string {
  if(isVisitor())return iso?iso.slice(0,10)+' ••:••':'';
  if (!iso || iso.length < 16) return iso || "";
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** ISO month "YYYY-MM" 转中文 */
export function formatMonth(monthKey: string): string {
  if (!monthKey || monthKey.length !== 7) return monthKey;
  const [year, month] = monthKey.split("-");
  return `${year}年 ${parseInt(month, 10)}月`;
}

export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
