/**
 * [INPUT]: 依赖 WhoopService、SQLite 临时目录和模拟 WHOOP 响应。
 * [OUTPUT]: 验证分页、刷新令牌轮换与同步提交原子性。
 * [POS]: tests 的外部接口回归；不访问真实账号或网络。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { WhoopService } from "../server/whoop.mjs";
import { AppError, requestJson } from "../server/http.mjs";

function setup(t, request) {
  const dir = mkdtempSync(path.join(tmpdir(), "lifeos-whoop-test-"));
  const store = new Store(dir);
  const service = new WhoopService(
    store,
    {
      origin: "http://localhost:3210",
      clientId: "client",
      clientSecret: "secret",
    },
    request,
  );
  store.set("tokens", {
    access_token: "access",
    refresh_token: "refresh",
    expires_at: Date.now() + 3600000,
  });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, service, dir };
}
const okResponse = (url) =>
  url.includes("/profile/basic")
    ? { user_id: 1 }
    : url.includes("/measurement/body")
      ? { weight_kilogram: 72 }
      : { records: [] };

test("分页携带 nextToken，完整读取集合", async (t) => {
  const urls = [];
  const { service } = setup(t, async (url) => {
    urls.push(url);
    return urls.length === 1
      ? { records: [{ id: 1 }], next_token: "a+b/c=" }
      : { records: [{ id: 2 }] };
  });
  const result = await service.collection("/cycle", "2026-10-01T00:00:00Z");
  assert.equal(result.length, 2);
  assert.equal(new URL(urls[1]).searchParams.get("nextToken"), "a+b/c=");
  assert.equal(new URL(urls[0]).searchParams.get("limit"), "25");
});
test("拒绝重复分页游标，避免无限循环", async (t) => {
  const { service } = setup(t, async () => ({
    records: [],
    next_token: "again",
  }));
  await assert.rejects(
    service.collection("/cycle", "2026-10-01T00:00:00Z"),
    /游标重复/,
  );
});
test("并发请求只刷新一次，并持久化轮换后的 refresh_token", async (t) => {
  let calls = 0;
  const { service, store } = setup(t, async () => {
    calls++;
    await new Promise((resolve) => setImmediate(resolve));
    return {
      access_token: "next-access",
      refresh_token: "next-refresh",
      expires_in: 3600,
    };
  });
  store.set("tokens", {
    access_token: "expired",
    refresh_token: "old-refresh",
    expires_at: 1,
  });
  assert.deepEqual(
    await Promise.all([
      service.accessToken(),
      service.accessToken(),
      service.accessToken(),
    ]),
    ["next-access", "next-access", "next-access"],
  );
  assert.equal(calls, 1);
  assert.equal(store.get("tokens").refresh_token, "next-refresh");
});
test("新授权缺少刷新令牌时，不复用旧账户的 refresh_token", async (t) => {
  const { service, store } = setup(t, async () => ({
    access_token: "new-account",
    expires_in: 3600,
  }));
  await assert.rejects(service.exchange("code"), /未返回刷新令牌/);
  assert.equal(store.get("tokens").access_token, "access");
});
test("401 只重试一次，保留 DELETE 方法", async (t) => {
  const seen = [];
  let attempted = false;
  const { service } = setup(t, async (url, options) => {
    seen.push([url, options]);
    if (url.endsWith("/token"))
      return {
        access_token: "new",
        refresh_token: "rotated",
        expires_in: 3600,
      };
    if (!attempted) {
      attempted = true;
      throw new AppError(401, "expired");
    }
    return null;
  });
  await service.api("/user/access", { method: "DELETE" });
  const requests = seen.filter(([url]) => url.endsWith("/user/access"));
  assert.equal(requests.length, 2);
  assert.ok(requests.every(([, options]) => options.method === "DELETE"));
});
test("同步中途失败时，原始数据和上次成功时间保持不变", async (t) => {
  const { service, store } = setup(t, async (url) => {
    if (url.includes("/activity/sleep")) throw new AppError(429, "请求受限");
    if (url.includes("/cycle?")) return { records: [{ id: 2, user_id: 1 }] };
    return okResponse(url);
  });
  store.commitSync({
    profile: { user_id: 1 },
    body: {},
    collections: { cycles: [{ id: 1, user_id: 1 }] },
    startedAt: "old",
    finishedAt: "old",
    lookbackDays: 90,
  });
  await assert.rejects(service.sync(), /请求受限/);
  assert.deepEqual(
    store.records("cycles").map((r) => r.id),
    [1],
  );
  assert.equal(store.get("sync").finishedAt, "old");
  assert.equal(store.get("sync").error, "请求受限");
});
test("同步合并并发请求，相同 ID 幂等更新", async (t) => {
  let profileCalls = 0;
  const { service, store } = setup(t, async (url) => {
    if (url.includes("/profile/basic")) {
      profileCalls++;
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (url.includes("/cycle?"))
      return { records: [{ id: 1, user_id: 1, marker: profileCalls }] };
    return okResponse(url);
  });
  await Promise.all([service.sync(), service.sync()]);
  assert.equal(profileCalls, 1);
  await service.sync();
  assert.equal(store.records("cycles").length, 1);
  assert.equal(store.records("cycles")[0].marker, 2);
});
test("账户切换被拒绝，旧记录和旧自述保持完整", async (t) => {
  const { store } = setup(t, okResponse);
  store.commitSync({
    profile: { user_id: 1 },
    body: {},
    collections: { cycles: [{ id: 1 }] },
    startedAt: "a",
    finishedAt: "a",
    lookbackDays: 90,
  });
  store.saveCheckin({ date: "2026-10-21", notes: "旧账户" });
  assert.throws(
    () =>
      store.commitSync({
        profile: { user_id: 2 },
        body: {},
        collections: { cycles: [{ id: 9 }] },
        startedAt: "b",
        finishedAt: "b",
        lookbackDays: 90,
      }),
    /另一 WHOOP 账户/,
  );
  assert.deepEqual(
    store.records("cycles").map((r) => r.id),
    [1],
  );
  assert.equal(store.checkins().length, 1);
});
test("拒绝归属错误的上游记录", async (t) => {
  const { service, store } = setup(t, async (url) =>
    url.includes("/cycle?")
      ? { records: [{ id: 1, user_id: 999 }] }
      : okResponse(url),
  );
  await assert.rejects(service.sync(), /归属或标识/);
  assert.equal(store.records("cycles").length, 0);
});
test("撤销使用 WHOOP DELETE，成功后移除本机令牌", async (t) => {
  let method;
  const { service, store, dir } = setup(t, async (url, options) => {
    method = options.method;
    return null;
  });
  await service.disconnect();
  assert.equal(method, "DELETE");
  assert.equal(store.get("tokens"), null);
  assert.equal(statSync(path.join(dir, "lifeos.sqlite")).mode & 0o777, 0o600);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
});
test("上游错误正文和网络错误不向用户泄露密钥", async () => {
  await assert.rejects(
    requestJson(
      "https://example.test",
      {},
      async () => new Response("secret=do-not-leak", { status: 400 }),
    ),
    (e) => !e.message.includes("do-not-leak") && e.status === 400,
  );
  await assert.rejects(
    requestJson("https://example.test", {}, async () => {
      throw new Error("secret=do-not-leak");
    }),
    (e) => !e.message.includes("do-not-leak") && e.status === 502,
  );
});
test("缺少可选身体测量时仍同步健康记录", async (t) => {
  const { service, store } = setup(t, async (url) => {
    if (url.endsWith("/measurement/body"))
      throw new AppError(404, "未填写身体测量");
    if (url.includes("/cycle?")) return { records: [{ id: 3, user_id: 1 }] };
    return okResponse(url);
  });
  await service.sync();
  assert.equal(store.get("body"), null);
  assert.equal(store.records("cycles").length, 1);
});
