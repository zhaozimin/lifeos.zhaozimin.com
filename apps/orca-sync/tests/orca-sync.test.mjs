/**
 * [INPUT]: 合成 Orca SQLite 夹具库与模拟 RPC 传输桩。
 * [OUTPUT]: 提取脱敏、审批死时间扣除、并发统计与幂等发布测试证据。
 * [POS]: apps/orca-sync 的离线回归测试，不连接本机真实 Orca 库或云端生产库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { computeActiveAndWaitMs, extractOrcaTelemetry, sanitizeProjectLabel } from '../src/extractor.mjs';
import { pushViaSupabase } from '../src/transport.mjs';

test('扣除 question/approval 后超过 3 分钟的等人类审批死时间', () => {
  const t0 = Date.parse('2026-11-24T10:00:00+08:00');
  const tEnd = t0 + 25 * 60_000;
  const children = [
    { kind: 'tool-call', ts: t0 + 2 * 60_000 },
    { kind: 'question', ts: t0 + 5 * 60_000 },
    // 人类 12 分钟后才回答
    { kind: 'tool-call', ts: t0 + 17 * 60_000 },
  ];
  const { activeMs, waitHumanMs } = computeActiveAndWaitMs(t0, tEnd, children);
  assert.equal(waitHumanMs, 12 * 60_000);
  assert.equal(activeMs, 13 * 60_000);
});

test('脱敏项目名只保留末段目录名且绝不泄漏绝对路径', () => {
  assert.equal(sanitizeProjectLabel({ workspaceId: '/workspace/projects/lifeos-demo/' }), 'lifeos-demo');
  assert.equal(sanitizeProjectLabel({ cwd: '/workspace/projects/demo-app/' }), 'demo-app');
  assert.equal(sanitizeProjectLabel({ cwd: '/workspace/projects/demo-app' }, { 'demo-app': 'LifeOS' }), 'LifeOS');
  assert.equal(sanitizeProjectLabel(null), null);
});

test('从模拟 Orca SQLite 提取多引擎并发轮次、本机/手机触点并剥离所有正文', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'orca-sync-test-'));
  const dbPath = path.join(dir, 'agent-session-domain.db');
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE agent_session_records (session_id TEXT PRIMARY KEY, record_json TEXT);
      CREATE TABLE journal_submission_attempts (
        session_id TEXT, current INTEGER, submitted_at INTEGER, payload_json TEXT
      );
      CREATE TABLE journal_items (
        session_id TEXT, item_id TEXT, turn_id TEXT, turn_item_id TEXT,
        kind TEXT, message_role TEXT, lifecycle_state TEXT,
        turn_completed_at REAL, subagent_row INTEGER, subagent_group_key TEXT,
        payload_json TEXT
      );
    `);

    const insSess = db.prepare('INSERT INTO agent_session_records VALUES (?, ?)');
    insSess.run('sess-claude', JSON.stringify({
      provider: 'claude',
      location: { cwd: '/private/path/proj-alpha' },
      options: { model: 'claude-opus-5-5', effort: 'high' },
    }));
    insSess.run('sess-codex', JSON.stringify({
      provider: 'codex',
      location: { cwd: '/private/path/proj-beta' },
      options: { model: 'gpt-6.2-sol', effort: 'medium' },
    }));

    const t1Start = Date.parse('2026-11-24T10:00:00+08:00');
    const t1End = Date.parse('2026-11-24T10:30:00+08:00');
    const t2Start = Date.parse('2026-11-24T10:10:00+08:00');
    const t2End = Date.parse('2026-11-24T10:25:00+08:00');

    const insAttempt = db.prepare('INSERT INTO journal_submission_attempts VALUES (?, ?, ?, ?)');
    insAttempt.run('sess-codex', 1, t2Start - 1000, JSON.stringify({
      options: { model: 'gpt-6.2-astra', effort: 'xhigh' },
    }));

    const insItem = db.prepare('INSERT INTO journal_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insItem.run('sess-claude', 'turn-item-1', 'turn-1', null, 'turn', null, 'completed', t1End, 0, null, JSON.stringify({
      body: { startedAt: t1Start, completedAt: t1End, outcome: 'success', contextUsage: { used: { model: 'claude-opus-5-5' } } },
    }));
    insItem.run('sess-claude', 'tc-1', null, 'turn-item-1', 'tool-call', null, null, null, 1, 'sub-a', JSON.stringify({ observedAt: t1Start + 60_000 }));
    insItem.run('sess-codex', 'turn-item-2', 'turn-2', null, 'turn', null, 'completed', t2End, 0, null, JSON.stringify({
      body: { startedAt: t2Start, completedAt: t2End, outcome: 'success' },
    }));
    insItem.run('sess-claude', 'u-1', null, null, 'message', 'user', null, null, 0, null, JSON.stringify({
      observedAt: t1Start,
      body: { typedBy: { by: 'host' }, blocks: [{ type: 'text', text: '绝密提问正文绝对不能出现' }] },
    }));
    insItem.run('sess-codex', 'u-2', null, null, 'message', 'user', null, null, 0, null, JSON.stringify({
      observedAt: t2Start,
      body: { typedBy: { by: 'device', deviceId: 'phone-1' }, blocks: [{ type: 'text', text: '手机远程私密指令' }] },
    }));
    db.close();

    const out = extractOrcaTelemetry({ dbPath, sinceMs: t1Start - 60_000, untilMs: t1End + 60_000, salt: 'test-salt' });
    const serialized = JSON.stringify(out);
    assert.ok(!serialized.includes('绝密提问正文'));
    assert.ok(!serialized.includes('/private/path/'));
    assert.ok(!serialized.includes('sess-claude'));

    assert.equal(out.turns.length, 2);
    assert.equal(out.turns[0].project_label, 'proj-alpha');
    assert.equal(out.turns[0].model, 'claude-opus-5-5');
    assert.equal(out.turns[0].reasoning_effort, 'high');
    assert.equal(out.turns[0].tool_call_count, 1);
    assert.equal(out.turns[0].subagent_count, 1);
    assert.equal(out.turns[1].model, 'gpt-6.2-astra');
    assert.equal(out.turns[1].reasoning_effort, 'xhigh');
    assert.equal(out.touchpoints.length, 2);
    assert.equal(out.touchpoints[0].device_origin, 'host');
    assert.equal(out.touchpoints[1].device_origin, 'mobile');

    assert.equal(out.summary.length, 1);
    assert.equal(out.summary[0].peakConcurrency, 2);
    assert.equal(out.summary[0].wallMinutes, 30);
    assert.equal(out.summary[0].agentMinutes, 45);
    assert.equal(out.summary[0].leverageRatio, 1.5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pushViaSupabase 默认仅幂等调用 publish_orca_ai，不触发人类时间段自动切分', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ turns: 1, touchpoints: 1 }), { status: 200 });
  };
  const res = await pushViaSupabase({
    url: 'https://demo.supabase.co',
    key: 'service-key',
    ownerId: 'owner-1',
    turns: [{ turn_key: 'k1' }],
    touchpoints: [{ event_key: 'e1' }],
    fromDate: '2026-11-24',
    toDate: '2026-11-24',
    fetcher,
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/publish_orca_ai$/);
  assert.equal(res.reconcile, null);
});
