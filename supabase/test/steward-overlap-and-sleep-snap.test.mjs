/**
 * [INPUT]: 全量生产迁移、隔离 PostgreSQL 与合成计时/区间替换场景。
 * [OUTPUT]: 0034 回归证据：同活动闭合去重防伪重叠、60秒 WHOOP 睡眠边界吸附、进行中并发历史修改与权限隔离。
 * [POS]: 0034_steward_overlap_and_sleep_snap.sql 的集成验收测试；不写真实账本，不发送微信。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
let sequence = 0;
const owner = '11111111-1111-4111-8111-111111111111';
const empty = { time_entries: [], transactions: [], time_events: [], clarify: null };

async function row(sql, args = []) {
  return (await db.query(sql, args)).rows[0];
}

async function input(text, receivedAt, kind = 'record', source = 'wechat') {
  const { id } = await row(
    "select public.ingest_input($1,$2,$3,$4,$5,'{}',$6) id",
    [owner, source, `s0034:${++sequence}`, text, receivedAt, kind],
  );
  return row(
    "update public.raw_inputs set lease_token=gen_random_uuid(),lease_until=now()+interval '6 minutes' where id=$1 returning *",
    [id],
  );
}

async function seedEntry({
  start,
  end,
  activity,
  category = 'self_care',
  source = 'wechat',
  tags = [],
  itemIndex = 0,
}) {
  const { id } = await row(
    "insert into public.raw_inputs(owner_id,source,external_id,text,received_at,payload,input_kind,status,receipt_text) values($1,$2,$3,$4,$5,'{}','record','parsed','seed') returning id",
    [owner, source, `seed:${++sequence}`, activity, start],
  );
  return row(
    `insert into public.time_entries(raw_input_id,item_index,start_at,end_at,category_id,activity,tags)
     values($1,$2,$3,$4,(select id from public.categories where owner_id=$5 and code=$6),$7,$8)
     returning *`,
    [id, itemIndex, start, end, owner, category, activity, tags],
  );
}

async function live() {
  return (
    await db.query(
      `select t.*, c.code as category_code, c.name as category_name
       from public.time_entries t
       join public.raw_inputs r on r.id = t.raw_input_id
       join public.categories c on c.id = t.category_id
       where r.owner_id = $1 and t.deleted_at is null
       order by t.start_at, t.id`,
      [owner],
    )
  ).rows;
}

async function executeSteward(r, plan) {
  const context = (await row('select public.get_steward_context($1) value', [owner])).value;
  const saved = await row(
    'select * from public.apply_steward($1,$2,$3,$4)',
    [r.id, r.lease_token, { ...empty, ...plan }, context.ongoing],
  );
  await db.query(
    "update public.raw_inputs set receipt_text='合成回执',lease_token=null,lease_until=null where id=$1",
    [r.id],
  );
  return saved;
}

async function executeReplace(r, requests) {
  const targets = (
    await row('select public.find_time_replacement_targets($1,$2) value', [r.id, requests])
  ).value;
  const context = (await row('select public.get_steward_context($1) value', [owner])).value;
  const saved = await row(
    'select * from public.apply_time_replacements($1,$2,$3,$4,$5)',
    [r.id, r.lease_token, { ...empty, time_replacements: requests }, targets, context.ongoing],
  );
  await db.query(
    "update public.raw_inputs set receipt_text='合成回执',lease_token=null,lease_until=null where id=$1",
    [r.id],
  );
  return saved;
}

async function undoAt(receivedAt) {
  const r = await input('撤销', receivedAt, 'command');
  return row("select * from public.run_command($1,$2,'undo')", [r.id, r.lease_token]);
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    grant usage on schema public, auth to anon, authenticated, service_role;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    insert into auth.users values('${owner}');
  `);
  const dir = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  await db.query(
    `insert into public.categories(owner_id,kind,code,name) values
      ($1,'time','self_care','生活自理'),
      ($1,'time','rest','清醒休息'),
      ($1,'time','entertainment','娱乐'),
      ($1,'time','sleep','睡眠'),
      ($1,'time','work','工作'),
      ($1,'time','uncategorized','待确认')`,
    [owner],
  );
});

after(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec('begin');
});
afterEach(async () => {
  await db.exec('rollback');
});

// ============================================================
// 1. 同活动闭合去重防伪重叠（还原 22:56 洗漱完毕切换休息）
// ============================================================

test('模型重复输出当前进行中的同活动 + switch 时原地闭合去重，回执完整且可撤销', async () => {
  const ongoing = await seedEntry({
    start: '2026-11-26T22:46:00+08:00',
    end: null,
    activity: '洗漱',
    category: 'self_care',
  });

  const r = await input('22:56，洗漱完毕，休息', '2026-11-26T22:56:45+08:00');
  const saved = await executeSteward(r, {
    time_entries: [
      {
        start_at: '2026-11-26T22:46:00+08:00',
        end_at: '2026-11-26T22:56:00+08:00',
        category: 'self_care',
        activity: '洗漱',
        note: null,
      },
    ],
    time_events: [
      {
        action: 'switch',
        at: '2026-11-26T22:56:00+08:00',
        category: 'rest',
        activity: '休息',
        note: null,
      },
    ],
  });

  assert.equal(saved.status, 'parsed');
  const rows = await live();
  assert.deepEqual(
    rows.map((x) => [x.activity, x.duration_min]),
    [
      ['洗漱', 10],
      ['休息', null],
    ],
  );
  assert.equal(rows[0].id, ongoing.id);

  // 回执快照同时包含闭合后的洗漱与新开启的休息
  const snapshot = (await row('select public.get_input_records($1) value', [r.id])).value;
  assert.deepEqual(
    snapshot.time_entries.map((x) => [x.activity, x.duration_min]),
    [
      ['洗漱', 10],
      ['休息', null],
    ],
  );

  // 撤销应删掉「休息」并把「洗漱」恢复为进行中
  const undone = await undoAt('2026-11-26T22:57:00+08:00');
  assert.equal(undone.parse_result.undone, true);
  assert.equal(undone.parse_result.restored_previous, 1);
  const afterUndo = await live();
  assert.equal(afterUndo.length, 1);
  assert.equal(afterUndo[0].id, ongoing.id);
  assert.equal(afterUndo[0].end_at, null);
});

test('重复输出当前进行中「上厕所」超过10分钟且无明示结束时仍触发10分钟封顶规则', async () => {
  await seedEntry({
    start: '2026-11-26T22:46:00+08:00',
    end: null,
    activity: '上厕所',
    category: 'self_care',
  });

  const r = await input('23:05，开始休息', '2026-11-26T23:05:10+08:00');
  const saved = await executeSteward(r, {
    time_entries: [
      {
        start_at: '2026-11-26T22:46:00+08:00',
        end_at: '2026-11-26T23:05:00+08:00',
        category: 'self_care',
        activity: '上厕所',
        note: null,
      },
    ],
    time_events: [
      {
        action: 'switch',
        at: '2026-11-26T23:05:00+08:00',
        category: 'rest',
        activity: '休息',
        note: null,
      },
    ],
  });

  assert.equal(saved.status, 'parsed');
  const rows = await live();
  assert.deepEqual(
    rows.map((x) => [x.activity, x.duration_min, x.tags]),
    [
      ['上厕所', 10, []],
      ['休息', 9, ['toilet-auto-rest']],
      ['休息', null, []],
    ],
  );
});

test('同起点但活动名不同时不得静默覆盖，仍按重叠拒绝', async () => {
  await seedEntry({
    start: '2026-11-26T11:02:00+08:00',
    end: null,
    activity: '整理课件',
    category: 'work',
  });

  const r = await input('11:02到11:20洗漱', '2026-11-26T11:21:00+08:00');
  const saved = await executeSteward(r, {
    time_entries: [
      {
        start_at: '2026-11-26T11:02:00+08:00',
        end_at: '2026-11-26T11:20:00+08:00',
        category: 'self_care',
        activity: '洗漱',
        note: null,
      },
    ],
  });

  assert.equal(saved.status, 'awaiting_clarification');
  assert.match(saved.clarification_prompt, /重叠/);
  const rows = await live();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].activity, '整理课件');
  assert.equal(rows[0].end_at, null);
});

// ============================================================
// 2. 进行中并发修改历史 + 60 秒 WHOOP 睡眠边界吸附
// ============================================================

test('进行中活动存在时，修改昨日临睡时段（00:16 或 00:17）自动吸附到 WHOOP 精确起点且不打断当前计时', async () => {
  const wrongWash = await seedEntry({
    start: '2026-11-26T22:46:00+08:00',
    end: '2026-11-27T00:16:46.560+08:00',
    activity: '洗漱',
    category: 'self_care',
    tags: ['whoop-boundary-fragment'],
  });
  const whoopSleep = await seedEntry({
    start: '2026-11-27T00:16:46.560+08:00',
    end: '2026-11-27T07:29:06.260+08:00',
    activity: '夜间睡眠',
    category: 'sleep',
    source: 'whoop',
    tags: ['whoop-sleep'],
  });
  const todayOngoing = await seedEntry({
    start: '2026-11-27T08:54:00+08:00',
    end: null,
    activity: '整理口播稿文案',
    category: 'work',
  });

  // 场景 A：用户输入 00:17（比 WHOOP 睡眠 00:16:46.56 多出 13.44 秒），自动吸附到 00:16:46.56
  const r1 = await input('修改时段 昨天 23:06-00:17 刷手机 [娱乐]', '2026-11-27T09:15:00+08:00');
  const saved1 = await executeReplace(r1, [
    {
      start_at: '2026-11-26T23:06:00+08:00',
      end_at: '2026-11-27T00:17:00+08:00',
      activity: '刷手机',
      category: 'entertainment',
      note: null,
    },
  ]);

  assert.equal(saved1.status, 'parsed');
  const rows1 = await live();
  assert.deepEqual(
    rows1.map((x) => [x.activity, x.duration_min]),
    [
      ['洗漱', 20],
      ['刷手机', 70],
      ['夜间睡眠', 432],
      ['整理口播稿文案', null],
    ],
  );
  // 刷手机终点精准贴合 WHOOP 睡眠起点，零秒级碎片
  assert.equal(rows1[1].end_at.getTime(), whoopSleep.start_at.getTime());
  // 今日进行中活动完全未被触动
  assert.equal(rows1[3].id, todayOngoing.id);
  assert.equal(rows1[3].revision, todayOngoing.revision);
  assert.equal(rows1[3].end_at, null);

  // 撤销恢复原 90 分钟洗漱
  const undone = await undoAt('2026-11-27T09:16:00+08:00');
  assert.equal(undone.parse_result.replacement_undone, true);
  assert.equal((await live())[0].id, wrongWash.id);

  // 场景 B：用户输入 00:16（比 WHOOP 睡眠 00:16:46.56 早 46.56 秒），同样吸附到 00:16:46.56，不留 46 秒洗漱残渣
  const r2 = await input('修改时段 昨天 23:06-00:16 刷手机 [娱乐]', '2026-11-27T09:17:00+08:00');
  const saved2 = await executeReplace(r2, [
    {
      start_at: '2026-11-26T23:06:00+08:00',
      end_at: '2026-11-27T00:16:00+08:00',
      activity: '刷手机',
      category: 'entertainment',
      note: null,
    },
  ]);

  assert.equal(saved2.status, 'parsed');
  const rows2 = await live();
  assert.deepEqual(
    rows2.map((x) => [x.activity, x.duration_min]),
    [
      ['洗漱', 20],
      ['刷手机', 70],
      ['夜间睡眠', 432],
      ['整理口播稿文案', null],
    ],
  );
  assert.equal(rows2[1].end_at.getTime(), whoopSleep.start_at.getTime());
});

test('侵入 WHOOP 睡眠超过 60 秒（00:18）时不得吸附，仍按 WHOOP 睡眠保护拒绝', async () => {
  await seedEntry({
    start: '2026-11-26T22:46:00+08:00',
    end: '2026-11-27T00:16:46.560+08:00',
    activity: '洗漱',
    category: 'self_care',
  });
  await seedEntry({
    start: '2026-11-27T00:16:46.560+08:00',
    end: '2026-11-27T07:29:06.260+08:00',
    activity: '夜间睡眠',
    category: 'sleep',
    source: 'whoop',
    tags: ['whoop-sleep'],
  });

  const r = await input('修改时段 昨天 23:06-00:18 刷手机 [娱乐]', '2026-11-27T09:20:00+08:00');
  const saved = await executeReplace(r, [
    {
      start_at: '2026-11-26T23:06:00+08:00',
      end_at: '2026-11-27T00:18:00+08:00',
      activity: '刷手机',
      category: 'entertainment',
      note: null,
    },
  ]);

  assert.equal(saved.status, 'awaiting_clarification');
  assert.match(saved.clarification_prompt, /WHOOP评分睡眠/);
  assert.equal((await live()).length, 2);
});

test('醒后时段（07:29 或 07:30）紧邻 WHOOP 睡眠终点 07:29:06.26 时自动吸附，零碎片无冲突', async () => {
  const whoopSleep = await seedEntry({
    start: '2026-11-27T00:16:46.560+08:00',
    end: '2026-11-27T07:29:06.260+08:00',
    activity: '夜间睡眠',
    category: 'sleep',
    source: 'whoop',
    tags: ['whoop-sleep'],
  });
  await seedEntry({
    start: '2026-11-27T07:29:06.260+08:00',
    end: '2026-11-27T08:30:00+08:00',
    activity: '刷手机',
    category: 'entertainment',
  });

  const r = await input('修改时段 今天 07:29-08:00 洗漱 [生活自理]', '2026-11-27T09:25:00+08:00');
  const saved = await executeReplace(r, [
    {
      start_at: '2026-11-27T07:29:00+08:00',
      end_at: '2026-11-27T08:00:00+08:00',
      activity: '洗漱',
      category: 'self_care',
      note: null,
    },
  ]);

  assert.equal(saved.status, 'parsed');
  const rows = await live();
  assert.deepEqual(
    rows.map((x) => [x.activity, x.duration_min]),
    [
      ['夜间睡眠', 432],
      ['洗漱', 30],
      ['刷手机', 30],
    ],
  );
  assert.equal(rows[1].start_at.getTime(), whoopSleep.end_at.getTime());
});

// ============================================================
// 3. 权限隔离检查
// ============================================================

test('anon 与 authenticated 无权调用 snap_time_replacement_requests 与 apply_steward_records_before_groups', async () => {
  for (const role of ['anon', 'authenticated']) {
    const canSnap = (
      await row(
        "select has_function_privilege($1, 'public.snap_time_replacement_requests(uuid,jsonb,timestamptz)', 'execute') ok",
        [role],
      )
    ).ok;
    const canApply = (
      await row(
        "select has_function_privilege($1, 'public.apply_steward_records_before_groups(uuid,uuid,jsonb,jsonb)', 'execute') ok",
        [role],
      )
    ).ok;
    assert.equal(canSnap, false, `${role} should not execute snap_time_replacement_requests`);
    assert.equal(canApply, false, `${role} should not execute apply_steward_records_before_groups`);
  }
});
