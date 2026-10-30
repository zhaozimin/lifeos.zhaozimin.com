/**
 * [INPUT]: 私有 iLink 会话与协议请求。
 * [OUTPUT]: 经校验的 JSON 响应及安全错误码。
 * [POS]: 唯一微信 HTTP 边界；不打印地址参数、请求体或认证头。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { randomBytes } from 'node:crypto';
import { RelayError } from '../errors.js';

export interface WeChatCredentials { token: string; baseUrl: string; accountId: string; userId: string }
export interface ILinkTransport {
  post(endpoint: string, body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<Record<string, unknown>>;
}
export class ILinkHttp implements ILinkTransport {
  constructor(private readonly credentials: WeChatCredentials) {
    const url = new URL(credentials.baseUrl);
    if (url.protocol !== 'https:' || !(url.hostname === 'weixin.qq.com' || url.hostname.endsWith('.weixin.qq.com'))) {
      throw new RelayError('WECHAT_HOST_INVALID');
    }
  }
  async post(endpoint: string, body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal) {
    const signals = [AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])];
    let response: Response;
    try {
      response = await fetch(new URL(endpoint, this.credentials.baseUrl), {
        method: 'POST', signal: AbortSignal.any(signals),
        headers: { 'Content-Type': 'application/json', AuthorizationType: 'ilink_bot_token',
          Authorization: `Bearer ${this.credentials.token}`,
          'X-WECHAT-UIN': Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64'),
          'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': String((2 << 16) | (2 << 8)),
        }, body: JSON.stringify(body),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new RelayError(error instanceof Error && error.name === 'TimeoutError' ? 'WECHAT_TIMEOUT' : 'WECHAT_NETWORK_FAILED');
    }
    if (!response.ok) throw new RelayError(`WECHAT_HTTP_${response.status}`);
    let data: Record<string, unknown>;
    try { data = await response.json() as Record<string, unknown>; }
    catch { throw new RelayError('WECHAT_JSON_INVALID'); }
    if (data.errcode === -14 || data.ret === -14) throw new RelayError('WECHAT_SESSION_EXPIRED');
    if ((typeof data.ret === 'number' && data.ret !== 0) ||
      (typeof data.errcode === 'number' && data.errcode !== 0)) throw new RelayError('WECHAT_API_FAILED');
    return data;
  }
}
