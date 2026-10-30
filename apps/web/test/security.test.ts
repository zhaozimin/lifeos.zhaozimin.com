/**
 * [INPUT]: Worker 入口与受控 Auth 客户端。
 * [OUTPUT]: 身份、AAL2、同源、Cookie 与首次设置边界验收。
 * [POS]: API 安全测试；拒绝路径必须发生在任何账目查询前。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorker } from "../worker/index";
import {
  context,
  cookieNames,
  saveSession,
  type Env,
  type ClientFactory,
  type AuthContext,
} from "../worker/auth";
const env: Env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  OWNER_AUTH_ID: "owner",
  OWNER_EMAIL: "owner@example.com",
  ASSETS: { fetch: async () => new Response("<html>公共登录入口</html>") },
  SUBSCRIPTIONS: { fetch: async () => new Response(null,{status:204}) },
};
const session = {
  access_token: "access",
  refresh_token: "refresh",
  user: { id: "owner", user_metadata: {} },
};
function fake(
  options: {
    owner?: string;
    aal?: string;
    verified?: boolean;
    expired?: boolean;
  } = {},
) {
  let queries = 0,
    passwordUpdates = 0;
  const user = {
    id: options.owner ?? "owner",
    user_metadata: { passwordSetupComplete: false },
  };
  const client = {
    auth: {
      setSession: async () => ({
        data: {
          session: {
            ...session,
            access_token: options.expired ? "renewed" : "access",
          },
        },
        error: null,
      }),
      getUser: async () => ({ data: { user }, error: null }),
      signInWithPassword: async () => ({
        data: { session, user },
        error: null,
      }),
      getSession: async () => ({ data: { session }, error: null }),
      updateUser: async () => {
        passwordUpdates++;
        return {
          data: {
            user: { ...user, user_metadata: { passwordSetupComplete: true } },
          },
          error: null,
        };
      },
      signOut: async () => ({ error: null }),
      mfa: {
        listFactors: async () => ({
          data: {
            totp: options.verified
              ? [{ id: "factor", status: "verified" }]
              : [],
            all: [],
          },
          error: null,
        }),
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: options.aal ?? "aal1" },
          error: null,
        }),
      },
    },
    from: () => {
      queries++;
      throw new Error("账目查询不得执行");
    },
  };
  return {
    factory: (() => client) as unknown as ClientFactory,
    get queries() {
      return queries;
    },
    get passwordUpdates() {
      return passwordUpdates;
    },
  };
}
function request(
  path: string,
  body?: unknown,
  cookies = true,
  origin = "https://lifeos.example",
) {
  return new Request("https://lifeos.example" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      'CF-Connecting-IP':'192.0.2.1',
      ...(cookies
        ? {
            Cookie:
              "__Host-lifeos-access=access; __Host-lifeos-refresh=refresh",
          }
        : {}),
      ...(body === undefined
        ? {}
        : { Origin: origin, "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
test("未登录不能读取数据", async () => {
  const f = fake(),
    r = await createWorker(f.factory).fetch(
      request("/api/dashboard", undefined, false),
      env,
    );
  assert.equal(r.status, 401);
  assert.equal(f.queries, 0);
});
test('健康副本和异步任务在查询前要求本人AAL2',async()=>{
 for(const path of ['/api/health/status','/api/health/dashboard','/api/health/plans','/api/health/export','/api/health/jobs/11111111-1111-4111-8111-111111111111']){
  for(const options of [{},{owner:'other',aal:'aal2'}]){
   const f=fake(options),r=await createWorker(f.factory).fetch(request(path),env);
   assert.ok([401,403].includes(r.status));assert.equal(f.queries,0);
  }
 }
});
test('仅健康静态控制台允许本站嵌入，其他页面维持禁止嵌入',async()=>{
 const worker=createWorker(fake().factory);
 const health=await worker.fetch(request('/health-console/index.html',undefined,false),env);
 assert.equal(health.headers.get('X-Frame-Options'),'SAMEORIGIN');
 assert.match(health.headers.get('Content-Security-Policy')??'',/frame-ancestors 'self'/);
 const normal=await worker.fetch(request('/dashboard/time/day',undefined,false),env);
 assert.equal(normal.headers.get('X-Frame-Options'),'DENY');
});
test("密码 AAL1 会话在查询前被拒绝", async () => {
  const f = fake(),
    r = await createWorker(f.factory).fetch(request("/api/dashboard"), env);
  assert.equal(r.status, 403);
  assert.equal(f.queries, 0);
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
});
test("其他用户即使 AAL2 也不能读取", async () => {
  const f = fake({ owner: "intruder", aal: "aal2" }),
    r = await createWorker(f.factory).fetch(request("/api/dashboard"), env);
  assert.equal(r.status, 401);
  assert.equal(f.queries, 0);
});
test("历史、详情、附件和编辑均在访问数据库前要求本人 AAL2", async () => {
  for (const path of [
    "/api/records",
    "/api/record",
    "/api/attachment",
    "/api/records/edit",
  ]) {
    for (const [options, cookies, status] of [
      [{}, false, 401],
      [{}, true, 403],
      [{ owner: "intruder", aal: "aal2" }, true, 401],
    ] as const) {
      const f = fake(options);
      const response = await createWorker(f.factory).fetch(
        request(path, path.endsWith("/edit") ? {} : undefined, cookies),
        env,
      );
      assert.equal(response.status, status, path);
      assert.equal(f.queries, 0);
    }
  }
});
test("人工编辑拒绝跨站请求，拒绝发生在身份和字段读取前", async () => {
  const f = fake({ aal: "aal2" });
  const response = await createWorker(f.factory).fetch(
    request("/api/records/edit", {}, true, "https://other.example"),
    env,
  );
  assert.equal(response.status, 403);
  assert.equal(f.queries, 0);
});
test("禁止跨站和没有 Origin 的写请求", async () => {
  for (const origin of ["https://attacker.example", ""]) {
    const f = fake(),
      r = await createWorker(f.factory).fetch(
        request("/api/auth/login", { password: "x" }, false, origin),
        env,
      );
    assert.equal(r.status, 403);
  }
});
test("首次登录允许设置本人密码，但不能读账目", async () => {
  const f = fake(),
    r = await createWorker(f.factory).fetch(
      request("/api/auth/login", { password: "existing" }, false),
      env,
    );
  assert.deepEqual(await r.json(), { stage: "password" });
  const cookies = r.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  for (const c of cookies) {
    assert.ok(c.includes("__Host-"));
    assert.ok(c.includes("HttpOnly"));
    assert.ok(c.includes("Secure"));
    assert.ok(c.includes("SameSite=Strict"));
    assert.ok(!c.includes("Domain="));
  }
});
test("已有验证器时，AAL1 不能绕过动态码重设密码", async () => {
  const f = fake({ verified: true }),
    r = await createWorker(f.factory).fetch(
      request("/api/auth/password", { password: "a".repeat(20) }),
      env,
    );
  assert.equal(r.status, 403);
  assert.equal(f.passwordUpdates, 0);
});
test("密码少于 20 位被拒绝", async () => {
  const f = fake(),
    r = await createWorker(f.factory).fetch(
      request("/api/auth/password", { password: "short" }),
      env,
    );
  assert.equal(r.status, 400);
  assert.equal(f.passwordUpdates, 0);
});
test("动态码必须为六位数字", async () => {
  const f = fake(),
    r = await createWorker(f.factory).fetch(
      request("/api/auth/verify", {
        factorId: "bda1cbb5-8ddb-40bb-9554-98fb6c61bfa5",
        code: "12345x",
      }),
      env,
    );
  assert.equal(r.status, 400);
});
test("过期令牌刷新后写回安全 Cookie", async () => {
  const f = fake({ expired: true }),
    ctx = await context(request("/api/session"), env, f.factory);
  assert.equal(ctx.user?.id, "owner");
  assert.ok(ctx.cookies[0].includes("renewed"));
});
test("退出清除两个会话 Cookie", async () => {
  const f = fake(),
    r = await createWorker(f.factory).fetch(
      request("/api/auth/logout", {}),
      env,
    );
  for (const c of r.headers.getSetCookie()) assert.ok(c.includes("Max-Age=0"));
});
test("生产强制 publishable key，拒绝管理员密钥误配", async () => {
  const f = fake(),
    r = await createWorker(f.factory).fetch(
      request("/api/session", undefined, false),
      { ...env, SUPABASE_PUBLISHABLE_KEY: "sb_secret_test" },
    );
  assert.equal(r.status, 503);
});
test("静态外壳带 CSP，不包含账目", async () => {
  const f = fake(),
    r = await createWorker(f.factory).fetch(
      request("/dashboard/time/day", undefined, false),
      env,
    );
  assert.equal(r.status, 200);
  assert.ok(
    r.headers
      .get("Content-Security-Policy")
      ?.includes("frame-ancestors 'none'"),
  );
  assert.equal(f.queries, 0);
});
test("超大认证正文被拒绝", async () => {
  const f = fake(),
    r = await createWorker(f.factory).fetch(
      request("/api/auth/login", { password: "a".repeat(5000) }, false),
      env,
    );
  assert.equal(r.status, 413);
});
test("本机 Cookie 仅用于 HTTP 预览，生产使用 Host 前缀", () => {
  assert.deepEqual(cookieNames(false), ["lifeos-access", "lifeos-refresh"]);
  const ctx = { secure: true, cookies: [] } as unknown as AuthContext;
  saveSession(ctx, null);
  assert.ok(ctx.cookies.every((c) => c.includes("Secure")));
});

test('原版契约入口在查询前拒绝匿名、AAL1、异主和跨站',async()=>{
 for(const options of [{},{aal:'aal1'},{aal:'aal2',owner:'other'}]){
  const f=fake(options);const r=await createWorker(f.factory).fetch(request('/api/native',{method:'GET',path:'/v1/time/segments'}),env);assert.ok([401,403].includes(r.status));assert.equal(f.queries,0);
 }
 const f=fake({aal:'aal2'});const foreign=request('/api/native',{method:'GET',path:'/v1/health'});foreign.headers.set('Origin','https://foreign.example');const denied=await createWorker(f.factory).fetch(foreign,env);assert.equal(denied.status,403);assert.equal(f.queries,0);
});
test('旧入口跳转到原版路由；原版公共壳不读取账目',async()=>{
 const f=fake();const r=await createWorker(f.factory).fetch(request('/today',undefined,false),env);assert.equal(r.status,302);assert.ok(r.headers.get('Location')?.endsWith('/dashboard/time/day'));assert.equal(f.queries,0);
});


test('订阅动作和图片均在代理前拒绝匿名、AAL1、异主与跨站',async()=>{
 let forwarded=0;
 const privateEnv={...env,SUBSCRIPTIONS:{fetch:async()=>{forwarded++;return Response.json({ok:true});}}};
 for(const options of [{aal:'aal1'},{aal:'aal2',owner:'other'}]){
  const f=fake(options);
  for(const r of [request('/api/subscriptions/request',{method:'GET',path:'/v1/subscriptions'}),request('/api/subscriptions/icons/123.jpg')]){
   const result=await createWorker(f.factory).fetch(r,privateEnv);assert.ok([401,403].includes(result.status));
  }
 }
 const f=fake({aal:'aal2',verified:true});
 const anonymous=await createWorker(f.factory).fetch(request('/api/subscriptions/request',{method:'GET',path:'/v1/subscriptions'},false),privateEnv);
 assert.equal(anonymous.status,401);
 const foreign=await createWorker(f.factory).fetch(request('/api/subscriptions/request',{method:'GET',path:'/v1/subscriptions'},true,'https://foreign.example'),privateEnv);
 assert.equal(foreign.status,403);assert.equal(forwarded,0);
 const accepted=await createWorker(f.factory).fetch(request('/api/subscriptions/request',{method:'GET',path:'/v1/subscriptions'}),privateEnv);
 assert.equal(accepted.status,200);assert.equal(forwarded,1);
});
