/**
 * [INPUT]: 模型计划、当前分类与真实资金账户上下文。
 * [OUTPUT]: 管家计划、受限时间纠错和自然回答校验器。
 * [POS]: 模型与账本之间的唯一结构化边界。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { z } from 'zod';
import type { Category, ParseResult, StewardContext } from '../contracts.js';
import { RelayError } from '../errors.js';

const timestamp = z.iso.datetime({ offset: true });
const optionalText = z.string().max(500).nullable();
export const ParseSchema = z.object({
  time_entries: z.array(z.object({
    start_at: timestamp, end_at: timestamp, category: z.string().min(1).max(80),
    activity: z.string().min(1).max(500), note: optionalText.optional(),
  }).strict()).max(50),
  transactions: z.array(z.object({
    occurred_at: timestamp, direction: z.enum(['expense', 'income']),
    amount_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    currency: z.literal('CNY'), category: z.string().min(1).max(80),
    account: optionalText, merchant: optionalText, note: optionalText,
    funding_account: optionalText.optional(),
  }).strict()).max(50),
  time_events: z.array(z.object({
    action: z.enum(['switch', 'stop']), at: timestamp,
    category: z.string().min(1).max(80).nullable(), activity: optionalText, note: optionalText,
  }).strict()).max(1).optional(),
  time_corrections: z.array(z.object({
    target: z.object({start_at:timestamp.optional(),end_at:timestamp.optional(),day:z.iso.date().optional(),
      activity:z.string().trim().min(1).max(500).optional(),position:z.enum(['current','previous']).optional()})
      .strict().refine(value=>Object.keys(value).length>0),
    patch: z.object({start_at:timestamp.optional(),end_at:timestamp.nullable().optional(),
      activity:z.string().trim().min(1).max(500).optional(),category:z.string().min(1).max(80).optional(),
      note:optionalText.optional()}).strict().refine(value=>Object.keys(value).length>0)
      .refine(value=>!value.activity || Boolean(value.category)),
  }).strict()).max(10).optional(),
  archive_kind: z.enum(['inspiration', 'diary', 'emotion', 'raw']).nullable().optional(),
  unsupported: z.enum(['correction', 'transfer', 'foreign_currency', 'recurring', 'knowledge',
    'schedule', 'history_query', 'obsidian_binding', 'other']).nullable().optional(),
  clarify: z.string().min(1).max(500).nullable(),
  answer: z.string().trim().min(1).max(3000).nullable().optional(),
}).strict();

export const parseJsonSchema = z.toJSONSchema(ParseSchema);
export function validateParse(value: unknown, categories: Category[], context?: StewardContext): ParseResult {
  const parsed = ParseSchema.safeParse(value);
  if (!parsed.success) throw new RelayError('PARSER_SCHEMA_INVALID');
  const result = parsed.data;
  if (result.clarify && (result.answer || result.time_entries.length + result.transactions.length
    + (result.time_events?.length ?? 0) + (result.time_corrections?.length ?? 0) > 0)) {
    throw new RelayError('PARSER_CLARIFICATION_CONFLICT');
  }
  for (const correction of result.time_corrections ?? []) {
    const patch=correction.patch;
    if (patch.category && !categories.some(c=>c.is_active && c.kind==='time' && c.code===patch.category)) {
      throw new RelayError('PARSER_CATEGORY_INVALID');
    }
    if (patch.start_at && patch.end_at && Date.parse(patch.end_at)<=Date.parse(patch.start_at)) {
      throw new RelayError('PARSER_TIME_INVALID');
    }
  }
  for (const entry of result.time_entries) {
    if (Date.parse(entry.end_at) <= Date.parse(entry.start_at)) throw new RelayError('PARSER_TIME_INVALID');
  }
  for (const event of result.time_events ?? []) {
    if (event.action === 'switch' && (!event.activity || !event.category ||
      !categories.some(c => c.is_active && c.kind === 'time' && c.code === event.category))) {
      throw new RelayError('PARSER_TIME_EVENT_INVALID');
    }
    if (event.action === 'stop' && (event.activity !== null || event.category !== null)) {
      throw new RelayError('PARSER_TIME_EVENT_INVALID');
    }
  }
  for (const [kind, entries] of [['time', result.time_entries], ['money', result.transactions]] as const) {
    for (const entry of entries) {
      if (!categories.some((c) => c.is_active && c.kind === kind && c.code === entry.category)) {
        throw new RelayError('PARSER_CATEGORY_INVALID');
      }
    }
  }
  for (const entry of result.transactions) {
    const category = categories.find((c) => c.kind === 'money' && c.code === entry.category);
    if (category?.direction && category.direction !== entry.direction) throw new RelayError('PARSER_CATEGORY_DIRECTION_INVALID');
    if (context) {
      if (!entry.funding_account) throw new RelayError('PARSER_ACCOUNT_REQUIRED');
      if (!context.accounts.some(account => account.name === entry.funding_account)) throw new RelayError('PARSER_ACCOUNT_INVALID');
    }
  }
  return result;
}
