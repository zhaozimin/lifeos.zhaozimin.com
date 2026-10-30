/**
 * [INPUT]: Supabase Auth、本人标识、请求Cookie及私有订阅绑定。
 * [OUTPUT]: 独立请求会话、密码与 TOTP 状态机。
 * [POS]: 认证边界；请求客户端使用本人 JWT，禁止管理员密钥。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  createClient,
  type SupabaseClient,
  type Session,
  type User,
} from "@supabase/supabase-js";
import type { SessionState } from "../src/model";
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  OWNER_AUTH_ID: string;
  OWNER_EMAIL: string;
  SUBSCRIPTIONS?: {fetch(request:Request):Promise<Response>};
  ASSETS: { fetch: (r: Request) => Promise<Response> };
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const makeClient = (env: Env) =>
  createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
export type ClientFactory = typeof makeClient;
export interface AuthContext {
  client: SupabaseClient;
  user: User | null;
  session: Session | null;
  cookies: string[];
  secure: boolean;
}
const ttl = 8 * 60 * 60;
export function cookieNames(secure: boolean) {
  const prefix = secure ? "__Host-" : "";
  return [`${prefix}lifeos-access`, `${prefix}lifeos-refresh`];
}
export function saveSession(ctx: AuthContext, session: Session | null) {
  ctx.session = session;
  const names = cookieNames(ctx.secure),
    values = [session?.access_token, session?.refresh_token];
  ctx.cookies = names.map(
    (name, i) =>
      `${name}=${values[i] ? encodeURIComponent(values[i]!) : ""}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${session ? ttl : 0}${ctx.secure ? "; Secure" : ""}`,
  );
}
export async function context(
  request: Request,
  env: Env,
  factory: ClientFactory = makeClient,
): Promise<AuthContext> {
  const ctx: AuthContext = {
    client: factory(env),
    user: null,
    session: null,
    cookies: [],
    secure: new URL(request.url).protocol === "https:",
  };
  const parsed = new Map(
    (request.headers.get("Cookie") ?? "").split(";").map((x) => {
      const i = x.indexOf("=");
      return [x.slice(0, i).trim(), x.slice(i + 1)];
    }),
  );
  const names = cookieNames(ctx.secure),
    access = parsed.get(names[0]),
    refresh = parsed.get(names[1]);
  if (!access || !refresh) return ctx;
  let session: Session | null = null;
  try {
    const restored = await ctx.client.auth.setSession({
      access_token: decodeURIComponent(access),
      refresh_token: decodeURIComponent(refresh),
    });
    if (restored.error || !restored.data.session)
      throw new Error("invalid session");
    session = restored.data.session;
    const verified = await ctx.client.auth.getUser(session.access_token);
    if (
      verified.error ||
      !verified.data.user ||
      verified.data.user.id !== env.OWNER_AUTH_ID
    )
      throw new Error("invalid owner");
    ctx.user = verified.data.user;
    ctx.session = session;
    if (session.access_token !== decodeURIComponent(access))
      saveSession(ctx, session);
  } catch {
    saveSession(ctx, null);
  }
  return ctx;
}
export function requireOwner(ctx: AuthContext, env: Env) {
  if (!ctx.user || ctx.user.id !== env.OWNER_AUTH_ID)
    throw new HttpError(401, "请先登录");
}
export async function requireAal2(ctx: AuthContext, env: Env) {
  requireOwner(ctx, env);
  const { data, error } =
    await ctx.client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || data?.currentLevel !== "aal2")
    throw new HttpError(403, "请完成动态码验证");
}
export async function state(ctx: AuthContext, env: Env): Promise<SessionState> {
  if (!ctx.user) return { stage: "anonymous" };
  requireOwner(ctx, env);
  const factors = await ctx.client.auth.mfa.listFactors();
  if (factors.error) throw new HttpError(503, "暂时无法读取验证器，请稍后重试");
  const verified = factors.data.totp.find((f) => f.status === "verified");
  const level = await ctx.client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level.error) throw new HttpError(503, "暂时无法验证会话");
  if (level.data.currentLevel === "aal2" && verified) return { stage: "ready" };
  if (verified) return { stage: "verify", factorId: verified.id };
  return {
    stage: ctx.user.user_metadata?.passwordSetupComplete
      ? "enroll"
      : "password",
  };
}
export async function login(ctx: AuthContext, env: Env, password: string) {
  const { data, error } = await ctx.client.auth.signInWithPassword({
    email: env.OWNER_EMAIL,
    password,
  });
  if (error || !data.session || data.user?.id !== env.OWNER_AUTH_ID)
    throw new HttpError(
      error?.status === 429 ? 429 : 401,
      "密码无效或登录过于频繁，请稍后重试",
    );
  ctx.user = data.user;
  saveSession(ctx, data.session);
  return state(ctx, env);
}
export async function setPassword(
  ctx: AuthContext,
  env: Env,
  password: string,
) {
  requireOwner(ctx, env);
  if ((await state(ctx, env)).stage !== "password")
    throw new HttpError(403, "当前会话不允许首次设置密码");
  const { data, error } = await ctx.client.auth.updateUser({
    password,
    data: { passwordSetupComplete: true },
  });
  if (error)
    throw new HttpError(400, "密码设置失败，请使用至少 20 位的新密码后重试");
  ctx.user = data.user;
  const current = await ctx.client.auth.getSession();
  if (current.data.session) saveSession(ctx, current.data.session);
  return state(ctx, env);
}
export async function enroll(ctx: AuthContext, env: Env) {
  requireOwner(ctx, env);
  if ((await state(ctx, env)).stage !== "enroll")
    throw new HttpError(403, "请按页面顺序完成设置");
  const factors = await ctx.client.auth.mfa.listFactors();
  if (factors.error) throw new HttpError(503, "验证器暂不可用");
  for (const factor of factors.data.all) {
    if (
      factor.status === "unverified" &&
      factor.friendly_name === "LifeOS Web"
    ) {
      const removed = await ctx.client.auth.mfa.unenroll({
        factorId: factor.id,
      });
      if (removed.error) throw new HttpError(503, "请稍后重新绑定");
    }
  }
  const { data, error } = await ctx.client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "LifeOS Web",
    issuer: "LifeOS",
  });
  if (error) throw new HttpError(400, "无法生成二维码，请稍后重试");
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}
export async function verify(
  ctx: AuthContext,
  env: Env,
  factorId: string,
  code: string,
) {
  requireOwner(ctx, env);
  const factors = await ctx.client.auth.mfa.listFactors();
  if (
    factors.error ||
    !factors.data.all.some((f) => f.id === factorId && f.factor_type === "totp")
  )
    throw new HttpError(400, "请重新获取验证器");
  const { data, error } = await ctx.client.auth.mfa.challengeAndVerify({
    factorId,
    code,
  });
  if (error)
    throw new HttpError(
      error.status === 429 ? 429 : 400,
      "动态码无效或已过期，请使用当前 6 位数字",
    );
  // MFA 返回新令牌；显式恢复客户端，确保后续数据库请求使用 AAL2。
  const restored = await ctx.client.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (restored.error || !restored.data.session)
    throw new HttpError(503, "会话更新失败，请重新登录");
  saveSession(ctx, restored.data.session);
  return state(ctx, env);
}
