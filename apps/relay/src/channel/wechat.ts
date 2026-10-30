/**
 * [INPUT]: iLink 传输、本人微信标识与数据库确认回调。
 * [OUTPUT]: 归一化原话、持久化后推进的游标与本人回执。
 * [POS]: Channel 的微信实现；不使用 SDK 提前推进游标的默认轮询器。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import type { Channel, IncomingInput, ReplyTarget } from '../contracts.js';
import { matchCommand } from '../contracts.js';
import { RelayError } from '../errors.js';
import type { Checkpoint } from './checkpoint.js';
import type { ILinkTransport, WeChatCredentials } from './http.js';

const baseInfo = { channel_version: '2.2.0', bot_agent: 'LifeOS/0.1 (relay)' };
export function decodeMessage(wire: Record<string, unknown>, credentials: WeChatCredentials): IncomingInput | null {
  if (wire.from_user_id !== credentials.userId || wire.message_type !== 1 || wire.message_state !== 2) return null;
  const items = Array.isArray(wire.item_list) ? wire.item_list as Array<Record<string, unknown>> : [];
  const text = items.map((item) => {
    const value = item.type === 1 ? item.text_item : item.type === 3 ? item.voice_item : null;
    return value && typeof value === 'object' && typeof (value as Record<string, unknown>).text === 'string'
      ? String((value as Record<string, unknown>).text) : '';
  }).filter(Boolean).join('\n');
  const identity = typeof wire.client_id === 'string' && wire.client_id ? wire.client_id
    : typeof wire.message_id === 'string' ? wire.message_id
    : typeof wire.message_id === 'number' && Number.isSafeInteger(wire.message_id) ? String(wire.message_id)
    : createHash('sha256').update(JSON.stringify(wire)).digest('hex');
  const timestamp = typeof wire.create_time_ms === 'number' && Number.isFinite(wire.create_time_ms)
    ? new Date(wire.create_time_ms) : new Date();
  return { source: 'wechat', external_id: `${credentials.accountId}:${identity}`,
    text, received_at: timestamp.toISOString(), payload: wire,
    input_kind: !text ? 'unsupported' : matchCommand(text) ? 'command' : 'record' };
}

export class WeChatChannel implements Channel {
  private cursor = '';
  constructor(private readonly transport: ILinkTransport, private readonly checkpoint: Checkpoint,
    private readonly credentials: WeChatCredentials) {}

  async pollOnce(onInput: (input: IncomingInput) => Promise<void>, signal?: AbortSignal): Promise<void> {
    const updates = await this.transport.post('/ilink/bot/getupdates', {
      get_updates_buf: this.cursor, base_info: baseInfo,
    }, 40_000, signal);
    const messages = Array.isArray(updates.msgs) ? updates.msgs as Array<Record<string, unknown>> : [];
    for (const wire of messages) {
      const input = decodeMessage(wire, this.credentials);
      if (input) await onInput(input);
    }
    // 全批原话已获得数据库确认，才能跨过该批次。
    if (typeof updates.get_updates_buf === 'string' && updates.get_updates_buf !== this.cursor) {
      await this.checkpoint.commit(updates.get_updates_buf);
      this.cursor = updates.get_updates_buf;
    }
  }
  async run(onInput: (input: IncomingInput) => Promise<void>, signal: AbortSignal): Promise<void> {
    this.cursor = await this.checkpoint.load();
    let retryMs = 1_000;
    while (!signal.aborted) {
      try {
        await this.pollOnce(onInput, signal);
        retryMs = 1_000;
      } catch (error) {
        if (signal.aborted) break;
        if (error instanceof RelayError && error.code === 'WECHAT_SESSION_EXPIRED') throw error;
        await delay(retryMs, undefined, { signal }).catch(() => {});
        retryMs = Math.min(retryMs * 2, 30_000);
      }
    }
  }
  async reply(target: ReplyTarget, text: string, clientId: string, signal?: AbortSignal): Promise<void> {
    if (target.user_id !== this.credentials.userId || !target.context_token) throw new RelayError('REPLY_TARGET_INVALID');
    await this.transport.post('/ilink/bot/sendmessage', {
      msg: { from_user_id: '', to_user_id: target.user_id, client_id: clientId,
        message_type: 2, message_state: 2, context_token: target.context_token,
        item_list: [{ type: 1, text_item: { text } }] }, base_info: baseInfo,
    }, 15_000, signal);
  }
}
