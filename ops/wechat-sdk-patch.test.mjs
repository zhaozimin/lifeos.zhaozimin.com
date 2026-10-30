/**
 * [INPUT]: 已修补 SDK 的扫码协议边界与内存 HTTP 替身。
 * [OUTPUT]: 扫码等待恢复、请求超时与真实错误的回归结果。
 * [POS]: ops 的协议兼容测试；不连接微信，不生成真实会话。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ILinkApi } from './node_modules/@wechatbot/wechatbot/dist/protocol/api.js';

test('扫码长轮询等待 35 秒并保留确认结果', async () => {
  let request;
  const expected = { status: 'confirmed' };
  const api = new ILinkApi({ request: async (options) => {
    request = options;
    return { data: expected };
  } });
  assert.equal(await api.pollQrStatus('https://example.com', 'test code', '123456'), expected);
  assert.equal(request.timeoutMs, 35_000);
  assert.equal(new URL(request.url).searchParams.get('qrcode'), 'test code');
  assert.equal(new URL(request.url).searchParams.get('verify_code'), '123456');
});

for (const name of ['TimeoutError', 'AbortError']) {
  test(`${name} 保留同一二维码并继续等待`, async () => {
    const error = new Error('transient');
    error.name = name;
    const api = new ILinkApi({ request: async () => { throw error; } });
    assert.deepEqual(await api.pollQrStatus('https://example.com', 'test'), { status: 'wait' });
  });
}

test('真实错误继续传播，不伪装为扫码等待', async () => {
  const error = new Error('permission denied');
  const api = new ILinkApi({ request: async () => { throw error; } });
  await assert.rejects(api.pollQrStatus('https://example.com', 'test'), (actual) => actual === error);
});
