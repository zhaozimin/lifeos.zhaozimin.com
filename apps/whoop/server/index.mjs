/**
 * [INPUT]: 依赖原生 HTTP/HTTPS、Store、WhoopService 与纯分析层。
 * [OUTPUT]: 导出 createApp；提供控制台、每日建议和后台调度。
 * [POS]: server 组合入口；在请求边界校验来源，阻止凭据进入响应。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import http from "node:http";
import https from "node:https";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { ROOT, SCOPES, loadConfig, validateSettings } from "./config.mjs";
import { AppError, readJson } from "./http.mjs";
import { Store } from "./store.mjs";
import { WhoopService } from "./whoop.mjs";
import { buildSnapshot, dateAt } from "./analytics.mjs";
import { buildGuidance, exportSummary } from "./guidance.mjs";
import { makeDemo } from "./demo.mjs";
import { buildInsights } from "./insights.mjs";
import { ReportService } from "./reports.mjs";
import { buildPlan, planMarkdown } from "./planner.mjs";
import { localClock } from "./calendar.mjs";

const PERIOD = 30 * 60 * 1000;
const STATIC = {
  "/": ["index.html", "text/html"],
  "/privacy": ["privacy.html", "text/html"],
  "/app.js": ["app.js", "text/javascript"],
  "/charts.js": ["charts.js", "text/javascript"],
  "/html.js": ["html.js", "text/javascript"],
  "/chart-help.js": ["chart-help.js", "text/javascript"],
  "/chart-interactions.js": ["chart-interactions.js", "text/javascript"],
  "/chart-help.css": ["chart-help.css", "text/css"],
  "/insights.js": ["insights.js", "text/javascript"],
  "/plans.js": ["plans.js", "text/javascript"],
  "/insights.css": ["insights.css", "text/css"],
  "/plans.css": ["plans.css", "text/css"],
  "/styles.css": ["styles.css", "text/css"],
  "/base.css": ["base.css", "text/css"],
  "/dashboard.css": ["dashboard.css", "text/css"],
  "/forms.css": ["forms.css", "text/css"],
  "/responsive.css": ["responsive.css", "text/css"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"],
};
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const random = () => randomBytes(24).toString("hex");

function validateCheckin(data, today) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(data.date || "") ||
    dateAt(`${data.date}T12:00:00Z`) !== data.date ||
    data.date > today ||
    data.date < "2000-01-01"
  )
    throw new AppError(400, "记录日期必须有效，且不能晚于今天。");
  const checkin = { date: data.date, updatedAt: new Date().toISOString() };
  for (const [field, min, max] of [
    ["energy", 1, 5],
    ["soreness", 0, 10],
    ["weight", 20, 350],
  ]) {
    const n = data[field];
    if (
      n !== null &&
      n !== undefined &&
      (!Number.isFinite(n) ||
        n < min ||
        n > max ||
        (field !== "weight" && !Number.isInteger(n)))
    )
      throw new AppError(400, `${field} 超出可填写范围。`);
    checkin[field] = n ?? null;
  }
  for (const field of ["nutrition", "notes"]) {
    if (
      data[field] !== undefined &&
      (typeof data[field] !== "string" || data[field].length > 1000)
    )
      throw new AppError(400, "文字记录请控制在 1000 字以内。");
    checkin[field] = (data[field] || "").trim();
  }
  const allowed = ["发热", "胸痛", "静息时呼吸困难", "晕厥"];
  if (
    data.symptoms !== undefined &&
    (!Array.isArray(data.symptoms) ||
      data.symptoms.some((s) => !allowed.includes(s)))
  )
    throw new AppError(400, "身体感受选项无效。");
  checkin.symptoms = [...new Set(data.symptoms || [])];
  return checkin;
}

export function createApp({
  config = loadConfig(),
  store = new Store(config.dataDir),
  whoop = new WhoopService(store, config),
} = {}) {
  const csrf = random();
  const states = new Map();
  const json = (res, data, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  };
  const redirect = (res, to) => {
    res.writeHead(303, { Location: to });
    res.end();
  };
  const settings = () => store.get("settings", {});
  const snapshot = (demo = false, range = 30, { now = new Date(), calendarDate = null } = {}) => {
    const source = demo
      ? makeDemo()
      : { dataset: store.dataset(), body: store.get("body") };
    const full = buildSnapshot(source.dataset, {
      range: 90,
      now, calendarDate,
      settings: settings(),
      body: source.body,
      checkins: demo ? [] : store.checkins(),
    });
    const result = { ...full, days: full.days.slice(-range) };
    return {
      ...result,
      mode: demo ? "demo" : "live",
      guidance: buildGuidance(result),
      insights: buildInsights(full, range),
    };
  };
  const reports = new ReportService(store, whoop, snapshot);
  const status = () => {
    const cfg = settings();
    const credentials = whoop.credentials();
    return {
      csrf,
      connected: Boolean(store.get("tokens")),
      syncing: Boolean(whoop.syncing),
      sync: store.get("sync"),
      authorizationError: store.get("authorizationError"),
      storage: { directory: config.dataDir },
      hasData: store.records("cycles").length > 0,
      settings: {
        goal: cfg.goal || "提升体能与恢复",
        experience: cfg.experience || "初学 / 重新开始",
        constraints: cfg.constraints || "",
        ...reports.preferences(),
        clientIdConfigured: Boolean(credentials.clientId),
        clientSecretConfigured: Boolean(credentials.clientSecret),
      },
      callbackUrl: `${config.origin}/api/whoop/callback`,
      scopes: SCOPES,
      ai: { enabled: false, engine: "本机规则 · v1" },
      intervalMinutes: 30,
      reports: reports.status(),
    };
  };
  const handler = async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      const host = req.headers.host;
      if (
        ![new URL(config.origin).host, `127.0.0.1:${config.port}`].includes(
          host,
        )
      )
        throw new AppError(403, "只允许通过本机地址访问。");
      const url = new URL(req.url, config.origin);
      if (
        req.headers["sec-fetch-site"] === "cross-site" &&
        url.pathname.startsWith("/api/") &&
        url.pathname !== "/api/whoop/callback"
      )
        throw new AppError(403, "拒绝跨站访问本机数据。");
      if (req.method !== "GET" && req.method !== "HEAD") {
        const allowedOrigins = [
          config.origin,
          `${config.secure ? "https" : "http"}://127.0.0.1:${config.port}`,
        ];
        if (
          !allowedOrigins.includes(req.headers.origin) ||
          !equal(req.headers["x-lifeos-csrf"], csrf)
        )
          throw new AppError(403, "请求来源无效，请刷新控制台后重试。");
      }
      if (req.method === "GET" && url.pathname === "/api/status")
        return json(res, status());
      if (req.method === "GET" && url.pathname === "/api/dashboard") {
        const range = Number(url.searchParams.get("range") || 30);
        if (![7, 30, 90].includes(range))
          throw new AppError(400, "请选择 7、30 或 90 天。");
        return json(
          res,
          snapshot(url.searchParams.get("mode") === "demo", range),
        );
      }
      if (req.method === "GET" && url.pathname === "/api/plans") {
        const preferences = reports.preferences();
        if (url.searchParams.get("mode") === "demo") {
          const now = new Date();
          const targetDate = localClock(now, preferences.timeZone).date;
          return json(res, { mode: "demo", plans: [{ ...buildPlan(snapshot(true, 90, { now, calendarDate: targetDate }), {
            now, targetDate, settings: settings(),
            refresh: { succeeded: true, startedAt: now.toISOString(), finishedAt: now.toISOString() },
          }), revision: 1 }] });
        }
        return json(res, { mode: "live", plans: store.plans(preferences.timeZone) });
      }
      if (req.method === "POST" && url.pathname === "/api/plans/generate") {
        await readJson(req);
        if (url.searchParams.get("mode") === "demo") throw new AppError(400, "演示报告不会保存，请切换到我的数据。");
        if (reports.running) throw new AppError(409, "报告正在生成，请稍后查看。");
        if (!store.records("cycles").length && !store.get("tokens")) throw new AppError(400, "请先连接 WHOOP 并同步健康数据。");
        return json(res, { plan: await reports.generate() });
      }
      if (req.method === "GET" && url.pathname === "/api/plans/export") {
        const date = url.searchParams.get("date");
        const zone = url.searchParams.get("timeZone") || reports.preferences().timeZone;
        const plan = store.plan(date, zone);
        if (!plan) throw new AppError(404, "没有此日期的已保存报告。");
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="lifeos-plan-${plan.targetDate}.md"` });
        return res.end(planMarkdown(plan));
      }
      if (req.method === "GET" && url.pathname === "/api/export") {
        const demo = url.searchParams.get("mode") === "demo";
        const data = snapshot(demo, 90);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="lifeos-${demo ? "demo" : "health"}.json"`,
        );
        return json(res, {
          mode: data.mode,
          exportedAt: new Date().toISOString(),
          dailyRangeDays: 90,
          records: demo ? makeDemo().dataset : store.dataset(),
          daily: data.days,
          workouts: data.workouts,
          checkins: data.checkins,
          body: data.body,
          plans: demo ? [] : store.plans(reports.preferences().timeZone),
        });
      }
      if (req.method === "GET" && url.pathname === "/api/summary") {
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="lifeos-ai-summary.json"',
        );
        return json(
          res,
          exportSummary(snapshot(url.searchParams.get("mode") === "demo", 30)),
        );
      }
      if (req.method === "GET" && url.pathname === "/api/records") {
        const kind = url.searchParams.get("kind");
        if (!["cycles", "recoveries", "sleeps", "workouts"].includes(kind))
          throw new AppError(400, "记录类型无效。");
        return json(res, { kind, records: store.records(kind) });
      }
      if (req.method === "POST" && url.pathname === "/api/settings") {
        const input = validateSettings(await readJson(req));
        for (const key of ["clientId", "clientSecret"])
          if (input[key] === "") delete input[key];
        const creds = whoop.credentials();
        if (
          Object.keys(input).some(
            (k) =>
              ["clientId", "clientSecret"].includes(k) && input[k] !== creds[k],
          ) &&
          (store.get("tokens") || whoop.busy || whoop.syncing)
        )
          throw new AppError(409, "更换授权凭据前，请先断开 WHOOP 连接。");
        store.set("settings", { ...settings(), ...input });
        return json(res, status());
      }
      if (req.method === "POST" && url.pathname === "/api/whoop/authorize") {
        if (whoop.busy || whoop.syncing)
          throw new AppError(409, "正在同步，请稍后连接。");
        if (host !== new URL(config.origin).host)
          throw new AppError(400, `请通过 ${config.origin} 打开控制台后授权。`);
        const state = random();
        const session = random();
        const target = whoop.authorizationUrl(state);
        store.remove("authorizationError");
        for (const [key, item] of states)
          if (item.expires < Date.now()) states.delete(key);
        states.set(session, { state, expires: Date.now() + 10 * 60 * 1000 });
        res.setHeader(
          "Set-Cookie",
          `lifeos_oauth=${session}; HttpOnly; SameSite=Lax; Path=/api/whoop/callback; Max-Age=600${config.secure ? "; Secure" : ""}`,
        );
        return json(res, { url: target });
      }
      if (req.method === "GET" && url.pathname === "/api/whoop/callback") {
        const session = (req.headers.cookie || "")
          .split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith("lifeos_oauth="))
          ?.slice("lifeos_oauth=".length);
        const pending = states.get(session);
        states.delete(session);
        res.setHeader(
          "Set-Cookie",
          `lifeos_oauth=; HttpOnly; SameSite=Lax; Path=/api/whoop/callback; Max-Age=0${config.secure ? "; Secure" : ""}`,
        );
        if (
          !pending ||
          pending.expires < Date.now() ||
          !equal(pending.state, url.searchParams.get("state"))
        )
          throw new AppError(
            400,
            "授权校验失败或已过期，请回到控制台重新连接。",
          );
        if (url.searchParams.has("error"))
          return redirect(res, "/?oauth=denied");
        const code = url.searchParams.get("code");
        if (!code || code.length > 4096)
          throw new AppError(400, "WHOOP 未返回有效授权码。");
        try {
          await whoop.exchange(code);
          whoop.sync(90).catch(() => {});
          return redirect(res, "/?oauth=connected");
        } catch (error) {
          store.set(
            "authorizationError",
            error instanceof AppError
              ? error.message
              : "WHOOP 授权失败，请稍后重试。",
          );
          return redirect(res, "/?oauth=failed");
        }
      }
      if (req.method === "POST" && url.pathname === "/api/whoop/sync") {
        const input = await readJson(req);
        const days = input.days ?? 90;
        if (![14, 30, 90, 180, 365].includes(days))
          throw new AppError(400, "同步范围无效。");
        if (!store.get("tokens")) throw new AppError(401, "请先连接 WHOOP。");
        whoop.sync(days).catch(() => {});
        return json(res, { syncing: true }, 202);
      }
      if (req.method === "POST" && url.pathname === "/api/whoop/disconnect") {
        await whoop.disconnect();
        return json(res, status());
      }
      if (req.method === "POST" && url.pathname === "/api/checkins") {
        const data = validateCheckin(await readJson(req), snapshot().today);
        store.saveCheckin(data);
        return json(res, { saved: true, checkin: data });
      }
      if (
        (req.method === "GET" || req.method === "HEAD") &&
        STATIC[url.pathname]
      ) {
        const [filename, mime] = STATIC[url.pathname];
        const content = readFileSync(path.join(ROOT, "public", filename));
        res.writeHead(200, { "Content-Type": `${mime}; charset=utf-8` });
        return res.end(req.method === "HEAD" ? undefined : content);
      }
      throw new AppError(404, "页面或接口不存在。");
    } catch (error) {
      if (res.headersSent) return res.end();
      json(
        res,
        {
          error:
            error instanceof AppError
              ? error.message
              : "本机服务遇到错误，请重试。",
        },
        error instanceof AppError && error.status >= 400 && error.status < 600
          ? error.status
          : 500,
      );
    }
  };
  const server = config.secure
    ? https.createServer(
        {
          cert: readFileSync(config.certFile),
          key: readFileSync(config.keyFile),
        },
        handler,
      )
    : http.createServer(handler);
  server.requestTimeout = 30000;
  return { server, store, whoop, config, snapshot, status, reports };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.umask(0o077);
  const app = createApp();
  const autoSync = () => {
    if (!app.store.get("tokens") || app.whoop.syncing || app.whoop.busy) return;
    app.whoop.sync(app.store.get("profile") ? 14 : 90).catch(() => {});
  };
  const timer = setInterval(autoSync, PERIOD);
  timer.unref();
  const reportTimer = setInterval(() => app.reports.tick().catch(() => {}), 60000);
  reportTimer.unref();
  app.server.on("error", (error) => {
    process.stderr.write(
      error.code === "EADDRINUSE"
        ? `端口 ${app.config.port} 已被占用。请在 .env 中修改 PORT。\n`
        : "本机服务无法启动，请检查配置。\n",
    );
    process.exitCode = 1;
  });
  app.server.listen(app.config.port, "127.0.0.1", () => {
    process.stdout.write(
      `LifeOS 已启动：${app.config.origin}\n数据保存在本机；退出进程将停止自动同步。\n`,
    );
    autoSync();
    app.reports.tick().catch(() => {});
  });
  const close = () => {
    clearInterval(timer);
    clearInterval(reportTimer);
    app.server.close(() => {
      app.store.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
