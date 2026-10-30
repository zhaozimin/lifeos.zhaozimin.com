/**
 * [INPUT]: 原话、有限最近对话、可降级云记忆与受限事务仓储。
 * [OUTPUT]: 原话状态转换、已提交账目回执与持久化自然回答。
 * [POS]: 业务状态机；记忆不可用时继续问答，账目事实不由记忆补猜。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Parser, RawInput, Store, MemoryBackend, MemoryHit } from './contracts.js';
import type { Logger } from 'pino';
import { matchCommand } from './contracts.js';
import { errorCode } from './errors.js';
import { formatCommand, formatReceipt } from './reply.js';

export async function recoverReceipt(store: Store, input: RawInput): Promise<void> {
  if (input.revoked_at || input.receipt_text) return;
  let text: string | undefined;
  if (input.input_kind === 'unsupported') text = '目前支持文字记录。语音请先在微信转成文字后发送。';
  else if (input.status === 'awaiting_clarification') text = input.clarification_prompt ?? undefined;
  else if (input.status === 'failed') text = '原话已保留，暂时无法完成回答或整理，稍后会重试。';
  else if (input.status === 'parsed') text = input.input_kind === 'command'
    ? formatCommand(input) : formatReceipt(await store.records(input.id), input.parse_result);
  if (text) await store.queueReceipt(input, text);
}

export async function processNext(store: Store, parser: Parser, memory?:MemoryBackend, logger?:Logger): Promise<boolean> {
  const input = await store.claim(parser.enabled);
  if (!input) return false;
  if (input.revoked_at) return true;
  if (input.status === 'parsed' || input.status === 'awaiting_clarification') {
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
    let memories:MemoryHit[]=[];
    let memory_status:'enabled'|'disabled'|'unavailable'=memory?'enabled':'disabled';
    if(memory)try{memories=await memory.search(input.text);}catch(error){
      memory_status='unavailable';logger?.warn({event:'memory_recall_unavailable',code:errorCode(error)});
    }
    const result = await parser.parse({ text: input.text, received_at: input.received_at,
      categories: await store.categories(), clarifications: await store.clarifications(input),
      context, dialogue: await store.dialogue(input), memories, memory_status });
    const committed = await store.apply(input, result, context);
    await recoverReceipt(store, committed);
  } catch (error) {
    await recoverReceipt(store, await store.fail(input, errorCode(error)));
  }
  return true;
}
