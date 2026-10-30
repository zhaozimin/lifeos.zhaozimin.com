/**
 * [INPUT]: 依赖 node:path、node:url 和环境变量。
 * [OUTPUT]: 导出本机配置、健康偏好和报告日程验证。
 * [POS]: server 的配置边界；HTTP 与 WHOOP 共用回调地址。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "./http.mjs";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const GOALS = [
  "提升体能与恢复",
  "改善睡眠与精力",
  "减脂并保持肌肉",
  "增肌与力量",
];
export const SCOPES = [
  "offline",
  "read:recovery",
  "read:cycles",
  "read:sleep",
  "read:workout",
  "read:profile",
  "read:body_measurement",
];

export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 3210);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("PORT 必须为 1024–65535 的整数。");
  if (Boolean(env.TLS_CERT_FILE) !== Boolean(env.TLS_KEY_FILE))
    throw new Error("本机 HTTPS 需要同时指定证书和私钥。");
  const secure = Boolean(env.TLS_CERT_FILE);
  return {
    port,
    secure,
    origin: `${secure ? "https" : "http"}://localhost:${port}`,
    dataDir: path.resolve(ROOT, env.DATA_DIR || ".data"),
    certFile: env.TLS_CERT_FILE,
    keyFile: env.TLS_KEY_FILE,
    clientId: env.WHOOP_CLIENT_ID || "",
    clientSecret: env.WHOOP_CLIENT_SECRET || "",
  };
}

export function validateSettings(input) {
  const result = {};
  for (const field of ["clientId", "clientSecret"]) {
    if (input[field] !== undefined) {
      if (typeof input[field] !== "string" || input[field].length > 1024)
        throw new AppError(400, "授权凭据格式不正确。");
      result[field] = input[field].trim();
    }
  }
  if (input.goal !== undefined) {
    if (!GOALS.includes(input.goal))
      throw new AppError(400, "请选择有效的健康目标。");
    result.goal = input.goal;
  }
  if (input.experience !== undefined) {
    if (!["初学 / 重新开始", "规律训练", "长期训练"].includes(input.experience))
      throw new AppError(400, "请选择有效的训练经历。");
    result.experience = input.experience;
  }
  if (input.constraints !== undefined) {
    if (
      typeof input.constraints !== "string" ||
      input.constraints.length > 1000
    )
      throw new AppError(400, "身体限制请控制在 1000 字以内。");
    result.constraints = input.constraints.trim();
  }
  for (const field of ["reportTime", "wakeTime"]) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input[field]))
      throw new AppError(400, "时间必须为有效的 24 小时制 HH:mm。");
    result[field] = input[field];
  }
  if (input.timeZone !== undefined) {
    if (typeof input.timeZone !== "string" || input.timeZone.length > 100)
      throw new AppError(400, "时区格式无效。");
    try { new Intl.DateTimeFormat("en", { timeZone: input.timeZone }).format(); }
    catch { throw new AppError(400, "请填写有效的 IANA 时区，如 Asia/Shanghai。"); }
    result.timeZone = input.timeZone;
  }
  if (input.age !== undefined) {
    if (input.age !== null && (!Number.isInteger(input.age) || input.age < 18 || input.age > 120))
      throw new AppError(400, "此控制台适用于成年人；年龄应为 18–120 或留空。");
    result.age = input.age;
  }
  if (input.diet !== undefined) {
    if (!["不限", "蛋奶素", "纯素"].includes(input.diet)) throw new AppError(400, "饮食偏好无效。");
    result.diet = input.diet;
  }
  if (input.foodRestrictions !== undefined) {
    if (typeof input.foodRestrictions !== "string" || input.foodRestrictions.length > 1000)
      throw new AppError(400, "饮食限制请控制在 1000 字以内。");
    result.foodRestrictions = input.foodRestrictions.trim();
  }
  return result;
}
