/**
 * [INPUT]: 微信原话、冻结接收时间和本人活跃分类。
 * [OUTPUT]: 确定性区间替换计划，或日期与格式追问。
 * [POS]: 历史时段命令入口；不依赖模型，数据库裁剪原记录。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Category, ParseResult, TimeRecord } from './contracts.js';

const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const command = /^(?:修改时段|修改时间|替换时段|补录时段|补录|补记|增加(?:一个)?(?:时间段|时段)|新增(?:一个)?(?:时间段|时段))[\s，,:：]*(?:(\d{4}-\d{2}-\d{2}|今天|昨天|前天)\s*)?(\d{1,2})\s*[:：点]\s*(\d{1,2})\s*分?\s*(?:-|~|～|—|到|至)\s*(\d{1,2})\s*[:：点]\s*(\d{1,2})\s*分?[\s，,:：]*(?:改为|改成|为)?\s*(.+)$/u;
const empty = { time_entries: [], transactions: [], clarify: null };

export function parseTimeCommand(text: string, receivedAt: string, categories: Category[]): ParseResult | null {
  const match = command.exec(text.trim());
  if (!match) return null;
  const question = (clarify: string): ParseResult => ({ ...empty, clarify });
  const [, date, firstHour, firstMinute, lastHour, lastMinute, description] = match;
  const first = Number(firstHour) * 60 + Number(firstMinute);
  const last = Number(lastHour) * 60 + Number(lastMinute);
  if (Number(firstHour) > 23 || Number(lastHour) > 23 || Number(firstMinute) > 59 || Number(lastMinute) > 59 || first === last) {
    return question('请提供有效的起止钟点，例如“修改时段 10:15-10:45 写方案 [工作]”。');
  }
  const today = new Date(Date.parse(receivedAt) + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
  const shift = date === '昨天' ? -1 : date === '前天' ? -2 : 0;
  const base = /^\d{4}-/u.test(date ?? '') ? date! :
    new Date(Date.parse(today + 'T00:00:00Z') + shift * DAY_MS).toISOString().slice(0, 10);
  const midnight = Date.parse(base + 'T00:00:00+08:00');
  if (!Number.isFinite(midnight) || new Date(midnight + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10) !== base) {
    return question('日期无效，请使用“修改时段 YYYY-MM-DD HH:MM-HH:MM 活动 [分类]”。');
  }
  // 只为明确的夜间跨午夜钟点补一天，其他倒序钟点需要澄清。
  const overnight = last < first && Number(firstHour) >= 18 && Number(lastHour) <= 8;
  if (last < first && !overnight) return question('结束钟点早于开始钟点，请重新发送正确的时段。');
  const label = /\s*[\[【]([^\]】]+)[\]】]\s*$/u.exec(description!);
  const activity = (label ? description!.slice(0, label.index) : description!).trim();
  const category = categories.find(c => c.is_active && c.kind === 'time' &&
    (label ? c.name === label[1]!.trim() || c.code === label[1]!.trim() : c.code === 'uncategorized'));
  if (!category) return question('分类不存在，请在命令末尾填写已有分类，例如“[工作]”。');
  if (!activity || activity.length > 500) return question('请在起止钟点后填写活动名称，最多500字。');
  const at = (minutes: number) => new Date(midnight + minutes * 60_000).toISOString();
  if (Date.parse(at(last + (overnight ? 1440 : 0))) > Date.parse(receivedAt) + 60_000) {
    return question('这个时段尚未结束，请在活动结束后发送补录命令；历史记录请写明日期。');
  }
  const entry: TimeRecord = { start_at: at(first), end_at: at(last + (overnight ? 1440 : 0)),
    activity, category: category.code, note: null };
  return { ...empty, time_replacements: [entry] };
}
