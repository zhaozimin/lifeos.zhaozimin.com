/**
 * [INPUT]: Supabase服务端身份、受限账目及消息记忆事务。
 * [OUTPUT]: 原话与记忆租约、时间纠错事务、回复确认和订阅提醒入队。
 * [POS]: 唯一数据库适配器；高权限密钥不进入 CLI 子进程或日志。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Category, Command, IncomingInput, ParseResult, RawInput, RecordSnapshot, ReplyTarget, Store,
  DailySummary, DailyEnqueueResult, DailySummaryStore, StewardContext, DialogueTurn, MemoryQueue, MemoryJob, MemoryOutcome } from '../contracts.js';
import { RelayError } from '../errors.js';
import type { SubscriptionReminder, SubscriptionReminderStore, SubscriptionEnqueueResult } from '../subscription-reminders.js';

const SnapshotSchema = z.object({
  time_entries: z.array(z.object({ start_at: z.string(), end_at: z.string().nullable(),
    duration_min: z.number().int().nonnegative().nullable(), activity: z.string(), category: z.string() })),
  transactions: z.array(z.object({ occurred_at: z.string(), direction: z.enum(['expense','income']),
    amount_cents: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    currency: z.string(), category: z.string(), account: z.string().nullable(), note: z.string().nullable() })),
});
const ContextSchema = z.object({
  accounts: z.array(z.object({ name: z.string().min(1), type: z.string().nullable() })),
  ongoing: z.array(z.object({ id: z.uuid(), revision: z.number().int().positive(),
    start_at: z.string(), activity: z.string(), category: z.string() })),
});

export class SupabaseStore implements Store, DailySummaryStore, MemoryQueue, SubscriptionReminderStore {
  readonly client: SupabaseClient;
  constructor(url: string, key: string, private readonly ownerId: string) {
    this.client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  private async rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.client.rpc(name, args);
    if (error) throw new RelayError(`DB_${error.code || 'REQUEST_FAILED'}`);
    return data;
  }
  private row(data: unknown): RawInput {
    const value = Array.isArray(data) ? data[0] : data;
    if (!value || typeof value !== 'object') throw new RelayError('DB_RESULT_INVALID');
    const row = value as RawInput;
    if (row.owner_id !== this.ownerId || !row.id) throw new RelayError('DB_OWNER_MISMATCH');
    return row;
  }
  async saveRaw(input: IncomingInput, captureOnly: boolean): Promise<string> {
    const id = await this.rpc('ingest_input', { p_owner_id: this.ownerId, p_source: input.source,
      p_external_id: input.external_id, p_text: input.text, p_received_at: input.received_at,
      p_payload: input.payload, p_input_kind: input.input_kind,
      p_initial_receipt: input.input_kind === 'record'
        ? captureOnly ? '已保存原话，自动处理尚未启用。' : '收到，正在处理。' : null });
    if (typeof id !== 'string') throw new RelayError('DB_RESULT_INVALID');
    return id;
  }
  async claim(recordsEnabled: boolean): Promise<RawInput | null> {
    const result = await this.rpc('claim_next_input', { p_owner_id: this.ownerId, p_records_enabled: recordsEnabled });
    return Array.isArray(result) && result.length === 0 ? null : this.row(result);
  }
  async categories(): Promise<Category[]> {
    const { data, error } = await this.client.from('categories').select('id,code,name,kind,is_active,keywords,direction,nature')
      .eq('owner_id', this.ownerId).eq('is_active', true).order('id');
    if (error) throw new RelayError('DB_CATEGORIES_FAILED');
    return data as Category[];
  }
  async clarifications(input: RawInput): Promise<string[]> {
    const { data, error } = await this.client.from('raw_inputs').select('text')
      .eq('owner_id', this.ownerId).eq('clarification_for', input.id).order('received_at');
    if (error) throw new RelayError('DB_CLARIFICATION_FAILED');
    return (data ?? []).map((row) => row.text as string);
  }
  async context(): Promise<StewardContext> {
    return ContextSchema.parse(await this.rpc('get_steward_context', { p_owner_id: this.ownerId }));
  }
  async dialogue(input: RawInput): Promise<DialogueTurn[]> {
    // PostgreSQL按Unicode字符截断；一个字符在JS中最多占两个UTF-16单元。
    return z.array(z.object({text:z.string().max(2000),reply:z.string().max(2000).nullable(),
      received_at:z.string()})).max(8).parse(await this.rpc('get_recent_dialogue',{p_input_id:input.id}));
  }
  async apply(input: RawInput, result: ParseResult, context?: StewardContext): Promise<RawInput> {
    const {time_corrections=[],...plan}=result;
    if (time_corrections.length) {
      const targets=await this.rpc('find_time_correction_targets',{
        p_input_id:input.id,p_requests:time_corrections});
      return this.row(await this.rpc('apply_time_corrections',{
        p_input_id:input.id,p_lease_token:input.lease_token,p_result:result,
        p_expected_targets:targets,p_expected_ongoing:context?.ongoing??null}));
    }
    return this.row(await this.rpc('apply_steward', { p_input_id: input.id, p_lease_token: input.lease_token,
      p_result: plan, p_expected_ongoing: context?.ongoing ?? null }));
  }
  async fail(input: RawInput, code: string): Promise<RawInput> {
    return this.row(await this.rpc('fail_input', { p_input_id: input.id, p_lease_token: input.lease_token, p_error_code: code }));
  }
  async command(input: RawInput, command: Command): Promise<RawInput> {
    return this.row(await this.rpc('run_command', { p_input_id: input.id, p_lease_token: input.lease_token, p_command: command }));
  }
  async records(id: string): Promise<RecordSnapshot> {
    return SnapshotSchema.parse(await this.rpc('get_input_records', { p_input_id: id }));
  }
  async queueReceipt(input: RawInput, text: string): Promise<void> {
    const { error } = await this.client.from('raw_inputs').update({ receipt_text: text,
      lease_token: null, lease_until: null, reply_next_at: new Date().toISOString() })
      .eq('owner_id', this.ownerId).eq('id', input.id).eq('receipt_revision', input.receipt_revision)
      .is('revoked_at', null).is('receipt_text', null);
    if (error) throw new RelayError('DB_RECEIPT_FAILED');
  }
  async pendingReceipts(): Promise<RawInput[]> {
    const { data, error } = await this.client.from('raw_inputs').select('*')
      .eq('owner_id', this.ownerId).is('delivered_at', null).is('revoked_at', null)
      .not('receipt_text', 'is', null).lt('reply_attempts', 5)
      .or(`reply_expires_at.is.null,reply_expires_at.gt.${new Date().toISOString()}`)
      .lte('reply_next_at', new Date().toISOString()).order('created_at').limit(20);
    if (error) throw new RelayError('DB_OUTBOX_FAILED');
    return (data ?? []) as RawInput[];
  }
  async replyTarget(input: RawInput): Promise<ReplyTarget> {
    const { data, error } = await this.client.from('raw_inputs').select('payload')
      .eq('owner_id', this.ownerId).eq('id', input.reply_input_id ?? input.id).single();
    if (error) throw new RelayError('DB_REPLY_CONTEXT_FAILED');
    const payload = data.payload as Record<string, unknown>;
    if (typeof payload.from_user_id !== 'string' || typeof payload.context_token !== 'string') {
      throw new RelayError('REPLY_CONTEXT_INVALID');
    }
    return { user_id: payload.from_user_id, context_token: payload.context_token };
  }
  async delivered(input: RawInput): Promise<void> {
    await this.rpc('accept_reply',{p_owner_id:this.ownerId,p_input_id:input.id,p_revision:input.receipt_revision});
  }
  async replyFailed(input: RawInput): Promise<void> {
    const delayMs = Math.min(30_000 * 2 ** input.reply_attempts, 600_000);
    const { error } = await this.client.from('raw_inputs').update({ reply_attempts: input.reply_attempts + 1,
      reply_next_at: new Date(Date.now() + delayMs).toISOString() })
      .eq('owner_id', this.ownerId).eq('id', input.id).eq('receipt_revision', input.receipt_revision);
    if (error) throw new RelayError('DB_REPLY_RETRY_FAILED');
  }
  async check(): Promise<void> {
    const { data, error } = await this.client.auth.admin.getUserById(this.ownerId);
    if (error || !data.user) throw new RelayError('DB_AUTH_OWNER_INVALID');
    const categories = await this.categories();
    for (const kind of ['time', 'money']) {
      if (!categories.some((category) => category.kind === kind && category.code === 'uncategorized')) {
        throw new RelayError('DB_FALLBACK_CATEGORY_MISSING');
      }
    }
    await this.context();
    await this.rpc('get_recent_dialogue',{p_input_id:'00000000-0000-0000-0000-000000000000'});
    await this.rpc('get_memory_sync_status',{p_owner_id:this.ownerId});
    await this.rpc('find_time_correction_targets',{p_input_id:'00000000-0000-0000-0000-000000000000',p_requests:[]});
  }
  async claimMemory():Promise<MemoryJob|null>{
    const data=await this.rpc('claim_memory_job',{p_owner_id:this.ownerId});
    if(data===null)return null;
    return z.object({id:z.uuid(),message_id:z.uuid(),raw_input_id:z.uuid(),lease_token:z.uuid(),
      role:z.enum(['user','assistant']),content:z.string(),happened_at:z.string(),conversation_id:z.string(),
      task_id:z.string().nullable(),state:z.string()}).parse(data);
  }
  async finishMemory(job:MemoryJob,state:MemoryOutcome,taskId:string|null,code?:string):Promise<void>{
    await this.rpc('finish_memory_job',{p_owner_id:this.ownerId,p_id:job.id,p_lease_token:job.lease_token,
      p_state:state,p_task_id:taskId,p_error_code:code??null});
  }
  async dailySummary(at?: string): Promise<DailySummary> {
    const result = await this.rpc('get_daily_summary', { p_owner_id: this.ownerId, ...(at ? {p_at:at} : {}) });
    return result as DailySummary;
  }
  async enqueueDailySummary(): Promise<DailyEnqueueResult> {
    return await this.rpc('enqueue_daily_summary', { p_owner_id: this.ownerId }) as DailyEnqueueResult;
  }
  async enqueueSubscriptionReminder(item: SubscriptionReminder,
    binding: {accountId:string;userId:string}): Promise<SubscriptionEnqueueResult> {
    return z.object({queued:z.boolean(),reason:z.enum(['queued','already_queued','retry_queued',
      'no_context','not_due','outside_window'])}).parse(await this.rpc('enqueue_subscription_reminder', {
      p_owner_id:this.ownerId,p_subscription_id:item.subscription_id,p_renewal_on:item.renewal_on,
      p_text:item.text,p_wechat_account_id:binding.accountId,p_wechat_user_id:binding.userId,
    }));
  }
}
