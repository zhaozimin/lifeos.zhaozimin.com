/**
 * [INPUT]: Pages Request、登录保护、环境绑定与认证查询模块。
 * [OUTPUT]: 公开只读投影与本人AAL2后的私有查询及编辑。
 * [POS]: 唯一网络入口；访客独立客户端不能继承本人身份。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { z } from "zod";
import {
  context,
  login,
  state,
  setPassword,
  enroll,
  verify,
  requireAal2,
  saveSession,
  HttpError,
  makeClient,
  type Env,
  type ClientFactory,
  type AuthContext,
} from "./auth";
import { native } from "./native";
import { dashboard } from "./data";
import { records, recordDetail, editRecord, attachment } from "./records";
import { health } from './health';
import {subscriptions} from './subscriptions';
import {visitor} from './visitor';
import {guardLogin} from './login-guard';
const security: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://www.google.com https://cdn.jsdelivr.net https://cdn.simpleicons.org https://*.mzstatic.com https://picx.zhimg.com https://d2u1z1lopyfwlx.cloudfront.net; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
};
async function body(request: Request, limit = 4096) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new HttpError(415, "请求格式无效");
  if (Number(request.headers.get("Content-Length")) > limit)
    throw new HttpError(413, "请求过大");
  const text = await request.text();
  if (text.length > limit) throw new HttpError(413, "请求过大");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "请求格式无效");
  }
}
export function createWorker(factory: ClientFactory = makeClient) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)){
        url.protocol='https:';
        return Response.redirect(url.toString(),308);
      }
      let ctx: AuthContext | undefined;
      const reply = (value: unknown, status = 200) => {
        const headers = new Headers({
          ...security,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "private, no-store",
          Vary: "Cookie",
        });
        if(status===429)headers.set('Retry-After','60');
        for (const cookie of ctx?.cookies ?? [])
          headers.append("Set-Cookie", cookie);
        return new Response(JSON.stringify(value), { status, headers });
      };
      if (!url.pathname.startsWith("/api/")) {
        const redirects: Record<string,string> = {"/":"/dashboard/time/day","/today":"/dashboard/time/day","/time":"/dashboard/time/stats","/money":"/dashboard/fin/status","/records":"/dashboard/records","/inbox":"/dashboard/inbox","/security":"/dashboard/security"};
        if (redirects[url.pathname]) return Response.redirect(url.origin+redirects[url.pathname],302);
        const response = await env.ASSETS.fetch(request),
          headers = new Headers(response.headers);
        for (const [name, value] of Object.entries(security))
          headers.set(name, value);
        if(url.pathname.startsWith('/health-console/')||url.pathname.startsWith('/subscriptions-console/')){
          headers.set('X-Frame-Options','SAMEORIGIN');
          headers.set('Content-Security-Policy',security['Content-Security-Policy'].replace("frame-ancestors 'none'","frame-ancestors 'self'"));
        }
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      }
      try {
        if (request.method !== "GET" && request.method !== "POST")
          throw new HttpError(405, "请求方法无效");
        if (
          request.method === "POST" &&
          (request.headers.get("Origin") !== url.origin ||
            request.headers.get("Sec-Fetch-Site") === "cross-site")
        )
          throw new HttpError(403, "请从本站发起请求");
        if (
          !env.SUPABASE_URL ||
          !env.SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_") ||
          !env.OWNER_AUTH_ID ||
          !env.OWNER_EMAIL
        )
          throw new HttpError(503, "网站配置尚未完成");
        if(url.pathname.startsWith('/api/visitor/')){
          const value=await visitor(factory(env),env,url,request.method,request.method==='POST'?await body(request,4096):undefined);
          if(!(value instanceof Response))return reply(value);
          return new Response(value.body,{status:value.status,headers:{...security,'Content-Type':value.headers.get('Content-Type')||'application/octet-stream','Cache-Control':'private, no-store',Vary:'Cookie'}});
        }
        await guardLogin(request,env);
        ctx = await context(request, env, factory);
        if(url.pathname.startsWith('/api/subscriptions/')){
          await requireAal2(ctx,env);
          const result=await subscriptions(env.SUBSCRIPTIONS,url,request.method,request.method==='POST'?await body(request,2_100_000):undefined);
          const headers=new Headers({...security,'Cache-Control':'private, no-store',Vary:'Cookie'});
          headers.set('Content-Type',result.headers.get('Content-Type')||'application/octet-stream');
          for(const cookie of ctx.cookies)headers.append('Set-Cookie',cookie);
          return new Response(result.body,{status:result.status,headers});
        }
        if(url.pathname.startsWith('/api/health/')){
          await requireAal2(ctx,env);
          const result=await health(ctx.client,url,request.method,request.method==='POST'?await body(request,20000):undefined);
          if(!(result instanceof Response))return reply(result);
          const headers=new Headers({...security,'Cache-Control':'private, no-store',Vary:'Cookie'});
          result.headers.forEach((v,k)=>headers.set(k,v));
          for(const cookie of ctx.cookies)headers.append('Set-Cookie',cookie);
          return new Response(result.body,{status:result.status,headers});
        }
        if (request.method === "GET" && url.pathname === "/api/session")
          return reply(await state(ctx, env));
        if (request.method === "GET" && url.pathname === "/api/dashboard") {
          await requireAal2(ctx, env);
          return reply(await dashboard(ctx.client, url));
        }
        if (
          request.method === "GET" &&
          ["/api/records", "/api/record", "/api/attachment"].includes(
            url.pathname,
          )
        ) {
          await requireAal2(ctx, env);
          if (url.pathname === "/api/records")
            return reply(await records(ctx.client, url));
          if (url.pathname === "/api/record")
            return reply(await recordDetail(ctx.client, url));
          const file = await attachment(
            ctx.client,
            url.searchParams.get("id") ?? "",
          );
          const headers = new Headers({
            ...security,
            "Content-Type": file.mime,
            "Cache-Control": "private, no-store",
            Vary: "Cookie",
            "Content-Disposition": `${file.mime === "application/octet-stream" ? "attachment" : "inline"}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
          });
          for (const cookie of ctx.cookies)
            headers.append("Set-Cookie", cookie);
          return new Response(file.bytes, { headers });
        }
        if (request.method === "POST") {
          if (url.pathname === "/api/native") {
            await requireAal2(ctx,env);
            return reply(await native(ctx.client,await body(request,15_000_000)));
          }
          if (url.pathname === "/api/records/edit") {
            await requireAal2(ctx, env);
            return reply(
              await editRecord(ctx.client, await body(request, 65536)),
            );
          }
          const input = await body(request);
          if (url.pathname === "/api/auth/login") {
            const { password } = z
              .object({ password: z.string().min(1).max(256) })
              .parse(input);
            return reply(await login(ctx, env, password));
          }
          if (url.pathname === "/api/auth/password") {
            const { password } = z
              .object({ password: z.string().min(20).max(256) })
              .parse(input);
            return reply(await setPassword(ctx, env, password));
          }
          if (url.pathname === "/api/auth/enroll")
            return reply(await enroll(ctx, env));
          if (url.pathname === "/api/auth/verify") {
            const { factorId, code } = z
              .object({ factorId: z.uuid(), code: z.string().regex(/^\d{6}$/) })
              .parse(input);
            return reply(await verify(ctx, env, factorId, code));
          }
          if (url.pathname === "/api/auth/logout") {
            if (ctx.user) await ctx.client.auth.signOut({ scope: "local" });
            saveSession(ctx, null);
            return reply({ stage: "anonymous" });
          }
        }
        throw new HttpError(404, "接口不存在");
      } catch (error) {
        if (error instanceof HttpError)
          return reply({ error: error.message }, error.status);
        if (error instanceof z.ZodError)
          return reply({ error: "请检查输入格式" }, 400);
        return reply({ error: "服务暂时不可用，请稍后重试" }, 503);
      }
    },
  };
}
export default createWorker();
