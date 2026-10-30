/**
 * [INPUT]: 依赖本机 HTTP 组合入口和隔离的 SQLite 测试目录。
 * [OUTPUT]: 验证来源、OAuth、演示隔离、记录和每日报告 API。
 * [POS]: tests 的集成回归；测试服务使用随机端口，不写真实数据库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/index.mjs";

async function setup(t) {
  const dataDir = mkdtempSync(path.join(tmpdir(), "lifeos-http-test-"));
  const config = {
    dataDir,
    port: 3210,
    origin: "http://localhost:3210",
    clientId: "",
    clientSecret: "",
    secure: false,
  };
  const app = createApp({ config });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  config.port = app.server.address().port;
  config.origin = `http://localhost:${config.port}`;
  const request = (route, options = {}) =>
    fetch(`${config.origin}${route}`, options);
  const status = await (await request("/api/status")).json();
  const post = (route, body, headers = {}) =>
    request(route, {
      method: "POST",
      headers: {
        Origin: config.origin,
        "Content-Type": "application/json",
        "X-LifeOS-CSRF": status.csrf,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
    app.store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { ...app, request, post };
}
test("允许从外部链接打开控制台，拒绝跨站读取 API", async (t) => {
  const { request, config } = await setup(t);
  assert.equal(
    (await request("/", { headers: { "Sec-Fetch-Site": "cross-site" } }))
      .status,
    200,
  );
  assert.equal(
    (
      await request("/api/dashboard", {
        headers: { "Sec-Fetch-Site": "cross-site" },
      })
    ).status,
    403,
  );
  const badHost = await new Promise((resolve, reject) => {
    http
      .get(
        {
          host: "127.0.0.1",
          port: config.port,
          path: "/api/status",
          headers: { Host: "evil.test" },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      )
      .on("error", reject);
  });
  assert.equal(badHost, 403);
});
test("写入要求同源与 CSRF，不暴露本机文件", async (t) => {
  const { post, request } = await setup(t);
  assert.equal(
    (await post("/api/settings", {}, { Origin: "https://evil.test" })).status,
    403,
  );
  assert.equal(
    (await post("/api/settings", {}, { "X-LifeOS-CSRF": "" })).status,
    403,
  );
  assert.equal((await request("/.env")).status, 404);
  assert.equal((await request("/server/store.mjs")).status, 404);
});
test("凭据响应只包含配置状态，不包含密钥", async (t) => {
  const { post, request } = await setup(t);
  assert.equal(
    (
      await post("/api/settings", {
        clientId: "test-id",
        clientSecret: "very-private-secret",
      })
    ).status,
    200,
  );
  const response = await (await request("/api/status")).text();
  assert.doesNotMatch(response, /very-private-secret/);
  assert.equal(JSON.parse(response).settings.clientSecretConfigured, true);
});
test("演示读取不写入真实数据库，导出明确标示演示", async (t) => {
  const { request, store } = await setup(t);
  const demo = await (await request("/api/dashboard?mode=demo")).json();
  assert.equal(demo.latest.recovery, 78);
  assert.equal(store.records("cycles").length, 0);
  const live = await (await request("/api/dashboard")).json();
  assert.equal(live.latest.recovery, null);
  assert.equal(
    (await (await request("/api/export?mode=demo")).json()).mode,
    "demo",
  );
});
test("每日记录拒绝无效日期和越界数值，按日期更新", async (t) => {
  const { post, store } = await setup(t);
  assert.equal(
    (await post("/api/checkins", { date: "2026-02-30" })).status,
    400,
  );
  assert.equal(
    (await post("/api/checkins", { date: "2020-01-01", soreness: 11 })).status,
    400,
  );
  assert.equal(
    (
      await post("/api/checkins", {
        date: "2020-01-01",
        energy: 2,
        notes: "一次",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await post("/api/checkins", {
        date: "2020-01-01",
        energy: 4,
        notes: "更新",
      })
    ).status,
    200,
  );
  assert.equal(store.checkins().length, 1);
  assert.equal(store.checkins()[0].energy, 4);
});
test("OAuth state 绑定 HttpOnly cookie，错误校验不交换授权码", async (t) => {
  const { post, request } = await setup(t);
  await post("/api/settings", { clientId: "id", clientSecret: "secret" });
  const response = await post("/api/whoop/authorize", {});
  const cookie = response.headers.get("set-cookie");
  const auth = new URL((await response.json()).url);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.ok(auth.searchParams.get("scope").includes("offline"));
  const result = await request(`/api/whoop/callback?code=unused&state=wrong`, {
    headers: { Cookie: cookie.split(";")[0] },
    redirect: "manual",
  });
  assert.equal(result.status, 400);
});
test("OAuth 拒绝授权正常返回，state 只能使用一次", async (t) => {
  const { post, request } = await setup(t);
  await post("/api/settings", { clientId: "id", clientSecret: "secret" });
  const response = await post("/api/whoop/authorize", {});
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const auth = new URL((await response.json()).url);
  const callback = `/api/whoop/callback?error=access_denied&state=${auth.searchParams.get("state")}`;
  const result = await request(callback, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  assert.equal(result.status, 303);
  assert.equal(result.headers.get("location"), "/?oauth=denied");
  assert.equal(
    (
      await request(callback, {
        headers: { Cookie: cookie },
        redirect: "manual",
      })
    ).status,
    400,
  );
});
test("OAuth 成功后保存令牌并完成首次同步，不在回调泄露令牌", async (t) => {
  const { post, request, whoop, store } = await setup(t);
  whoop.request = async (url) => {
    if (url.endsWith("/token"))
      return {
        access_token: "private-access",
        refresh_token: "private-refresh",
        expires_in: 3600,
      };
    if (url.endsWith("/profile/basic")) return { user_id: 12 };
    if (url.endsWith("/measurement/body")) return { weight_kilogram: 70 };
    return { records: [] };
  };
  await post("/api/settings", { clientId: "id", clientSecret: "secret" });
  const response = await post("/api/whoop/authorize", {});
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const auth = new URL((await response.json()).url);
  const result = await request(
    `/api/whoop/callback?code=fake-code&state=${auth.searchParams.get("state")}`,
    { headers: { Cookie: cookie }, redirect: "manual" },
  );
  assert.equal(result.status, 303);
  assert.equal(result.headers.get("location"), "/?oauth=connected");
  if (whoop.syncing) await whoop.syncing;
  assert.equal(store.get("tokens").refresh_token, "private-refresh");
  assert.equal(store.get("profile").user_id, 12);
  assert.doesNotMatch(
    await (await request("/api/status")).text(),
    /private-access|private-refresh/,
  );
});

test("报告设置生效，演示不写库，真实报告可保存、回看和导出", async (t) => {
  const { request, post, store, snapshot, whoop } = await setup(t);
  const settings = await post("/api/settings", { reportTime: "07:00", timeZone: "Asia/Shanghai", wakeTime: "06:30", foodRestrictions: "", constraints: "" });
  assert.equal(settings.status, 200);
  const status = await settings.json();
  assert.equal(status.reports.timeZone, "Asia/Shanghai");
  assert.equal(status.reports.preparationTime, "06:00");
  assert.equal((await post("/api/settings", { reportTime: "99:99" })).status, 400);
  assert.equal((await post("/api/plans/generate", {})).status, 400);
  const demo = await (await request("/api/plans?mode=demo")).json();
  assert.equal(demo.plans.length, 1);
  assert.equal(store.plans(status.reports.timeZone).length, 0);
  assert.equal((await post("/api/plans/generate?mode=demo", {})).status, 400);
  const { makeDemo } = await import("../server/demo.mjs");
  const dataset = makeDemo().dataset;
  const shift = Date.now() - 100 - Date.parse(dataset.sleeps.at(-1).end);
  for (const records of Object.values(dataset)) for (const record of records) {
    record.timezone_offset = "+08:00";
    for (const field of ["start", "end", "created_at", "updated_at"])
      if (record[field]) record[field] = new Date(Date.parse(record[field]) + shift).toISOString();
  }
  store.commitSync({ profile: { user_id: 1 }, body: null, collections: dataset,
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), lookbackDays: 90 });
  store.set("tokens", { fake: true });
  let syncs = 0;
  whoop.sync = async () => {
    syncs++;
    const sync = { startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() };
    store.set("sync", sync); return sync;
  };
  const generated = await post("/api/plans/generate", {});
  assert.equal(generated.status, 200);
  const { plan } = await generated.json();
  assert.equal(plan.revision, 1);
  assert.equal(plan.period, "today");
  assert.equal(plan.publication.state, "published");
  assert.equal(syncs, 1);
  assert.equal(plan.targetDate, new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()));
  assert.equal((await (await request("/api/plans")).json()).plans[0].targetDate, plan.targetDate);
  const markdown = await request(`/api/plans/export?date=${plan.targetDate}`);
  assert.match(markdown.headers.get("content-type"), /markdown/);
  assert.match(await markdown.text(), /三餐示例/);
  const exported = await (await request("/api/export")).json();
  assert.equal(exported.plans.length, 1);
  assert.equal(snapshot(false, 7).insights.comparisons[0].previousCount, 7);
  for (const route of ["/insights.js", "/plans.js", "/insights.css", "/plans.css"])
    assert.equal((await request(route)).status, 200);
});
