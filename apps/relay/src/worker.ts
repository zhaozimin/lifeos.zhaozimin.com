/**
 * [INPUT]: 仓储、解析器、微信通道、可选记忆队列与统一日志。
 * [OUTPUT]: 串行agy处理、独立回执投递与后台记忆同步。
 * [POS]: 常驻调度器；记忆和回执不占用agy串行处理队列。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { setTimeout as delay } from 'node:timers/promises';
import type { Logger } from 'pino';
import type { Channel, Parser, Store, MemoryBackend, MemoryQueue } from './contracts.js';
import { errorCode } from './errors.js';
import { processNext } from './processor.js';
import { runMemorySync } from './memory/worker.js';

async function runInputs(store: Store, parser: Parser, logger: Logger,
  signal: AbortSignal, memory?:MemoryBackend): Promise<void> {
  while (!signal.aborted) {
    let work = false;
    try {
      work = await processNext(store, parser, memory, logger);
    } catch (error) {
      logger.error({ event: 'worker_deferred', code: errorCode(error) });
    }
    if (!work) await delay(2_000, undefined, { signal }).catch(() => {});
  }
}

async function runOutbox(store: Store, channel: Channel, logger: Logger,
  signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      for (const input of await store.pendingReceipts()) {
        if (signal.aborted) break;
        try {
          const target = await store.replyTarget(input);
          await channel.reply(target, input.receipt_text!, `lifeos:${input.id}:${input.receipt_revision}`, signal);
          await store.delivered(input);
        } catch (error) {
          if (signal.aborted) break;
          await store.replyFailed(input);
          logger.warn({ event: 'reply_deferred', input_id: input.id, code: errorCode(error) });
        }
      }
    } catch (error) {
      logger.error({ event: 'outbox_deferred', code: errorCode(error) });
    }
    await delay(1_000, undefined, { signal }).catch(() => {});
  }
}

export async function runWorker(store: Store, parser: Parser, channel: Channel, logger: Logger,
  signal: AbortSignal, memory?:{backend:MemoryBackend;queue:MemoryQueue}): Promise<void> {
  await Promise.all([runInputs(store, parser, logger, signal,memory?.backend),runOutbox(store,channel,logger,signal),
    ...(memory?[runMemorySync(memory.queue,memory.backend,logger,signal)]:[])]);
}
