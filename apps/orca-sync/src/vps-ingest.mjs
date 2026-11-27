#!/usr/bin/env node
/**
 * [INPUT]: 标准输入传入的脱敏 Orca AI JSON 载荷与 VPS 本地 Supabase 环境变量。
 * [OUTPUT]: 校验载荷并默认仅幂等写入 Supabase 独立 AI 遥测表（不改写人类时间账本），向标准输出打印 JSON 回执。
 * [POS]: 部署在 VPS /opt/lifeos-orca/ingest.mjs 的无端口接收入口；不暴露公网端口，仅经 SSH 调用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { readFileSync, existsSync } from 'node:fs';
import { pushViaSupabase } from './transport.mjs';

function loadEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}

async function readStdin(maxBytes = 25 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  for (const candidate of [
    process.env.LIFEOS_ORCA_ENV,
    '/etc/lifeos/orca.env',
    '/etc/lifeos/whoop.env',
    '/etc/lifeos/relay.env',
  ]) {
    loadEnvFile(candidate);
  }

  const raw = await readStdin();
  const payload = JSON.parse(raw || '{}');
  if (!Array.isArray(payload.turns) || !Array.isArray(payload.touchpoints)) {
    throw new Error('INVALID_INGEST_PAYLOAD');
  }

  const result = await pushViaSupabase({
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ownerId: process.env.LIFEOS_OWNER_ID || process.env.OWNER_AUTH_ID,
    turns: payload.turns,
    touchpoints: payload.touchpoints,
    fromDate: payload.fromDate || null,
    toDate: payload.toDate || null,
  });

  process.stdout.write(JSON.stringify({ ok: true, ...result }) + '\n');
}

main().catch((err) => {
  process.stderr.write(String(err?.message || err) + '\n');
  process.exit(1);
});
