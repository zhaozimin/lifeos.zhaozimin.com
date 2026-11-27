/**
 * [INPUT]: 依赖 Node 22 内置 node:sqlite/node:crypto 与 Orca 本机 agent-session-domain.db（只读）。
 * [OUTPUT]: 对外提供 extractOrcaTelemetry、computeDailySummary 与隐私脱敏工具函数。
 * [POS]: apps/orca-sync 的采集与脱敏核心；剥离一切 Prompt/代码/绝对路径，扣除等人类审批死时间。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_ORCA_DB_PATH = path.join(
  homedir(),
  'Library',
  'Application Support',
  'orca',
  'agent-session-domain.db',
);

const DEAD_WAIT_GAP_MS = 3 * 60 * 1000;

function safeJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function hashKey(raw, salt = 'lifeos-orca') {
  return createHash('sha256').update(`${salt}:${raw}`).digest('hex').slice(0, 24);
}

export function sanitizeProjectLabel(location, aliasMap = {}) {
  const rawPath = typeof location === 'string'
    ? location
    : (location && typeof location === 'object' ? (location.workspaceId || location.cwd || location.path || '') : '');
  const trimmed = String(rawPath || '').trim().replace(/[\\/]+$/, '');
  if (!trimmed) return null;
  const base = path.basename(trimmed);
  if (!base || base === '/' || base === '.') return null;
  const mapped = aliasMap[base] || base;
  return String(mapped).slice(0, 80);
}

function parseDeviceOrigin(typedBy) {
  if (!typedBy || typeof typedBy !== 'object') return 'unknown';
  if (typedBy.by === 'host') return 'host';
  if (typedBy.by === 'device' || typedBy.deviceId) return 'mobile';
  return 'unknown';
}

function localDay(ms, timeZone = 'Asia/Shanghai') {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/**
 * 扣除轮次内部「AI 发起 question/approval 后静默等待人类超过 3 分钟」的死时间。
 */
export function computeActiveAndWaitMs(startMs, endMs, children) {
  const rawMs = Math.max(0, endMs - startMs);
  if (!children.length || rawMs <= DEAD_WAIT_GAP_MS) {
    return { activeMs: rawMs, waitHumanMs: 0 };
  }
  const ordered = children
    .filter((c) => Number.isFinite(c.ts) && c.ts >= startMs && c.ts <= endMs)
    .sort((a, b) => a.ts - b.ts);

  let waitHumanMs = 0;
  for (let i = 0; i < ordered.length; i++) {
    const cur = ordered[i];
    if (cur.kind !== 'question' && cur.kind !== 'approval') continue;
    const nextTs = i + 1 < ordered.length ? ordered[i + 1].ts : endMs;
    const gap = Math.max(0, nextTs - cur.ts);
    if (gap > DEAD_WAIT_GAP_MS) {
      waitHumanMs += gap;
    }
  }
  const clampedWait = Math.min(rawMs, waitHumanMs);
  return { activeMs: Math.max(0, rawMs - clampedWait), waitHumanMs: clampedWait };
}

/**
 * 从 Orca agent-session-domain.db 只读提取并脱敏 AI 轮次与人类交互触点。
 */
export function extractOrcaTelemetry({
  dbPath = DEFAULT_ORCA_DB_PATH,
  sinceMs = 0,
  untilMs = Date.now() + 60_000,
  salt = 'lifeos-orca',
  projectAliasMap = {},
  timeZone = 'Asia/Shanghai',
} = {}) {
  if (!existsSync(dbPath)) {
    throw new Error(`ORCA_DB_NOT_FOUND: ${dbPath}`);
  }

  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
  try {
    // 1. 会话元信息（仅取 provider、默认模型/推理强度与脱敏后的项目末段名，不取会话标题或完整路径）
    const sessionMeta = new Map();
    for (const row of db.prepare('SELECT session_id, record_json FROM agent_session_records').all()) {
      const rec = safeJson(row.record_json) || {};
      const opts = rec.options && typeof rec.options === 'object' ? rec.options : {};
      sessionMeta.set(row.session_id, {
        provider: String(rec.provider || rec.agentKind || 'unknown').toLowerCase().slice(0, 40),
        sessionKey: hashKey(row.session_id, salt),
        projectLabel: sanitizeProjectLabel(rec.location, projectAliasMap),
        defaultModel: typeof opts.model === 'string' && opts.model ? opts.model.slice(0, 120) : null,
        defaultEffort: typeof opts.effort === 'string' && opts.effort ? opts.effort.toLowerCase().slice(0, 32) : null,
      });
    }

    // 1.5 可选索引每轮提交记录中的模型与推理强度（options.model / options.effort）
    const attemptsBySession = new Map();
    const hasAttemptsTable = Boolean(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'journal_submission_attempts'").get(),
    );
    if (hasAttemptsTable) {
      const attemptStmt = db.prepare(`
        SELECT session_id, submitted_at, payload_json
        FROM journal_submission_attempts
        WHERE current = 1
        ORDER BY session_id, submitted_at ASC
      `);
      for (const row of attemptStmt.all()) {
        const p = safeJson(row.payload_json);
        const opts = p?.options && typeof p.options === 'object' ? p.options : null;
        if (!opts || (!opts.model && !opts.effort)) continue;
        let list = attemptsBySession.get(row.session_id);
        if (!list) {
          list = [];
          attemptsBySession.set(row.session_id, list);
        }
        list.push({
          submittedAt: Number(row.submitted_at || 0),
          model: typeof opts.model === 'string' && opts.model ? opts.model.slice(0, 120) : null,
          effort: typeof opts.effort === 'string' && opts.effort ? opts.effort.toLowerCase().slice(0, 32) : null,
        });
      }
    }

    const resolveAttemptOptions = (sessionId, startMs) => {
      const list = attemptsBySession.get(sessionId);
      if (!list || !list.length) return null;
      let matched = null;
      for (const item of list) {
        if (item.submittedAt <= startMs + 5000) matched = item;
        else break;
      }
      return matched;
    };

    // 2. 预索引每个 turn_item_id 下的子事件（工具调用次数、子代理数、审批等待断点）
    const childIndex = new Map();
    const childStmt = db.prepare(`
      SELECT session_id, turn_item_id, kind, subagent_row, subagent_group_key, payload_json
      FROM journal_items
      WHERE turn_item_id IS NOT NULL
        AND kind IN ('tool-call', 'question', 'approval', 'message')
    `);
    for (const row of childStmt.all()) {
      const key = `${row.session_id}\0${row.turn_item_id}`;
      let entry = childIndex.get(key);
      if (!entry) {
        entry = { toolCalls: 0, subagents: new Set(), events: [] };
        childIndex.set(key, entry);
      }
      if (row.kind === 'tool-call') entry.toolCalls += 1;
      if (row.subagent_row === 1 && row.subagent_group_key) entry.subagents.add(row.subagent_group_key);
      const p = safeJson(row.payload_json);
      const ts = Number(p?.observedAt || p?.body?.observedAt || 0);
      if (Number.isFinite(ts) && ts > 0) {
        entry.events.push({ kind: row.kind, ts });
      }
    }

    // 3. 提取轮次（turn）
    const turns = [];
    const turnStmt = db.prepare(`
      SELECT session_id, item_id, turn_id, lifecycle_state, turn_completed_at, payload_json
      FROM journal_items
      WHERE kind = 'turn'
    `);
    for (const row of turnStmt.all()) {
      const p = safeJson(row.payload_json) || {};
      const body = p.body || {};
      const startMs = Number(body.requestedAt || body.startedAt || p.observedAt || 0);
      const endMs = Number(body.completedAt || row.turn_completed_at || 0);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs <= 0 || endMs < startMs) continue;
      if (endMs < sinceMs || startMs > untilMs) continue;

      const meta = sessionMeta.get(row.session_id) || {
        provider: 'unknown',
        sessionKey: hashKey(row.session_id, salt),
        projectLabel: null,
        defaultModel: null,
        defaultEffort: null,
      };
      const attemptOpt = resolveAttemptOptions(row.session_id, startMs);
      const child = childIndex.get(`${row.session_id}\0${row.item_id}`);
      const { activeMs, waitHumanMs } = computeActiveAndWaitMs(startMs, endMs, child ? child.events : []);
      const model = body?.contextUsage?.used?.model || body?.model || attemptOpt?.model || meta.defaultModel || null;
      const reasoningEffort = body?.effort || body?.reasoningEffort || attemptOpt?.effort || meta.defaultEffort || null;
      const rawTurnKey = row.turn_id || row.item_id || `${row.session_id}:${startMs}`;

      turns.push({
        source: 'orca_native',
        provider: meta.provider,
        session_key: meta.sessionKey,
        turn_key: hashKey(`${row.session_id}:${rawTurnKey}`, salt),
        project_label: meta.projectLabel,
        model: model ? String(model).slice(0, 120) : null,
        reasoning_effort: reasoningEffort ? String(reasoningEffort).toLowerCase().slice(0, 32) : null,
        started_at: new Date(startMs).toISOString(),
        ended_at: new Date(endMs).toISOString(),
        active_ms: Math.round(activeMs),
        wait_human_ms: Math.round(waitHumanMs),
        tool_call_count: child ? child.toolCalls : 0,
        subagent_count: child ? child.subagents.size : 0,
        outcome: body.outcome || row.lifecycle_state || null,
      });
    }

    // 4. 提取人类交互触点（user 消息，绝不读取 blocks 正文）
    const touchpoints = [];
    const tpStmt = db.prepare(`
      SELECT session_id, item_id, payload_json
      FROM journal_items
      WHERE kind = 'message' AND message_role = 'user'
    `);
    for (const row of tpStmt.all()) {
      const p = safeJson(row.payload_json) || {};
      const ts = Number(p.observedAt || p.body?.observedAt || 0);
      if (!Number.isFinite(ts) || ts <= 0 || ts < sinceMs || ts > untilMs) continue;
      const meta = sessionMeta.get(row.session_id) || {
        provider: 'unknown',
        sessionKey: hashKey(row.session_id, salt),
      };
      touchpoints.push({
        event_key: hashKey(`user:${row.session_id}:${row.item_id || ts}`, salt),
        occurred_at: new Date(ts).toISOString(),
        kind: 'user_prompt',
        device_origin: parseDeviceOrigin(p.body?.typedBy),
        provider: meta.provider,
        session_key: meta.sessionKey,
      });
    }

    turns.sort((a, b) => a.started_at.localeCompare(b.started_at));
    touchpoints.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

    const summary = computeDailySummary(turns, touchpoints, timeZone);
    return {
      extractedAt: new Date().toISOString(),
      turns,
      touchpoints,
      summary,
    };
  } finally {
    db.close();
  }
}

/**
 * 纯函数汇总每日算力工时、墙钟并集时长、峰值并发与触点数（用于 dry-run 与单元测试）。
 */
export function computeDailySummary(turns, touchpoints, timeZone = 'Asia/Shanghai') {
  const byDay = new Map();
  const ensure = (day) => {
    let row = byDay.get(day);
    if (!row) {
      row = { date: day, turns: [], touchpoints: 0, mobileTouchpoints: 0, providers: {} };
      byDay.set(day, row);
    }
    return row;
  };

  for (const t of turns) {
    const startMs = Date.parse(t.started_at);
    const endMs = Date.parse(t.ended_at);
    const day = localDay(startMs, timeZone);
    const row = ensure(day);
    row.turns.push({ startMs, endMs, activeMs: t.active_ms, provider: t.provider });
    row.providers[t.provider] = (row.providers[t.provider] || 0) + 1;
  }
  for (const tp of touchpoints) {
    const day = localDay(Date.parse(tp.occurred_at), timeZone);
    const row = ensure(day);
    row.touchpoints += 1;
    if (tp.device_origin === 'mobile') row.mobileTouchpoints += 1;
  }

  return [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => {
      const events = [];
      for (const t of row.turns) {
        events.push([t.startMs, 1], [t.endMs, -1]);
      }
      events.sort((a, b) => (a[0] - b[0]) || (b[1] - a[1]));
      let conc = 0;
      let peakConcurrency = 0;
      let wallMs = 0;
      let prev = null;
      for (const [ts, delta] of events) {
        if (prev !== null && conc > 0) wallMs += Math.max(0, ts - prev);
        conc += delta;
        if (conc > peakConcurrency) peakConcurrency = conc;
        prev = ts;
      }
      const agentMinutes = Math.round((row.turns.reduce((s, t) => s + t.activeMs, 0) / 60000) * 10) / 10;
      const wallMinutes = Math.round((wallMs / 60000) * 10) / 10;
      return {
        date: row.date,
        turnCount: row.turns.length,
        touchpoints: row.touchpoints,
        mobileTouchpoints: row.mobileTouchpoints,
        agentMinutes,
        wallMinutes,
        peakConcurrency,
        leverageRatio: wallMinutes > 0 ? Math.round((agentMinutes / wallMinutes) * 100) / 100 : 0,
        providers: row.providers,
      };
    });
}
