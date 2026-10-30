/**
 * [INPUT]: iLink 合成消息、检查点与数据库确认替身。
 * [OUTPUT]: 原话先入库、游标可恢复、本人边界与回执协议证据。
 * [POS]: 微信传输验收；不调用真实微信接口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WeChatChannel, decodeMessage } from '../src/channel/wechat.js';
import { FileCheckpoint } from '../src/channel/checkpoint.js';
const credentials = { token: 'not-real', baseUrl: 'https://ilinkai.weixin.qq.com', accountId: 'bot', userId: 'self' };
const wire = (id: string) => ({ from_user_id: 'self', message_type: 1, message_state: 2, client_id: id,
  create_time_ms: 1792832400000, context_token: 'private', item_list: [{ type: 1, text_item: { text: '午饭38' } }] });

test('同批第二条入库失败时不推进游标，重投保留相同外部消息 ID', async () => {
  const cursors: string[] = []; const requests: unknown[] = [];
  const channel = new WeChatChannel({ post: async (_, body) => { requests.push(body);
    return { msgs: [wire('a'), wire('b')], get_updates_buf: 'next' }; } },
  { load: async () => '', commit: async (cursor) => { cursors.push(cursor); } }, credentials);
  const saved = new Set<string>(); let fail = true;
  const save = async (input: { external_id: string }) => {
    if (input.external_id === 'bot:b' && fail) throw new Error('DB down');
    saved.add(input.external_id);
  };
  await assert.rejects(channel.pollOnce(save)); assert.deepEqual(cursors, []);
  fail = false; await channel.pollOnce(save);
  assert.equal(saved.size, 2); assert.deepEqual(cursors, ['next']);
  assert.ok(requests.every((body) => (body as { get_updates_buf: string }).get_updates_buf === ''));
});
test('过滤他人和机器人消息，文字指令与不支持的附件分开识别', () => {
  assert.equal(decodeMessage({ ...wire('a'), from_user_id: 'other' }, credentials), null);
  assert.equal(decodeMessage({ ...wire('a'), message_type: 2 }, credentials), null);
  assert.equal(decodeMessage({ ...wire('a'), item_list: [] }, credentials)?.input_kind, 'unsupported');
  assert.equal(decodeMessage({ ...wire('a'), item_list: [{ type: 1, text_item: { text: '今天' } }] }, credentials)?.input_kind, 'command');
  assert.equal(decodeMessage(wire('a'), credentials)?.input_kind, 'record');
});
test('回执只发给本人，使用持久化的 context_token 与稳定 client_id', async () => {
  const calls: unknown[] = [];
  const channel = new WeChatChannel({ post: async (endpoint, body) => { calls.push({ endpoint, body }); return { ret: 0 }; } },
    { load: async () => '', commit: async () => {} }, credentials);
  await assert.rejects(channel.reply({ user_id: 'other', context_token: 'x' }, '已记录', 'stable'));
  assert.equal(calls.length, 0);
  await channel.reply({ user_id: 'self', context_token: 'context' }, '已记录', 'stable');
  const call = calls[0] as { endpoint: string; body: { msg: { client_id: string; context_token: string } } };
  assert.equal(call.endpoint, '/ilink/bot/sendmessage'); assert.equal(call.body.msg.client_id, 'stable');
  assert.equal(call.body.msg.context_token, 'context');
});
test('检查点原子落盘，私有权限，换绑账号时不复用旧游标', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lifeos-checkpoint-')); const path = join(dir, 'cursor.json');
  try {
    const checkpoint = new FileCheckpoint(path, 'a'); assert.equal(await checkpoint.load(), '');
    await checkpoint.commit('next'); assert.equal(await checkpoint.load(), 'next');
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(await new FileCheckpoint(path, 'b').load(), '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
