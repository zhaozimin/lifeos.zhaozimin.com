/**
 * [INPUT]: 原话、有限最近对话、可降级云记忆与受限事务仓储。
 * [OUTPUT]: 原话状态转换、时段命令、已提交回执和自然回答。
 * [POS]: 业务状态机；时段命令绕过模型，重试耗尽只恢复回执。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Parser, RawInput, Store, MemoryBackend, MemoryHit } from './contracts.js';
import type { Logger } from 'pino';
import { matchCommand } from './contracts.js';
import { errorCode } from './errors.js';
import { formatCommand, formatReceipt } from './reply.js';
import { parseTimeCommand } from './time-command.js';

export async function recoverReceipt(store: Store, input: RawInput): Promise<void> {
  if (input.revoked_at || input.receipt_text) return;
  let text: string | undefined;
  if (input.input_kind === 'unsupported') text = '目前支持文字记录。语音请先在微信转成文字后发送。';
  else if (input.status === 'awaiting_clarification') {
    text = input.clarification_prompt ?? undefined;
    if (text?.includes('重叠') && text.includes('网页')) {
      text = '这段时间已有记录。请发送“修改时段 日期 HH:MM-HH:MM 活动 [分类]”，我会保留区间外的内容并调整这一段。';
    }
  }
  else if (input.status === 'failed') {
    const reason = input.error_code === 'PARSER_QUOTA_EXHAUSTED' ? 'AI 账号本轮额度已用完'
      : input.error_code === 'PARSER_UPSTREAM_UNAVAILABLE' ? 'AI 服务暂时不可用'
      : input.error_code === 'PARSER_TIMEOUT' ? 'AI 服务响应超时' : '暂时无法完成回答或整理';
    const retry = input.attempts >= 5 ? '已达到重试上限。'
      : input.error_code === 'PARSER_QUOTA_EXHAUSTED' ? '请在额度恢复后重新处理。' : '稍后会重试。';
    text = `原话已保留，${reason}。${retry}`;
  }
  else if (input.status === 'parsed') text = input.input_kind === 'command'
    ? formatCommand(input) : formatReceipt(await store.records(input.id), input.parse_result);
  if (text) await store.queueReceipt(input, text);
}

export async function processNext(store: Store, parser: Parser, memory?:MemoryBackend, logger?:Logger): Promise<boolean> {
  const input = await store.claim(parser.enabled);
  if (!input) return false;
  if (input.revoked_at) return true;
  if (input.status === 'parsed' || input.status === 'awaiting_clarification'
    || (input.status === 'failed' && input.attempts >= 5)) {
    await recoverReceipt(store, input);
    return true;
  }
  if (input.input_kind === 'command') {
    const command = matchCommand(input.text);
    if (command) await recoverReceipt(store, await store.command(input, command));
    return true;
  }
  if (input.input_kind === 'unsupported') {
    await recoverReceipt(store, await store.apply(input, { time_entries: [], transactions: [], clarify: null }));
    return true;
  }
  try {
    const context = await store.context();
    const categories = await store.categories();
    const timeCommand = parseTimeCommand(input.text, input.received_at, categories);
    if (timeCommand) {
      await recoverReceipt(store, await store.apply(input, timeCommand, context));
      return true;
    }
    let memories:MemoryHit[]=[];
    let memory_status:'enabled'|'disabled'|'unavailable'=memory?'enabled':'disabled';
    if(memory)try{memories=await memory.search(input.text);}catch(error){
      memory_status='unavailable';logger?.warn({event:'memory_recall_unavailable',code:errorCode(error)});
    }
    const result = await parser.parse({ text: input.text, received_at: input.received_at,
      categories, clarifications: await store.clarifications(input),
      context, dialogue: await store.dialogue(input), memories, memory_status });
    const committed = await store.apply(input, result, context);
    await recoverReceipt(store, committed);
  } catch (error) {
    const code = errorCode(error);
    logger?.warn({ event: 'input_processing_failed', input_id: input.id, code });
    await recoverReceipt(store, await store.fail(input, code));
  }
  return true;
}
