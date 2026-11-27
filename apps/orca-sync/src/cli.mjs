#!/usr/bin/env node
/**
 * [INPUT]: 命令行参数（--dry-run/--push/--days/--mode/--db）与本地配置文件。
 * [OUTPUT]: 执行只读采集预览或推送至 VPS/Supabase，并输出结构化状态摘要。
 * [POS]: apps/orca-sync 的 Mac 本机入口；由手动命令或 launchd 定时任务调用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ORCA_DB_PATH, extractOrcaTelemetry } from './extractor.mjs';
import { pushViaSupabase, pushViaVpsSsh } from './transport.mjs';

function loadEnv(filePath) {
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

function parseArgs(argv) {
  const opts = { dryRun: false, push: false, days: null, all: false, mode: null, db: null, env: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--push') opts.push = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--days') opts.days = Number(argv[++i]);
    else if (a === '--mode') opts.mode = argv[++i];
    else if (a === '--db') opts.db = argv[++i];
    else if (a === '--env') opts.env = argv[++i];
  }
  if (!opts.push) opts.dryRun = true;
  return opts;
}

function shanghaiDate(ms) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repoPrivateEnv = fileURLToPath(new URL('../../../.private/orca-sync.env', import.meta.url));
  loadEnv(opts.env || process.env.ORCA_SYNC_ENV || repoPrivateEnv);

  const days = opts.all ? 365 : (Number.isFinite(opts.days) && opts.days > 0 ? opts.days : Number(process.env.ORCA_SYNC_DAYS || 14));
  const nowMs = Date.now();
  const sinceMs = opts.all ? 0 : nowMs - days * 86400_000;
  const dbPath = opts.db || process.env.ORCA_DB_PATH || DEFAULT_ORCA_DB_PATH;
  const salt = process.env.ORCA_HASH_SALT || 'lifeos-orca-default';

  const result = extractOrcaTelemetry({ dbPath, sinceMs, untilMs: nowMs + 60_000, salt });
  const fromDate = result.summary[0]?.date || shanghaiDate(sinceMs);
  const toDate = shanghaiDate(nowMs);

  if (opts.dryRun) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ fromDate, toDate, turns: result.turns.length, touchpoints: result.touchpoints.length, summary: result.summary }, null, 2) + '\n');
      return;
    }
    console.log(`[orca-sync dry-run] 窗口 ${fromDate} ~ ${toDate} | 轮次 ${result.turns.length} | 触点 ${result.touchpoints.length}`);
    console.log('日期         轮次  触点(手机)  算力工时(分)  墙钟(分)  峰值并发  杠杆');
    for (const d of result.summary) {
      console.log(
        `${d.date}   ${String(d.turnCount).padStart(4)}  ${String(d.touchpoints).padStart(4)}(${String(d.mobileTouchpoints).padStart(2)})   ` +
        `${d.agentMinutes.toFixed(1).padStart(10)}  ${d.wallMinutes.toFixed(1).padStart(8)}     ×${String(d.peakConcurrency).padEnd(4)}  ${d.leverageRatio.toFixed(2)}x`,
      );
    }
    return;
  }

  const mode = opts.mode || process.env.ORCA_SYNC_MODE || 'vps-ssh';
  let response;
  if (mode === 'vps-ssh') {
    response = await pushViaVpsSsh({
      sshTarget: process.env.ORCA_VPS_SSH_TARGET,
      remoteCommand: process.env.ORCA_VPS_REMOTE_CMD || '/opt/lifeos-orca/ingest.mjs',
      turns: result.turns,
      touchpoints: result.touchpoints,
      fromDate,
      toDate,
    });
  } else if (mode === 'supabase') {
    response = await pushViaSupabase({
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY,
      ownerId: process.env.LIFEOS_OWNER_ID || process.env.OWNER_AUTH_ID,
      turns: result.turns,
      touchpoints: result.touchpoints,
      fromDate,
      toDate,
    });
  } else {
    throw new Error(`UNSUPPORTED_SYNC_MODE: ${mode}`);
  }

  console.log(JSON.stringify({ ok: true, mode, fromDate, toDate, ...response }));
}

main().catch((err) => {
  console.error('[orca-sync error]', err?.message || err);
  process.exit(1);
});
