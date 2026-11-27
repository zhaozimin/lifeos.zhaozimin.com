/**
 * [INPUT]: 全部数据库迁移、模拟微信时间段、Orca脱敏轮次与触点。
 * [OUTPUT]: 双信号全自动切分、后台放飞免误报、重复同步幂等、人工修改冲突保护与AAL2权限验收。
 * [POS]: 0035_orca_ai_alignment 的隔离 PGlite 事务测试，不连接生产库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const owner = '11111111-1111-4111-8111-111111111111';
const hash = 'c'.repeat(64);
const groups = [
  ['time-group-work', '工作', 'core'],
  ['time-group-meal', '饮食', 'recovery'],
  ['time-group-sleep', '睡眠', 'recovery'],
  ['time-group-entertainment', '娱乐', 'leisure'],
  ['time-group-rest', '清醒休息', 'recovery'],
  ['uncategorized', '待确认', 'support'],
].map(([code, name, nature]) => ({ code, name, nature, keywords: [] }));
const rules = [
  { activity: '休息', group: '清醒休息' },
  { activity: '刷手机', group: '娱乐' },
  { activity: '吃早饭', group: '饮食' },
];

async function row(sql, args = []) { return (await db.query(sql, args)).rows[0]; }
async function rows(sql, args = []) { return (await db.query(sql, args)).rows; }

async function wechatApply(extId, text, clock, entries) {
  const id = (await row(
    "select public.ingest_input($1,'wechat',$2,$3,$4,'{}','record') id",
    [owner, extId, text, clock],
  )).id;
  const input = await row(
    "update public.raw_inputs set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=$1 returning *",
    [id],
  );
  const context = (await row('select public.get_steward_context($1) c', [owner])).c;
  return row('select * from public.apply_steward($1,$2,$3,$4)', [
    id, input.lease_token, { time_entries: entries, time_events: [], transactions: [], clarify: null }, context.ongoing,
  ]);
}

async function activeDay(fromIso, toIso) {
  return rows(
    `select t.id, t.start_at, t.end_at, t.duration_min, t.activity, c.name as cat, t.tags, t.note
     from public.time_entries t join public.categories c on c.id = t.category_id
     where t.deleted_at is null and t.start_at >= $1 and t.start_at < $2
     order by t.start_at, t.id`,
    [fromIso, toIso],
  );
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    grant usage on schema public, auth to anon, authenticated, service_role;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select (auth.jwt()->>'sub')::uuid
    $$;
    insert into auth.users values('${owner}');
  `);
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of (await readdir(dir)).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(file, dir), 'utf8'));
  }
  await row('select public.install_time_groups($1,$2,$3,$4,true)', [owner, hash, groups, rules]);
});

after(async () => { await db?.close(); });

test('双信号全自动切分：高频AI审核拆出轻度协同，后台放飞与孤立单次触点不误伤休息', async () => {
  // 写入一整天典型人类时间轴：早餐 + 深度工作 + 2h休息（内含高频审核） + 下午休息（仅1次随手一问）
  await wechatApply('orca-day-1', '补录全天测试', '2026-11-24T22:00:00+08:00', [
    { start_at: '2026-11-24T07:00:00+08:00', end_at: '2026-11-24T07:50:00+08:00', category: 'time-group-meal', activity: '吃早饭', note: null },
    { start_at: '2026-11-24T08:00:00+08:00', end_at: '2026-11-24T10:00:00+08:00', category: 'time-group-work', activity: '写代码', note: null },
    { start_at: '2026-11-24T10:00:00+08:00', end_at: '2026-11-24T12:00:00+08:00', category: 'time-group-rest', activity: '休息', note: null },
    { start_at: '2026-11-24T13:00:00+08:00', end_at: '2026-11-24T15:00:00+08:00', category: 'time-group-rest', activity: '午间休息', note: null },
  ]);

  const turns = [
    // 早饭期间 2 个 AI 后台放飞 44 分钟（只有 07:02 1 个出发触点 → 绝不误切）
    { source: 'orca_native', provider: 'claude', session_key: 's1', turn_key: 't-cruise-1', project_label: 'lifeos', model: 'claude-opus', started_at: '2026-11-24T07:02:00+08:00', ended_at: '2026-11-24T07:46:00+08:00', active_ms: 2640000, wait_human_ms: 0, tool_call_count: 42, subagent_count: 1, outcome: 'success' },
    { source: 'orca_native', provider: 'codex', session_key: 's2', turn_key: 't-cruise-2', project_label: 'lifeos', model: 'codex', started_at: '2026-11-24T07:05:00+08:00', ended_at: '2026-11-24T07:40:00+08:00', active_ms: 2100000, wait_human_ms: 0, tool_call_count: 20, subagent_count: 0, outcome: 'success' },
    // 10:00-12:00 休息期间 3 个并发 AI + 频繁审核（含手机遥控）
    { source: 'orca_native', provider: 'claude', session_key: 's1', turn_key: 't-sup-1', project_label: 'lifeos', model: 'claude-opus', started_at: '2026-11-24T10:10:00+08:00', ended_at: '2026-11-24T10:48:00+08:00', active_ms: 2280000, wait_human_ms: 0, tool_call_count: 30, subagent_count: 0, outcome: 'success' },
    { source: 'orca_native', provider: 'codex', session_key: 's2', turn_key: 't-sup-2', project_label: 'edu', model: 'codex', started_at: '2026-11-24T10:15:00+08:00', ended_at: '2026-11-24T10:42:00+08:00', active_ms: 1620000, wait_human_ms: 0, tool_call_count: 15, subagent_count: 0, outcome: 'success' },
    { source: 'orca_native', provider: 'antigravity', session_key: 's3', turn_key: 't-sup-3', project_label: 'lifeos', model: 'gemini', started_at: '2026-11-24T10:20:00+08:00', ended_at: '2026-11-24T10:50:00+08:00', active_ms: 1800000, wait_human_ms: 0, tool_call_count: 12, subagent_count: 0, outcome: 'success' },
    // 13:30 午间休息只随手问了 1 次（单孤立触点 → 不切碎休息）
    { source: 'orca_native', provider: 'antigravity', session_key: 's3', turn_key: 't-solo-1', project_label: 'notes', model: 'gemini', started_at: '2026-11-24T13:30:00+08:00', ended_at: '2026-11-24T13:36:00+08:00', active_ms: 360000, wait_human_ms: 0, tool_call_count: 2, subagent_count: 0, outcome: 'success' },
  ];

  const touchpoints = [
    { event_key: 'tp-cruise', occurred_at: '2026-11-24T07:02:00+08:00', kind: 'user_prompt', device_origin: 'host', provider: 'claude', session_key: 's1' },
    { event_key: 'tp-sup-1', occurred_at: '2026-11-24T10:10:00+08:00', kind: 'user_prompt', device_origin: 'host', provider: 'claude', session_key: 's1' },
    { event_key: 'tp-sup-2', occurred_at: '2026-11-24T10:21:00+08:00', kind: 'user_prompt', device_origin: 'mobile', provider: 'codex', session_key: 's2' },
    { event_key: 'tp-sup-3', occurred_at: '2026-11-24T10:33:00+08:00', kind: 'user_prompt', device_origin: 'mobile', provider: 'antigravity', session_key: 's3' },
    { event_key: 'tp-sup-4', occurred_at: '2026-11-24T10:44:00+08:00', kind: 'user_prompt', device_origin: 'host', provider: 'claude', session_key: 's1' },
    { event_key: 'tp-solo', occurred_at: '2026-11-24T13:30:00+08:00', kind: 'user_prompt', device_origin: 'mobile', provider: 'antigravity', session_key: 's3' },
  ];

  const pub = (await row('select public.publish_orca_ai($1, $2::jsonb, $3::jsonb) r', [owner, JSON.stringify(turns), JSON.stringify(touchpoints)])).r;
  assert.equal(pub.turns, 6);
  assert.equal(pub.touchpoints, 6);

  const rec = (await row(
    "select public.reconcile_orca_ai_time($1, '2026-11-24', '2026-11-24', '2026-11-24T22:00:00+08:00') r",
    [owner],
  )).r;
  assert.equal(rec.enabled, true);
  assert.equal(rec.applied, 1);
  assert.equal(rec.conflicts, 0);

  const segs = await activeDay('2026-11-24T00:00:00+08:00', '2026-11-25T00:00:00+08:00');
  // 期望：早饭未动 + 深度工作未动 + 休息前段 + AI轻度协同(10:08-10:48) + 休息后段 + 午间休息未动 = 6条
  assert.equal(segs.length, 6);
  assert.equal(segs[0].cat, '饮食');
  assert.equal(segs[1].cat, '工作');
  assert.equal(segs[1].activity, '写代码');
  assert.equal(segs[2].cat, '清醒休息');
  assert.equal(segs[3].cat, '工作');
  assert.equal(segs[3].activity, 'AI轻度协同');
  assert.ok(segs[3].tags.includes('ai-collab'));
  assert.ok(segs[3].tags.includes('orca-auto'));
  assert.match(segs[3].note, /峰值×3并发/);
  assert.match(segs[3].note, /手机遥控2次/);
  assert.equal(segs[4].cat, '清醒休息');
  assert.equal(segs[5].activity, '午间休息');

  // 重复执行必须完全幂等
  const rec2 = (await row(
    "select public.reconcile_orca_ai_time($1, '2026-11-24', '2026-11-24', '2026-11-24T22:00:00+08:00') r",
    [owner],
  )).r;
  assert.equal(rec2.applied, 0);
  assert.equal(rec2.unchanged, 1);
});

test('人工修改后再次同步触发 conflict 保护，绝不覆盖人类手动调整', async () => {
  // 人手把自动切出的 AI轻度协同 改备注或时长
  await db.query("update public.time_entries set note = '人工确认保留' where activity = 'AI轻度协同' and deleted_at is null");
  // 追加 1 个新触点使该簇 payload_hash 变化
  const extraTp = [
    { event_key: 'tp-sup-5', occurred_at: '2026-11-24T10:52:00+08:00', kind: 'user_prompt', device_origin: 'host', provider: 'claude', session_key: 's1' },
  ];
  await row('select public.publish_orca_ai($1, $2::jsonb, $3::jsonb) r', [owner, '[]', JSON.stringify(extraTp)]);
  const rec = (await row(
    "select public.reconcile_orca_ai_time($1, '2026-11-24', '2026-11-24', '2026-11-24T22:00:00+08:00') r",
    [owner],
  )).r;
  assert.equal(rec.conflicts, 1);
  const edited = await row("select note from public.time_entries where activity = 'AI轻度协同' and deleted_at is null");
  assert.equal(edited.note, '人工确认保留');
});

test('AAL2 权限边界：匿名与 AAL1 拒绝读取，本人 AAL2 正常返回双轨数据', async () => {
  await db.exec("set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub', '" + owner + "', 'aal', 'aal1')::text, true);");
  await assert.rejects(
    () => db.query("select public.get_orca_ai_range('2026-11-24', '2026-11-24')"),
    /aal2 required/,
  );

  await db.exec("reset role;");
  await row('select public.publish_orca_ai($1, $2::jsonb, $3::jsonb) r', [
    owner,
    JSON.stringify([{
      source: 'orca_native',
      provider: 'claude',
      session_key: 's-effort',
      turn_key: 't-effort',
      project_label: 'LifeOS',
      model: 'claude-opus-5-5',
      reasoning_effort: 'xhigh',
      started_at: '2026-11-24T16:00:00+08:00',
      ended_at: '2026-11-24T16:20:00+08:00',
      active_ms: 1200000,
    }]),
    '[]',
  ]);
  const res = await db.transaction(async (tx) => {
    await tx.exec(`set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${owner}","aal":"aal2"}', true);`);
    return (await tx.query("select public.get_orca_ai_range('2026-11-24', '2026-11-24') r")).rows[0].r;
  });
  assert.equal(res.turns.length, 7);
  const effortTurn = res.turns.find((t) => t.sessionKey === 's-effort');
  assert.equal(effortTurn?.reasoningEffort, 'xhigh');
  assert.equal(res.touchpoints.length, 7);
  assert.equal(res.alignments.length, 1);
  assert.equal(res.alignments[0].peakConcurrency, 3);
});

test('访客 AI 遥测默认关闭；开启 share_ai_telemetry 后匿名仅读脱敏投影与白名单 system_tags', async () => {
  await db.query('insert into public.visitor_settings(id, owner_id, enabled, share_activity_titles, share_ai_telemetry) values(1, $1, true, false, false) on conflict(id) do update set enabled = true, share_activity_titles = false, share_ai_telemetry = false', [owner]);
  await db.transaction(async (tx) => {
    await tx.exec('set local role anon');
    await assert.rejects(
      () => tx.query("select public.visitor_orca_ai_range('2026-11-24', '2026-11-24')"),
      /visitor ai disabled/,
    );
  });
  await db.transaction(async (tx) => {
    await tx.exec('set local role anon');
    await assert.rejects(
      () => tx.query("select public.orca_ai_range_for_owner($1, '2026-11-24', '2026-11-24')", [owner]),
      /permission denied/,
    );
  });

  // 给自动校对出的轻度协同段混入私有 tag，验证访客投影严格剥离非白名单标签
  await db.query("update public.time_entries set tags = tags || array['PRIVATE-TAG-CANARY'] where activity = 'AI轻度协同' and deleted_at is null");
  await db.query('update public.visitor_settings set share_ai_telemetry = true where id = 1');

  const { ai, vt } = await db.transaction(async (tx) => {
    await tx.exec('set local role anon');
    const aiRes = (await tx.query("select public.visitor_orca_ai_range('2026-11-24', '2026-11-24') r")).rows[0].r;
    const vtRes = (await tx.query("select public.visitor_time('2026-11-24T00:00:00+08:00', '2026-11-25T00:00:00+08:00') r")).rows[0].r;
    return { ai: aiRes, vt: vtRes };
  });

  assert.equal(ai.turns.length, 7);
  assert.equal(ai.turns.find((t) => t.sessionKey === 's-effort')?.reasoningEffort, 'xhigh');
  assert.ok(!JSON.stringify(ai).includes(owner));
  assert.ok(!JSON.stringify(vt).includes('PRIVATE-TAG-CANARY'));
  const collabEntry = vt.entries.find((e) => Array.isArray(e.system_tags));
  assert.ok(collabEntry, '应返回带白名单 system_tags 的轻度协同记录');
  assert.equal(collabEntry.activity, 'AI轻度协同');
  assert.deepEqual(collabEntry.system_tags, ['ai-collab', 'orca-auto']);
  assert.equal(collabEntry.tags, undefined);
});

