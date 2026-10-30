/**
 * [INPUT]: 本人HttpOnly会话或访客公开API地址。
 * [OUTPUT]: Cookie 请求、取消、版本冲突与私有二进制下载。
 * [POS]: 原版界面的唯一传输层；不读取或保存访问令牌。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {nativeEndpoint} from '../../access';
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}
export type QueryValue = string | number | boolean | undefined | null;
export type RequestOptions = {
  body?: unknown;
  params?: Record<string, QueryValue>;
  signal?: AbortSignal;
};
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
export async function logout(): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    credentials: "same-origin",
  });
  if (!response.ok) throw new ApiError(response.status, "退出失败，请重试");
  window.location.reload();
}
export async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    const endpoint=nativeEndpoint();
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: endpoint.startsWith('/api/visitor/')?'omit':"same-origin",
      cache: "no-store",
      signal: options.signal,
      body: JSON.stringify({
        method,
        path,
        params: options.params || {},
        body: options.body,
      }),
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(0, "无法连接云端 LifeOS，请检查网络后重试。");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      window.dispatchEvent(new Event("lifeos-session-expired"));
    throw new ApiError(
      response.status,
      payload?.message || payload?.error || "请求失败，请稍后重试。",
      payload,
    );
  }
  return payload as T;
}
export async function requestBlob(
  method: string,
  path: string,
  options: Omit<RequestOptions, "body"> = {},
): Promise<Response> {
  const result = await request<{
    base64: string;
    mime: string;
    filename: string;
  }>(method, path, options);
  const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "Content-Type": result.mime,
      "Content-Disposition": `attachment; filename="${result.filename.replace(/["\r\n]/g, "")}"`,
    },
  });
}
