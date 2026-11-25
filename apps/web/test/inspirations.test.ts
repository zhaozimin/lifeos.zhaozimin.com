/**
 * [INPUT]: Worker 灵感读写接口、公开抓取订阅源（HTML/MD/JSON）、两层标签校验与受控 RPC 客户端替身。
 * [OUTPUT]: 灵感接口 AAL2 门禁、公开抓取开关与 CORS/索引头、语义 HTML5/Markdown 渲染、两层标签校验与 409 冲突证据。
 * [POS]: 灵感记录前端 Worker 回归测试；不连接生产数据库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createWorker } from "../worker/index";
import type { ClientFactory, Env } from "../worker/auth";
import {
  createInspiration,
  editInspiration,
  deleteInspiration,
  manageInspirationTag,
} from "../worker/inspirations";

const env: Env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  OWNER_AUTH_ID: "owner",
  OWNER_EMAIL: "private@example.com",
  ASSETS: { fetch: async () => new Response("assets", { headers: { "Content-Type": "text/html" } }) },
};

const uuidA = "11111111-1111-4111-8111-111111111111";
const uuidB = "22222222-2222-4222-8222-222222222222";

const samplePublicFeed = {
  items: [
    {
      id: uuidA,
      title: "公开灵感集与工作流",
      summary: "每天让 Agent 抓取当日灵感并总结。",
      content: "完整保留的原话正文，包含 <b>字符</b> 与换行。",
      pinned: true,
      captured_at: "2026-11-25T05:34:00Z",
      date_shanghai: "2026-11-25",
      tags: [{ id: uuidB, group_id: uuidA, group: "产品", name: "公开灵感集" }],
    },
  ],
  total: 1,
  limit: 100,
  offset: 0,
  timezone: "Asia/Shanghai",
  date: "2026-11-25",
  from: null,
  to: null,
  tags_tree: [
    {
      id: uuidA,
      name: "产品",
      description: null,
      count: 1,
      children: [{ id: uuidB, parent_id: uuidA, name: "公开灵感集", description: null, count: 1 }],
    },
  ],
  available_dates: ["2026-11-25"],
};

test("灵感私有接口拒绝匿名访问，公开开关关闭时所有公开抓取路由均返回 403", async () => {
  const client = {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
    rpc: async (name: string) => {
      if (name === "visitor_inspirations") {
        return { data: null, error: { code: "42501", message: "visitor inspirations disabled" } };
      }
      return { data: true, error: null };
    },
  };
  const worker = createWorker((() => client) as unknown as ClientFactory);
  assert.equal((await worker.fetch(new Request("https://lifeos.example/api/inspirations"), env)).status, 401);

  const postReq = new Request("https://lifeos.example/api/inspirations/create", {
    method: "POST",
    headers: {
      Origin: "https://lifeos.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: "测试" }),
  });
  assert.equal((await worker.fetch(postReq, env)).status, 401);

  for (const path of [
    "/api/visitor/inspirations",
    "/inspirations/feed?date=today",
    "/inspirations.md?date=today",
    "/inspirations.json?date=today",
  ]) {
    assert.equal(
      (await worker.fetch(new Request(`https://lifeos.example${path}`), env)).status,
      403,
      `预期 ${path} 在关闭公开时返回 403`,
    );
  }
});

test("灵感公开开关开启时，提供零 JS 语义 HTML、Markdown、JSON 及 CORS/索引头", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "visitor_inspirations") {
        return { data: samplePublicFeed, error: null };
      }
      return { data: true, error: null };
    },
  };
  const worker = createWorker((() => client) as unknown as ClientFactory);

  // 1. 零 JS 语义 HTML5 抓取页
  const htmlRes = await worker.fetch(
    new Request("https://lifeos.example/inspirations/feed?date=2026-11-25"),
    env,
  );
  assert.equal(htmlRes.status, 200);
  assert.equal(htmlRes.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(htmlRes.headers.get("X-Robots-Tag"), "index, follow");
  assert.match(htmlRes.headers.get("Content-Type") ?? "", /text\/html/);
  const html = await htmlRes.text();
  assert.match(html, /data-inspiration-id="11111111-1111-4111-8111-111111111111"/);
  assert.match(html, /data-date="2026-11-25"/);
  assert.match(html, /itemtype="https:\/\/schema\.org\/CreativeWork"/);
  assert.match(html, /id="lifeos-inspirations-data"/);
  assert.match(html, /&lt;b&gt;字符&lt;\/b&gt;/);

  // 2. Markdown 订阅源（Agent 推荐）
  const mdRes = await worker.fetch(
    new Request("https://lifeos.example/inspirations.md?date=2026-11-25"),
    env,
  );
  assert.equal(mdRes.status, 200);
  assert.equal(mdRes.headers.get("Access-Control-Allow-Origin"), "*");
  assert.match(mdRes.headers.get("Content-Type") ?? "", /text\/markdown/);
  const md = await mdRes.text();
  assert.match(md, /## 公开灵感集与工作流/);
  assert.match(md, /产品\/公开灵感集/);
  assert.match(md, /完整保留的原话正文/);

  // 3. JSON 订阅源与公开 API
  const jsonRes = await worker.fetch(
    new Request("https://lifeos.example/inspirations.json?date=2026-11-25"),
    env,
  );
  assert.equal(jsonRes.status, 200);
  assert.equal(jsonRes.headers.get("Access-Control-Allow-Origin"), "*");
  const jsonBody = (await jsonRes.json()) as { items: Array<{ id: string }> };
  assert.equal(jsonBody.items[0]?.id, uuidA);

  const apiRes = await worker.fetch(
    new Request("https://lifeos.example/api/visitor/inspirations?date=today"),
    env,
  );
  assert.equal(apiRes.status, 200);
  assert.equal(apiRes.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(apiRes.headers.get("X-Robots-Tag"), "index, follow");

  // 4. CORS 预检与页面索引策略隔离
  const optRes = await worker.fetch(
    new Request("https://lifeos.example/inspirations.json", { method: "OPTIONS" }),
    env,
  );
  assert.equal(optRes.status, 204);
  assert.equal(optRes.headers.get("Access-Control-Allow-Origin"), "*");

  const inspPageRes = await worker.fetch(
    new Request("https://lifeos.example/dashboard/inspirations"),
    env,
  );
  assert.equal(inspPageRes.headers.get("X-Robots-Tag"), "index, follow");

  const dayPageRes = await worker.fetch(
    new Request("https://lifeos.example/dashboard/time/day"),
    env,
  );
  assert.equal(dayPageRes.headers.get("X-Robots-Tag"), "noindex, nofollow");

  // 确认 today 参数已解析为 YYYY-MM-DD 传给 RPC
  const todayCall = rpcCalls.find(
    (c) => c.name === "visitor_inspirations" && typeof c.args.p_date === "string" && c.args.p_date !== "2026-11-25",
  );
  if (todayCall) {
    assert.match(String(todayCall.args.p_date), /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("灵感写入只走受限 RPC，严格校验两层标签且版本冲突映射 409", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: { id: uuidA, revision: 2 }, error: null };
    },
  } as unknown as SupabaseClient;

  await createInspiration(client, {
    title: "记忆系统",
    summary: "核心思路总结",
    content: "保留全部原话正文。",
    tags: [{ group: "AI", name: "记忆系统" }],
    pinned: true,
  });
  assert.equal(calls[0]?.name, "create_inspiration");

  // 禁止斜杠构造第三层
  await assert.rejects(
    createInspiration(client, {
      content: "测试",
      tags: [{ group: "AI/第三层", name: "测试" }],
    }),
  );

  // 编辑校验非空补丁与未知字段
  await assert.rejects(
    editInspiration(client, { id: uuidA, revision: 1, patch: {} }),
    { status: 400 },
  );
  await editInspiration(client, {
    id: uuidA,
    revision: 1,
    patch: { pinned: false },
  });
  assert.equal(calls[1]?.name, "edit_inspiration");

  // 标签管理动作白名单
  await manageInspirationTag(client, {
    action: "create_tag",
    payload: { parent_id: uuidA, name: "个人助理" },
  });
  assert.equal(calls[2]?.name, "manage_inspiration_tag");

  await deleteInspiration(client, { id: uuidA, revision: 2 });
  assert.equal(calls[3]?.name, "delete_inspiration");

  // 版本冲突映射 409
  const conflict = {
    rpc: async () => ({
      data: null,
      error: { code: "40001", message: "revision conflict" },
    }),
  } as unknown as SupabaseClient;
  await assert.rejects(
    editInspiration(conflict, {
      id: uuidB,
      revision: 1,
      patch: { title: "新标题" },
    }),
    { status: 409 },
  );
});
