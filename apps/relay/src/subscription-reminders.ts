/**
 * [INPUT]: VPS回环订阅API、北京时间与提醒入队仓储。
 * [OUTPUT]: 扣款前七天的确定性文案与逐笔幂等入队结果。
 * [POS]: 订阅到微信的单向桥；不领取浏览器提醒，不写订阅账本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { z } from 'zod';
import { RelayError } from './errors.js';
import { money } from './reply.js';

const Subscription = z.object({
  id: z.string().min(1).max(100), name: z.string().min(1).max(200),
  status: z.string(), auto_renew: z.union([z.boolean(), z.literal(0), z.literal(1)]),
  next_renewal_on: z.iso.date(), amount_fen: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type Subscription = z.infer<typeof Subscription>;
export interface SubscriptionReminder {
  subscription_id: string; renewal_on: string; text: string;
}
export interface SubscriptionEnqueueResult {
  queued: boolean;
  reason: 'queued' | 'already_queued' | 'retry_queued' | 'no_context' | 'not_due' | 'outside_window';
}
export interface SubscriptionReminderStore {
  enqueueSubscriptionReminder(item: SubscriptionReminder,
    binding: { accountId: string; userId: string }): Promise<SubscriptionEnqueueResult>;
}

export async function readSubscriptions(request: typeof fetch = fetch): Promise<Subscription[]> {
  let response: Response;
  try {
    response = await request('http://127.0.0.1:18787/v1/subscriptions', {
      signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
  } catch { throw new RelayError('SUBSCRIPTIONS_NETWORK_FAILED'); }
  if (!response.ok) throw new RelayError(`SUBSCRIPTIONS_HTTP_${response.status}`);
  try { return z.object({items:z.array(Subscription)}).parse(await response.json()).items; }
  catch { throw new RelayError('SUBSCRIPTIONS_RESULT_INVALID'); }
}

export function sevenDayReminders(items: Subscription[], at = new Date()): SubscriptionReminder[] {
  const day = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
  // 日期只在UTC做整数日加法；当天由上海时区决定，不按机器时区计算。
  const due = new Date(`${day}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate()+7);
  const renewal = due.toISOString().slice(0,10);
  return items.filter(item => item.status==='active' && Boolean(item.auto_renew)
    && item.amount_fen>0 && item.next_renewal_on===renewal).map(item => ({
      subscription_id:item.id, renewal_on:item.next_renewal_on,
      text:`订阅扣款提醒 · 提前7天\n${item.name}\n预计扣款：${money(item.amount_fen,item.currency)}\n扣款日期：${item.next_renewal_on}（北京时间）\n如不再使用，请在服务商处提前取消续费。`,
    }));
}

export async function enqueueSubscriptionReminders(store: SubscriptionReminderStore,
  binding: {accountId:string;userId:string}, items: SubscriptionReminder[]): Promise<SubscriptionEnqueueResult[]> {
  const results: SubscriptionEnqueueResult[] = [];
  for (const item of items) results.push(await store.enqueueSubscriptionReminder(item,binding));
  return results;
}
