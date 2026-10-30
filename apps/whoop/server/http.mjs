/**
 * [INPUT]: 依赖 Node.js 原生 fetch 与 AbortSignal。
 * [OUTPUT]: 导出 AppError、requestJson 与有长度限制的 JSON 读取。
 * [POS]: server 的传输边界；上游正文不进入日志或浏览器错误。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function requestJson(url, options = {}, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(url, {
      ...options,
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new AppError(502, "WHOOP 连接超时或网络不可用，请稍后重试。");
  }
  if (!response.ok) {
    const messages = {
      400: "WHOOP 拒绝请求，请检查授权配置，必要时重新授权。",
      401: "WHOOP 授权已失效，请重新连接。",
      403: "WHOOP 权限不足，请启用全部所需读取权限后重新授权。",
      429: "WHOOP 请求次数达到限制，请稍后再同步。",
    };
    throw new AppError(
      response.status,
      messages[response.status] || "WHOOP 服务暂时不可用，请稍后重试。",
    );
  }
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    throw new AppError(502, "WHOOP 返回了无法读取的数据。");
  }
}

export async function readJson(req) {
  if (!(req.headers["content-type"] || "").startsWith("application/json"))
    throw new AppError(415, "请使用 JSON 请求。");
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 16384)
      throw new AppError(413, "请求内容过长。");
  }
  try {
    const data = JSON.parse(body || "{}");
    if (!data || Array.isArray(data) || typeof data !== "object")
      throw new Error();
    return data;
  } catch {
    throw new AppError(400, "请求不是有效的 JSON 对象。");
  }
}
