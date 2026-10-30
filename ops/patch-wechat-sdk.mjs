/**
 * [INPUT]: 锁定的 wechatbot 2.2.0 协议实现与腾讯官方扫码等待约定。
 * [OUTPUT]: 可重复执行的扫码长轮询兼容补丁。
 * [POS]: ops 的依赖修正入口；只修改扫码状态请求，不触及消息或凭据。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const packagePath = new URL('./node_modules/@wechatbot/wechatbot/package.json', import.meta.url);
const targetPath = new URL('./node_modules/@wechatbot/wechatbot/dist/protocol/api.js', import.meta.url);
const expectedHash = '91f0c439fe71969b5dc1e5850f10493860f261a7fd7a1283895be4d0edb28c71';
const original = '        return this.http.apiGet(baseUrl, path, buildCommonHeaders());';
const patched = `        // LifeOS: 扫码长轮询遵循官方的 35 秒等待，超时不废弃二维码。
        try {
            const response = await this.http.request({
                method: 'GET',
                url: new URL(path, baseUrl).toString(),
                headers: buildCommonHeaders(),
                timeoutMs: 35_000,
            });
            return response.data;
        } catch (error) {
            if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
                return { status: 'wait' };
            }
            throw error;
        }`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const metadata = JSON.parse(await readFile(packagePath, 'utf8'));
if (metadata.version !== '2.2.0') throw new Error('SDK 版本变化，请先重新审阅兼容补丁。');
const source = await readFile(targetPath, 'utf8');
if (hash(source) === expectedHash && source.split(original).length === 2) {
  await writeFile(targetPath, source.replace(original, patched));
  process.stdout.write('WeChat QR polling patch applied\n');
} else if (source.includes(patched) && hash(source.replace(patched, original)) === expectedHash) {
  process.stdout.write('WeChat QR polling patch already applied\n');
} else {
  throw new Error('SDK 源码摘要变化，已停止修补。');
}
