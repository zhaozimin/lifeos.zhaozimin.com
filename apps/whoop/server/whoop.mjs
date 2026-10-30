/**
 * [INPUT]: 依赖 Store、requestJson 与配置中的 WHOOP 客户端凭据。
 * [OUTPUT]: 导出 WhoopService；生成授权 URL，续期令牌并同步 v2 记录。
 * [POS]: WHOOP 唯一适配器；串行分页、合并刷新、完整批次提交。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { SCOPES } from "./config.mjs";
import { AppError, requestJson } from "./http.mjs";

const API = "https://api.prod.whoop.com/developer/v2";
const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const DAY = 86400000;
const PATHS = {
  cycles: "/cycle",
  recoveries: "/recovery",
  sleeps: "/activity/sleep",
  workouts: "/activity/workout",
};

export class WhoopService {
  constructor(store, config, request = requestJson) {
    this.store = store;
    this.config = config;
    this.request = request;
    this.refreshing = null;
    this.syncing = null;
    this.busy = false;
  }
  credentials() {
    const settings = this.store.get("settings", {});
    return {
      clientId: settings.clientId || this.config.clientId,
      clientSecret: settings.clientSecret || this.config.clientSecret,
    };
  }
  authorizationUrl(state) {
    const { clientId, clientSecret } = this.credentials();
    if (!clientId || !clientSecret)
      throw new AppError(
        400,
        "请先在接入设置中保存 WHOOP Client ID 和 Client Secret。",
      );
    const url = new URL("https://api.prod.whoop.com/oauth/oauth2/auth");
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${this.config.origin}/api/whoop/callback`,
      response_type: "code",
      scope: SCOPES.join(" "),
      state,
    }).toString();
    return url.toString();
  }
  async tokenRequest(fields) {
    const { clientId, clientSecret } = this.credentials();
    const result = await this.request(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...fields,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    if (
      !result?.access_token ||
      !Number.isFinite(result.expires_in) ||
      result.expires_in <= 0
    )
      throw new AppError(502, "WHOOP 返回的授权令牌不完整。");
    const old = this.store.get("tokens", {});
    const refreshToken =
      result.refresh_token ||
      (fields.grant_type === "refresh_token" ? old.refresh_token : null);
    if (!refreshToken)
      throw new AppError(
        502,
        "WHOOP 未返回刷新令牌，请允许 offline 权限后重新授权。",
      );
    if (fields.grant_type === "authorization_code") {
      const profile = await this.request(`${API}/user/profile/basic`, {
        headers: { Authorization: `Bearer ${result.access_token}` },
      });
      this.assertAccount(profile);
    }
    this.store.set("tokens", {
      access_token: result.access_token,
      refresh_token: refreshToken,
      expires_at: Date.now() + result.expires_in * 1000,
    });
    return result.access_token;
  }
  assertAccount(profile) {
    if (!Number.isInteger(profile?.user_id))
      throw new AppError(502, "WHOOP 用户信息不完整，本次未保存数据。");
    const previous = this.store.get("profile");
    if (previous && previous.user_id !== profile.user_id)
      throw new AppError(
        409,
        "此控制台已绑定另一 WHOOP 账户。请连接原账户，或为新账户使用独立 DATA_DIR。",
      );
  }
  async exchange(code) {
    if (this.busy || this.syncing)
      throw new AppError(409, "正在同步或连接，请稍后重新授权。");
    this.busy = true;
    try {
      return await this.tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${this.config.origin}/api/whoop/callback`,
      });
    } finally {
      this.busy = false;
    }
  }
  async accessToken(force = false) {
    const tokens = this.store.get("tokens");
    if (!tokens) throw new AppError(401, "尚未连接 WHOOP，请先完成授权。");
    if (!force && tokens.expires_at > Date.now() + 60000)
      return tokens.access_token;
    if (!tokens.refresh_token)
      throw new AppError(
        401,
        "授权缺少刷新令牌，请重新连接并允许 offline 权限。",
      );
    if (!this.refreshing) {
      this.refreshing = this.tokenRequest({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        scope: "offline",
      }).finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }
  async api(path, options = {}) {
    const token = await this.accessToken();
    try {
      return await this.request(`${API}${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (error.status !== 401) throw error;
      const current = this.store.get("tokens");
      const next =
        current?.access_token !== token
          ? current.access_token
          : await this.accessToken(true);
      return this.request(`${API}${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${next}` },
      });
    }
  }
  async collection(path, start) {
    const records = [];
    const seen = new Set();
    let next = null;
    do {
      const query = new URLSearchParams({ start, limit: "25" });
      if (next) query.set("nextToken", next);
      const page = await this.api(`${path}?${query}`);
      if (!Array.isArray(page?.records))
        throw new AppError(502, "WHOOP 分页记录不完整，本次未保存数据。");
      records.push(...page.records);
      next = page.next_token || null;
      if (next && seen.has(next))
        throw new AppError(502, "WHOOP 分页游标重复，本次未保存数据。");
      if (next) seen.add(next);
      if (seen.size > 2000)
        throw new AppError(502, "WHOOP 分页数量超出预期，本次未保存数据。");
    } while (next);
    return records;
  }
  sync(days = 90) {
    if (this.busy)
      return Promise.reject(new AppError(409, "正在连接 WHOOP，请稍后同步。"));
    if (this.syncing) return this.syncing;
    this.syncing = this.runSync(days).finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }
  async runSync(days) {
    const startedAt = new Date().toISOString();
    try {
      const start = new Date(Date.now() - days * DAY).toISOString();
      const profile = await this.api("/user/profile/basic");
      this.assertAccount(profile);
      let body = null;
      try {
        body = await this.api("/user/measurement/body");
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      const collections = {};
      for (const [kind, path] of Object.entries(PATHS)) {
        const records = await this.collection(path, start);
        if (
          records.some(
            (record) =>
              !record ||
              record.user_id !== profile.user_id ||
              (kind === "recoveries"
                ? !Number.isInteger(record.cycle_id)
                : !["string", "number"].includes(typeof record.id)),
          )
        )
          throw new AppError(
            502,
            "WHOOP 记录的归属或标识不完整，本次未保存数据。",
          );
        collections[kind] = records;
      }
      this.store.commitSync({
        profile,
        body,
        collections,
        startedAt,
        finishedAt: new Date().toISOString(),
        lookbackDays: days,
      });
      return this.store.get("sync");
    } catch (error) {
      this.store.set("sync", {
        ...this.store.get("sync", {}),
        attemptedAt: startedAt,
        error:
          error instanceof AppError
            ? error.message
            : "本次同步失败，已保留上次完整数据。",
      });
      throw error;
    }
  }
  async disconnect() {
    if (this.syncing || this.busy)
      throw new AppError(409, "同步或授权尚未结束，请稍后断开连接。");
    this.busy = true;
    try {
      if (this.store.get("tokens"))
        await this.api("/user/access", { method: "DELETE" });
      this.store.remove("tokens");
    } finally {
      this.busy = false;
    }
  }
}
