/**
 * [INPUT]: 脱敏后的 Orca AI 载荷与传输配置（VPS SSH 通道或 Supabase 直连）。
 * [OUTPUT]: 对外提供 pushViaSupabase 与 pushViaVpsSsh 两个幂等发布适配器。
 * [POS]: apps/orca-sync 的传输层；支持 Mac 零管理员密钥经 SSH 推送至 VPS 落库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { spawn } from 'node:child_process';

const TURN_CHUNK = 500;
const TP_CHUNK = 1000;

function chunkArray(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function callSupabaseRpc({ url, key, name, args, fetcher = fetch, timeoutMs = 45000 }) {
  const endpoint = `${url.replace(/\/+$/, '')}/rest/v1/rpc/${name}`;
  const res = await fetcher(endpoint, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`SUPABASE_RPC_${name}_FAILED(${res.status}): ${text.slice(0, 240)}`);
  }
  return text ? JSON.parse(text) : null;
}

/**
 * 直连 Supabase RPC（VPS ingest 与直连模式共用同一幂等发布实现）。
 * 默认仅发布独立 AI 遥测（turns/touchpoints），不切分或改写人类时间账本；仅在显式传 reconcile: true 时才执行校对。
 */
export async function pushViaSupabase({
  url,
  key,
  ownerId,
  turns = [],
  touchpoints = [],
  fromDate = null,
  toDate = null,
  reconcile = false,
  fetcher = fetch,
}) {
  if (!url || !key || !ownerId) {
    throw new Error('MISSING_SUPABASE_CREDENTIALS');
  }
  const turnChunks = chunkArray(turns, TURN_CHUNK);
  const tpChunks = chunkArray(touchpoints, TP_CHUNK);
  const rounds = Math.max(1, turnChunks.length, tpChunks.length);
  let totalTurns = 0;
  let totalTouchpoints = 0;

  for (let i = 0; i < rounds; i++) {
    const res = await callSupabaseRpc({
      url,
      key,
      name: 'publish_orca_ai',
      args: {
        p_owner_id: ownerId,
        p_turns: turnChunks[i] || [],
        p_touchpoints: tpChunks[i] || [],
      },
      fetcher,
    });
    totalTurns += Number(res?.turns || 0);
    totalTouchpoints += Number(res?.touchpoints || 0);
  }

  let reconcileResult = null;
  if (reconcile) {
    reconcileResult = await callSupabaseRpc({
      url,
      key,
      name: 'reconcile_orca_ai_time',
      args: {
        p_owner_id: ownerId,
        p_from_date: fromDate,
        p_to_date: toDate,
      },
      fetcher,
    });
  }

  return {
    transport: 'supabase',
    published: { turns: totalTurns, touchpoints: totalTouchpoints },
    reconcile: reconcileResult,
  };
}

/**
 * 经由 SSH 标准输入推送至 VPS 接收器（Mac 本机无需持有 Supabase service_role 密钥）。
 */
export async function pushViaVpsSsh({
  sshTarget,
  remoteCommand = '/opt/lifeos-orca/ingest.mjs',
  sshArgs = [],
  turns = [],
  touchpoints = [],
  fromDate = null,
  toDate = null,
  timeoutMs = 60000,
}) {
  if (!sshTarget) throw new Error('MISSING_VPS_SSH_TARGET');
  const envelope = JSON.stringify({ fromDate, toDate, turns, touchpoints });

  return new Promise((resolve, reject) => {
    const args = [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=15',
      ...sshArgs,
      sshTarget,
      remoteCommand,
    ];
    const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('VPS_SSH_PUSH_TIMEOUT'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`VPS_SSH_PUSH_FAILED(${code}): ${stderr.trim().slice(0, 260)}`));
        return;
      }
      try {
        resolve({ transport: 'vps-ssh', remote: JSON.parse(stdout.trim() || '{}') });
      } catch {
        resolve({ transport: 'vps-ssh', raw: stdout.trim() });
      }
    });
    child.stdin.end(envelope);
  });
}
