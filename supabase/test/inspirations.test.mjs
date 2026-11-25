/**
 * [INPUT]: 全部迁移、微信管家执行器与模拟本人 AAL2 会话。
 * [OUTPUT]: 灵感记录入库、两层标签强约束、撤销、网页 CRUD 及标签管理验收证据。
 * [POS]: 0031 灵感记录迁移的隔离数据库事务测试，不连接生产项目。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const owner = '11111111-1111-4111-8111-111111111111';
const stranger = '22222222-2222-4222-8222-222222222222';

async function row(sql, args = []) {
  return (await db.query(sql, args)).rows[0];
}
async function rows(sql, args = []) {
  return (await db.query(sql, args)).rows;
}

async function asAuth(uid, aal, fn) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: uid, aal }),
    ]);
    await db.exec('set local role authenticated');
    const result = await fn();
    await db.exec('commit');
    return result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

async function wechatApply(extId, text, clock, plan) {
  const id = (
    await row("select public.ingest_input($1,'wechat',$2,$3,$4,'{}','record') id", [
      owner,
      extId,
      text,
      clock,
    ])
  ).id;
  const input = await row(
    "update public.raw_inputs set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=$1 returning *",
    [id],
  );
  const context = (await row('select public.get_steward_context($1) c', [owner])).c;
  const res = await row('select * from public.apply_steward($1,$2,$3,$4)', [
    id,
    input.lease_token,
    { time_entries: [], transactions: [], clarify: null, ...plan },
    context.ongoing,
  ]);
  return { id, res };
}

async function undoAt(extId, clock) {
  const id = (
    await row("select public.ingest_input($1,'wechat',$2,'撤销',$3,'{}','command') id", [
      owner,
      extId,
      clock,
    ])
  ).id;
  const input = await row(
    "update public.raw_inputs set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=$1 returning *",
    [id],
  );
  return row("select * from public.run_command($1,$2,'undo')", [id, input.lease_token]);
}

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;`);
  const dir = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) {
    if (name === '0006_backup_role.sql') continue;
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  await db.query('insert into auth.users(id) values($1),($2)', [owner, stranger]);
  await db.query(
    "insert into public.categories(owner_id,kind,code,name) values($1,'time','uncategorized','待确认'),($1,'money','uncategorized','待确认')",
    [owner],
  );
});

after(async () => {
  await db?.close();
});

test('微信灵感入库保留原话正文，生成短标题、总结与两层标签，并回传上下文', async () => {
  const rawText = '最近一直在思考长期记忆系统。\n我认为好的助理不应该只做检索，还应该能把零散灵感沉淀成结构化资产。';
  const { id, res } = await wechatApply('insp-1', rawText, '2026-11-24T10:00:00+08:00', {
    inspirations: [
      {
        title: '长期记忆与灵感资产化',
        summary: '探讨长期助理应超越简单检索，将零散灵感沉淀为结构化资产。',
        content: rawText,
        tags: [
          { group: 'AI', name: '记忆系统' },
          { group: '产品', name: '个人助理' },
        ],
      },
    ],
  });
  assert.equal(res.status, 'parsed');
  assert.equal(res.parse_result.archive_kind, 'inspiration');

  const snap = (await row('select public.get_input_records($1) s', [id])).s;
  assert.equal(snap.inspirations.length, 1);
  assert.equal(snap.inspirations[0].content, rawText);
  assert.equal(snap.inspirations[0].title, '长期记忆与灵感资产化');
  assert.equal(snap.inspirations[0].summary, '探讨长期助理应超越简单检索，将零散灵感沉淀为结构化资产。');
  assert.deepEqual(snap.inspirations[0].tags, [
    { group: 'AI', name: '记忆系统' },
    { group: '产品', name: '个人助理' },
  ]);

  const ctx = (await row('select public.get_steward_context($1) c', [owner])).c;
  assert.deepEqual(ctx.inspiration_tags, [
    { group: 'AI', tags: ['记忆系统'] },
    { group: '产品', tags: ['个人助理'] },
  ]);
});

test('兜底防漏：仅传 archive_kind=inspiration 时也自动写入 inspirations', async () => {
  const rawText = '突然想到一个短视频脚本的开头结构：先抛反直觉结论再拆真实案例。';
  const { id, res } = await wechatApply('insp-fallback', rawText, '2026-11-24T10:05:00+08:00', {
    archive_kind: 'inspiration',
  });
  assert.equal(res.status, 'parsed');
  const snap = (await row('select public.get_input_records($1) s', [id])).s;
  assert.equal(snap.inspirations.length, 1);
  assert.equal(snap.inspirations[0].content, rawText);
  assert.equal(snap.inspirations[0].title, null);
});

test('混合消息可同时落库灵感与返回自然回答，且微信撤销可软删灵感', async () => {
  const rawText = '帮我记一下：做内容不能只追热点，要建可复用的选题库。顺便点评下。';
  const { id, res } = await wechatApply('insp-mixed', rawText, '2026-11-24T10:10:00+08:00', {
    answer: '核心判断很准，可复用选题库能显著降低长期创作边际成本。',
    inspirations: [
      {
        title: '建立可复用选题库',
        summary: '强调内容创作应重长期复用而非盲目追热点。',
        content: '做内容不能只追热点，要建可复用的选题库。',
        tags: [{ group: '内容', name: '选题方法' }],
      },
    ],
  });
  assert.equal(res.status, 'parsed');
  assert.ok(res.parse_result.answer.includes('可复用选题库'));

  const undone = await undoAt('insp-undo', '2026-11-24T10:11:00+08:00');
  assert.equal(undone.parse_result.undone, true);
  assert.equal(undone.parse_result.inspiration_count, 1);

  const active = await rows('select id from public.inspirations where raw_input_id=$1 and deleted_at is null', [id]);
  assert.equal(active.length, 0);
  const audits = await rows("select revision,actor from public.record_changes where kind='inspiration' order by changed_at desc limit 1");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actor, 'service');
});

test('严格两层标签约束：拒绝第三层、斜杠名和直挂一级大类', async () => {
  const l1 = await row("select id from public.inspiration_tags where owner_id=$1 and level=1 and name='AI'", [owner]);
  const l2 = await row("select id from public.inspiration_tags where owner_id=$1 and level=2 and name='记忆系统'", [owner]);
  const insp = await row('select id from public.inspirations where owner_id=$1 and deleted_at is null limit 1', [owner]);

  // 禁止以二级标签为父级建第三层
  await assert.rejects(
    db.query("insert into public.inspiration_tags(owner_id,level,parent_id,name) values($1,2,$2,'第三层')", [owner, l2.id]),
    /level 2 tag must reference a level 1 group/,
  );
  // 禁止斜杠
  await assert.rejects(
    db.query("insert into public.inspiration_tags(owner_id,level,parent_id,name) values($1,1,null,'AI/子层')", [owner]),
  );
  // 禁止灵感直接挂到一级大类
  await assert.rejects(
    db.query('insert into public.inspiration_tag_links(inspiration_id,tag_id) values($1,$2)', [insp.id, l1.id]),
    /active level 2 tag/,
  );
});

test('本人 AAL2 网页 RPC 支持新建、乐观锁编辑、软删及两层标签管理，非 AAL2 与直接写表被拒绝', async () => {
  // AAL1 拒绝调用
  await assert.rejects(
    asAuth(owner, 'aal1', () => db.query("select public.create_inspiration('测试内容')")),
    /owner aal2 required/,
  );
  // 禁止客户端直接写底表
  await assert.rejects(
    asAuth(owner, 'aal2', () =>
      db.query("insert into public.inspirations(owner_id,source,content) values($1,'web','非法直写')", [owner]),
    ),
  );

  // 新建
  const created = await asAuth(owner, 'aal2', async () => {
    const r = await db.query(
      "select public.create_inspiration($1,$2,$3,$4::jsonb,true) item",
      [
        '网页手写一条长灵感正文，完全保留原文。',
        '网页测试标题',
        '一段简洁总结。',
        JSON.stringify([{ group: '认知', name: '第一性原理' }]),
      ],
    );
    return r.rows[0].item;
  });
  assert.equal(created.source, 'web');
  assert.equal(created.pinned, true);
  assert.equal(created.revision, 1);
  assert.equal(created.tags[0].group, '认知');
  assert.equal(created.tags[0].name, '第一性原理');

  // 他人无法编辑或读取
  await assert.rejects(
    asAuth(stranger, 'aal2', () =>
      db.query("select public.edit_inspiration($1,1,'{\"pinned\":false}'::jsonb)", [created.id]),
    ),
    /inspiration not found/,
  );

  // 仅修改标签也推进 revision 并记录审计
  const edited = await asAuth(owner, 'aal2', async () => {
    const r = await db.query('select public.edit_inspiration($1,$2,$3::jsonb) item', [
      created.id,
      1,
      JSON.stringify({ tags: [{ group: '认知', name: '决策框架' }] }),
    ]);
    return r.rows[0].item;
  });
  assert.equal(edited.revision, 2);
  assert.equal(edited.tags[0].name, '决策框架');

  // 过期版本号返回 40001 冲突
  await assert.rejects(
    asAuth(owner, 'aal2', () =>
      db.query("select public.edit_inspiration($1,1,'{\"pinned\":false}'::jsonb)", [created.id]),
    ),
    /record revision conflict/,
  );

  // 标签管理：建大类、建子标签、重命名、移动、合并、归档
  await asAuth(owner, 'aal2', async () => {
    const gA = (await db.query("select public.manage_inspiration_tag('create_group', $1::jsonb) r", [JSON.stringify({ name: '架构' })])).rows[0].r;
    const gB = (await db.query("select public.manage_inspiration_tag('create_group', $1::jsonb) r", [JSON.stringify({ name: '工程' })])).rows[0].r;
    const t1 = (await db.query("select public.manage_inspiration_tag('create_tag', $1::jsonb) r", [JSON.stringify({ parent_id: gA.id, name: '数据库' })])).rows[0].r;
    const t2 = (await db.query("select public.manage_inspiration_tag('create_tag', $1::jsonb) r", [JSON.stringify({ parent_id: gB.id, name: '存储' })])).rows[0].r;
    const renamed = (await db.query("select public.manage_inspiration_tag('rename', $1::jsonb) r", [JSON.stringify({ id: t2.id, name: '数据库' })])).rows[0].r;
    assert.equal(renamed.name, '数据库');
    // 把大类「架构」合并进「工程」，同名子标签「数据库」自动合并归档
    const merged = (await db.query("select public.manage_inspiration_tag('merge', $1::jsonb) r", [JSON.stringify({ source_id: gA.id, target_id: gB.id })])).rows[0].r;
    assert.equal(merged.merged_into, gB.id);
    const activeChildren = (
      await db.query('select name from public.inspiration_tags where parent_id=$1 and archived_at is null', [gB.id])
    ).rows;
    assert.deepEqual(activeChildren.map((x) => x.name), ['数据库']);
    assert.ok(t1.id);
  });

  // 软删除
  const deleted = await asAuth(owner, 'aal2', async () => {
    const r = await db.query('select public.delete_inspiration($1,$2) res', [created.id, 2]);
    return r.rows[0].res;
  });
  assert.equal(deleted.deleted, true);
});

test('0032 公开可抓取灵感投影：默认关闭，开启后按上海自然日与两层标签筛选且不泄露私有字段', async () => {
  const asAnon = async (fn) => {
    await db.exec('begin');
    try {
      await db.exec("set local role anon; select set_config('request.jwt.claims','{}',true);");
      const r = await fn();
      await db.exec('commit');
      return r;
    } catch (e) {
      await db.exec('rollback');
      throw e;
    }
  };

  await db.query('insert into public.visitor_settings(id, owner_id, enabled) values(1, $1, true) on conflict(id) do update set enabled=true, share_inspirations=false', [owner]);

  // 默认 share_inspirations=false 时匿名拒绝
  await asAnon(async () => {
    const enabled = (await db.query('select public.visitor_inspirations_enabled() ok')).rows[0].ok;
    assert.equal(enabled, false);
    await assert.rejects(db.query('select public.visitor_inspirations()'), /visitor inspirations disabled/);
  });

  // 写入上海自然日 2026-11-25 的灵感
  await wechatApply('msg-public-1', '公开想法A：把每日灵感变成可抓取的公开资产。', '2026-11-24T16:30:00Z', {
    inspirations: [{
      title: '公开灵感资产',
      summary: '让每日灵感可被 Agent 抓取复盘。',
      content: '公开想法A：把每日灵感变成可抓取的公开资产。',
      tags: [{ group: '产品', name: '公开灵感集' }],
    }],
  });

  // 显式开启 share_inspirations=true
  await db.exec('update public.visitor_settings set share_inspirations=true where id=1');

  // 匿名仍不能直查底表
  await assert.rejects(asAnon(() => db.query('select * from public.inspirations')));

  await asAnon(async () => {
    assert.equal((await db.query('select public.visitor_inspirations_enabled() ok')).rows[0].ok, true);

    const dayRes = (await db.query("select public.visitor_inspirations('2026-11-25'::date) data")).rows[0].data;
    assert.equal(dayRes.timezone, 'Asia/Shanghai');
    assert.equal(dayRes.date, '2026-11-25');
    assert.equal(dayRes.items.length, 1);
    assert.equal(dayRes.items[0].title, '公开灵感资产');
    assert.equal(dayRes.items[0].date_shanghai, '2026-11-25');
    // 绝不泄露私有字段
    assert.equal('owner_id' in dayRes.items[0], false);
    assert.equal('raw_input_id' in dayRes.items[0], false);
    assert.equal('revision' in dayRes.items[0], false);
    assert.deepEqual(dayRes.items[0].tags.map((t) => `${t.group}/${t.name}`), ['产品/公开灵感集']);

    // 按一级大类筛选
    const groupRes = (await db.query("select public.visitor_inspirations(null, null, null, '产品') data")).rows[0].data;
    assert.ok(groupRes.items.length >= 1);
    assert.ok(groupRes.available_dates.includes('2026-11-25'));
  });
});


