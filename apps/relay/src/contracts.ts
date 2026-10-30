/**
 * [INPUT]: 微信、受限账目与MemOS云接口的业务约定。
 * [OUTPUT]: 控制指令、时间纠错计划、记忆后端与持久化队列接口。
 * [POS]: relay 的依赖方向中心，不依赖网络或具体存储。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export type Command = 'help' | 'today' | 'undo' | 'stop' | 'cancel';
export type InputKind = 'record' | 'command' | 'unsupported';
export interface Category {
  id: number; code: string; name: string; kind: 'time' | 'money'; is_active: boolean;
  keywords?: string[]; direction?: 'income' | 'expense' | null;
  nature?: 'core' | 'support' | 'recovery' | 'leisure' | null;
}
export interface TimeRecord {
  start_at: string; end_at: string; category: string; activity: string; note?: string | null;
}
export interface MoneyRecord {
  occurred_at: string; direction: 'expense' | 'income'; amount_cents: number;
  currency: string; category: string; account: string | null; merchant: string | null; note: string | null;
  funding_account?: string | null;
}
export interface TimeEvent {
  action: 'switch' | 'stop'; at: string; category: string | null; activity: string | null; note: string | null;
}
export interface TimeCorrection {
  target: { start_at?: string; end_at?: string; day?: string; activity?: string;
    position?: 'current' | 'previous' };
  patch: { start_at?: string; end_at?: string | null; activity?: string; category?: string; note?: string | null };
}
export type ArchiveKind = 'inspiration' | 'diary' | 'emotion' | 'raw';
export type UnsupportedReason = 'correction' | 'transfer' | 'foreign_currency' | 'recurring' |
  'knowledge' | 'schedule' | 'history_query' | 'obsidian_binding' | 'other';
export interface StewardContext {
  accounts: Array<{ name: string; type: string | null }>;
  ongoing: Array<{ id: string; revision: number; start_at: string; activity: string; category: string }>;
}
export interface ParseResult {
  time_entries: TimeRecord[]; transactions: MoneyRecord[]; clarify: string | null;
  time_events?: TimeEvent[]; archive_kind?: ArchiveKind | null; unsupported?: UnsupportedReason | null;
  time_corrections?: TimeCorrection[];
  answer?: string | null;
}
export interface DialogueTurn { text: string; reply: string | null; received_at: string }
export interface MemoryHit { id: string; kind: string; content: string; conversation_id?: string }
export interface MemoryJob {
  id: string; message_id: string; raw_input_id: string; lease_token: string; role: 'user' | 'assistant';
  content: string; happened_at: string; conversation_id: string; task_id: string | null; state: string;
}
export type MemoryOutcome = 'processing' | 'completed' | 'retry' | 'failed' | 'unknown';
export interface MemoryQueue {
  claimMemory(): Promise<MemoryJob | null>;
  finishMemory(job: MemoryJob, state: MemoryOutcome, taskId: string | null, code?: string): Promise<void>;
}
export interface MemoryBackend {
  search(query: string): Promise<MemoryHit[]>;
  submit(job: MemoryJob): Promise<{task_id: string; status: string}>;
  status(taskId: string): Promise<'running' | 'completed' | 'failed'>;
}
export interface ParserInput {
  text: string; received_at: string; categories: Category[]; clarifications: string[];
  context?: StewardContext;
  dialogue?: DialogueTurn[];
  memories?: MemoryHit[];
  memory_status?: 'enabled' | 'disabled' | 'unavailable';
}
export interface Parser { readonly enabled: boolean; parse(input: ParserInput): Promise<ParseResult> }
export interface IncomingInput {
  source: string; external_id: string; text: string; received_at: string;
  payload: Record<string, unknown>; input_kind: InputKind;
}
export interface RawInput extends IncomingInput {
  id: string; owner_id: string;
  status: 'pending' | 'awaiting_clarification' | 'parsed' | 'failed' | 'ignored';
  attempts: number; lease_token: string | null; lease_until: string | null;
  parse_result: Record<string, unknown> | null; error_code: string | null;
  clarification_for: string | null; clarification_prompt: string | null;
  reply_input_id: string | null; revoked_at: string | null;
  receipt_text: string | null; receipt_revision: number;
  reply_attempts: number; delivered_at: string | null;
}
export interface RecordSnapshot {
  time_entries: Array<{ start_at: string; end_at: string | null; duration_min: number | null; activity: string; category: string }>;
  transactions: Array<{ occurred_at: string; direction: 'expense' | 'income'; amount_cents: number;
    currency: string; category: string; account: string | null; note: string | null }>;
}
export interface ReplyTarget { user_id: string; context_token: string }
export interface DailySummary {
  command: 'daily'; day: string; as_of: string;
  time: Array<{ name: string; minutes: number }>;
  money: Array<{ currency: string; direction: 'expense' | 'income'; cents: string }>;
  covered_minutes: number; gap_minutes: number;
  gaps: Array<{ start_at: string; end_at: string; minutes: number }>;
  gaps_truncated: boolean; gap_min_minutes: number;
}
export interface DailyEnqueueResult {
  queued: boolean; reason: 'queued' | 'already_queued' | 'outside_window' | 'no_context'; input_id?: string;
}
export interface DailySummaryStore {
  dailySummary(at?: string): Promise<DailySummary>;
  enqueueDailySummary(): Promise<DailyEnqueueResult>;
}
export interface Store {
  saveRaw(input: IncomingInput, captureOnly: boolean): Promise<string>;
  claim(recordsEnabled: boolean): Promise<RawInput | null>;
  categories(): Promise<Category[]>;
  context(): Promise<StewardContext>;
  dialogue(input: RawInput): Promise<DialogueTurn[]>;
  clarifications(input: RawInput): Promise<string[]>;
  apply(input: RawInput, result: ParseResult, context?: StewardContext): Promise<RawInput>;
  fail(input: RawInput, code: string): Promise<RawInput>;
  command(input: RawInput, command: Command): Promise<RawInput>;
  records(id: string): Promise<RecordSnapshot>;
  queueReceipt(input: RawInput, text: string): Promise<void>;
  pendingReceipts(): Promise<RawInput[]>;
  replyTarget(input: RawInput): Promise<ReplyTarget>;
  delivered(input: RawInput): Promise<void>;
  replyFailed(input: RawInput): Promise<void>;
  check(): Promise<void>;
}
export interface Channel {
  run(onInput: (input: IncomingInput) => Promise<void>, signal: AbortSignal): Promise<void>;
  reply(target: ReplyTarget, text: string, clientId: string, signal?: AbortSignal): Promise<void>;
}
export function matchCommand(text: string): Command | null {
  const commands: Record<string, Command> = { '帮助': 'help', '今天': 'today', '撤销': 'undo',
    '停止': 'stop', '停止计时': 'stop', '停止记录': 'stop', '暂停计时': 'stop', '结束计时': 'stop',
    '先停止': 'stop', '先停止计时': 'stop', '先记到这里': 'stop', '我不记了': 'stop',
    '不要再计时了': 'stop', '别再计时了': 'stop',
    '取消': 'cancel', '算了': 'cancel', '取消追问': 'cancel', '停止追问': 'cancel',
    '别再问了': 'cancel', '不用问了': 'cancel' };
  return commands[text.trim().replace(/[。！!？?]+$/u, '')] ?? null;
}
