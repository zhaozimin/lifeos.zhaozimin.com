/**
 * [INPUT]: 全量生产迁移、隔离PostgreSQL和合成区间命令。
 * [OUTPUT]: 裁剪保真、并发冲突、权限、事务及撤销的证据。
 * [POS]: 区间替换集成验收；不写真实账本，不发送微信。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db,sequence=0;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const at=time=>`2026-06-18T${time}:00+08:00`;
const empty={time_entries:[],transactions:[],time_events:[],clarify:null};
async function row(sql,args=[]){return (await db.query(sql,args)).rows[0];}
async function input(text='修改时段',person=owner,kind='record'){
  const {id}=await row("select public.ingest_input($1,'wechat',$2,$3,$4,'{}',$5) id",[person,`replace:${++sequence}`,text,at('18:30'),kind]);
  return row("update public.raw_inputs set lease_token=gen_random_uuid(),lease_until=now()+interval '6 minutes' where id=$1 returning *",[id]);
}
async function seed(start,end,activity='洗漱',person=owner,source='wechat'){
  const {id}=await row("insert into public.raw_inputs(owner_id,source,external_id,text,received_at,payload,input_kind,status,receipt_text) values($1,$2,$3,$4,$5,'{}','record','parsed','seed') returning id",[person,source,`seed:${++sequence}`,activity,at(start)]);
  return row("insert into public.time_entries(raw_input_id,item_index,start_at,end_at,category_id,activity,note,project,tags) values($1,0,$2,$3,(select id from public.categories where owner_id=$4 and code='rest'),$5,'原备注','原项目',array['原标签']) returning *",[id,at(start),end?at(end):null,person,activity]);
}
const request=(start='10:15',end='10:45',activity='写方案')=>({start_at:at(start),end_at:at(end),activity,category:'work',note:null});
async function prepare(r,requests){return (await row('select public.find_time_replacement_targets($1,$2) value',[r.id,requests])).value;}
async function execute(r,requests=[request()],extra={},prepared=null,ongoing=null){
  const targets=prepared??await prepare(r,requests);
  const context=(await row('select public.get_steward_context($1) value',[r.owner_id])).value;
  const saved=await row('select * from public.apply_time_replacements($1,$2,$3,$4,$5)',[r.id,r.lease_token,{...empty,...extra,time_replacements:requests},targets,ongoing??context.ongoing]);
  await db.query("update public.raw_inputs set receipt_text='合成回执',lease_token=null,lease_until=null where id=$1",[r.id]);
  return saved;
}
async function live(person=owner){return (await db.query('select t.* from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id where r.owner_id=$1 and t.deleted_at is null order by t.start_at',[person])).rows;}
async function undo(){const r=await input('撤销',owner,'command');return row("select * from public.run_command($1,$2,'undo')",[r.id,r.lease_token]);}
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    insert into auth.users values('${owner}'),('${other}');`);
  const dir=new URL('../migrations/',import.meta.url);
  for(const name of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
  for(const person of [owner,other])await db.query("insert into public.categories(owner_id,kind,code,name) values($1,'time','rest','生活自理'),($1,'time','work','工作'),($1,'time','food','饮食'),($1,'time','uncategorized','待确认')",[person]);
});
after(async()=>{await db?.close();});beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});

test('重叠补录：洗漱54分钟变为24分钟，补入写方案30分钟，邻段与原话保留',async()=>{
  const old=await seed('09:51','10:45');const toilet=await seed('10:45','10:51','上厕所');const rest=await seed('10:51',null,'休息');
  const r=await input('增加一个时间段，10:15~10:45写方案');const saved=await execute(r);
  assert.equal(saved.status,'parsed');const entries=await live();
  assert.deepEqual(entries.map(x=>[x.activity,x.duration_min]),[['洗漱',24],['写方案',30],['上厕所',6],['休息',null]]);
  assert.equal(entries[0].note,'原备注');assert.equal(entries[0].project,'原项目');assert.deepEqual(entries[0].tags,['原标签']);
  assert.equal(entries[2].id,toilet.id);assert.equal(entries[3].id,rest.id);assert.equal(entries[3].revision,1);
  assert.equal((await row('select text from public.raw_inputs where id=$1',[old.raw_input_id])).text,'洗漱');
  assert.equal(saved.parse_result._time_replacements.originals[0].before.duration_min,54);
  assert.equal((await row('select count(*)::int n from public.record_changes')).n,3);
  await execute(r);assert.equal((await live()).length,4);
});

test('内部替换保留两侧原分类与字段；撤销恢复同一原记录身份',async()=>{
  const old=await seed('09:00','12:00');const r=await input();await execute(r);
  assert.deepEqual((await live()).map(x=>[x.activity,x.duration_min]),[['洗漱',75],['写方案',30],['洗漱',75]]);
  const saved=await undo();assert.equal(saved.parse_result.replacement_undone,true);assert.equal(saved.parse_result.restored_replacement_records,1);
  assert.equal((await live())[0].id,old.id);assert.equal((await live())[0].duration_min,180);
  assert.equal((await row('select revoked_at from public.raw_inputs where id=$1',[r.id])).revoked_at instanceof Date,true);
});

test('跨多段替换与空白补录均无重叠且可撤销',async()=>{
  await seed('09:00','10:00');await seed('10:00','11:00','吃饭');
  const r=await input();await execute(r,[request('09:30','10:30')]);
  assert.deepEqual((await live()).map(x=>x.duration_min),[30,60,30]);assert.equal((await undo()).parse_result.restored_replacement_records,2);
  const gap=await input();assert.equal((await execute(gap,[request('12:00','13:00')])).status,'parsed');
  assert.equal((await undo()).parse_result.restored_replacement_records,0);assert.equal((await live()).length,2);
});

test('同一原记录内多个不相交区间保留所有间隙，撤销不恢复中间片段',async()=>{
  const old=await seed('09:00','12:00');const r=await input();
  const saved=await execute(r,[request('09:30','10:00'),request('10:30','11:00','写作')]);
  assert.equal(saved.status,'parsed');assert.equal(saved.parse_result._time_replacements.originals.length,1);
  assert.deepEqual((await live()).map(x=>x.duration_min),[30,30,30,30,60]);await undo();
  assert.equal((await live()).length,1);assert.equal((await live())[0].id,old.id);
});

test('进行中记录裁剪后保留未结束尾段；撤销恢复原进行中边界',async()=>{
  const old=await seed('09:00',null);const r=await input();assert.equal((await execute(r)).status,'parsed');
  const entries=await live();assert.deepEqual(entries.map(x=>x.duration_min),[75,30,null]);assert.equal(entries[2].end_at,null);
  await undo();assert.equal((await live())[0].id,old.id);assert.equal((await live())[0].end_at,null);
});
test('本人活动规则不能覆盖保留片段原有的人工分类',async()=>{
  const old=await seed('09:00','12:00');
  await db.query('insert into public.time_group_policies(owner_id,review_hash) values($1,$2)',[owner,'a'.repeat(64)]);
  await db.query("insert into public.time_group_rules select $1,'洗漱',id,$2 from public.categories where owner_id=$1 and code='work'",[owner,'a'.repeat(64)]);
  const r=await input();assert.equal((await execute(r)).status,'parsed');
  const entries=await live();assert.equal(entries[0].category_id,old.category_id);assert.equal(entries[2].category_id,old.category_id);
  assert.equal(entries[0].note,old.note);assert.deepEqual(entries[0].tags,old.tags);
  await undo();assert.equal((await live())[0].id,old.id);
});
test('替换与下一活动原子成功，撤销恢复原进行中段',async()=>{
  const old=await seed('09:00',null);const r=await input();
  const saved=await execute(r,[request()],{time_events:[{action:'switch',at:at('18:25'),category:'food',activity:'吃饭',note:null}]});
  assert.equal(saved.status,'parsed');assert.equal((await live()).at(-1).activity,'吃饭');
  assert.equal((await live()).at(-1).end_at,null);await undo();
  assert.equal((await live()).length,1);assert.equal((await live())[0].id,old.id);assert.equal((await live())[0].end_at,null);
});
test('空白补录后有新插入竞争，撤销不会制造重叠',async()=>{
  await seed('09:00','12:00');const r=await input();await execute(r);
  await seed('10:20','10:25','后来补的另一段');
  const result=await undo();assert.equal(result.parse_result.replacement_conflict,true);
  assert.equal((await row('select revoked_at from public.raw_inputs where id=$1',[r.id])).revoked_at,null);
});

test('混合计划后续失败时撤回全部裁剪、创建和审计',async()=>{
  const old=await seed('09:00','12:00');const r=await input();
  const saved=await execute(r,[request()],{time_events:[{action:'switch',at:at('20:00'),category:'food',activity:'吃饭',note:null}]});
  assert.equal(saved.status,'awaiting_clarification');assert.equal((await live())[0].id,old.id);assert.equal((await live()).length,1);
  assert.equal((await row('select count(*)::int n from public.record_changes')).n,0);
});

test('版本变化、插入竞争和进行中变化都拒绝旧快照',async()=>{
  const old=await seed('09:00','12:00');let r=await input();let targets=await prepare(r,[request()]);
  await db.query("update public.time_entries set note='网页修改' where id=$1",[old.id]);
  assert.match((await execute(r,[request()],{},targets)).clarification_prompt,/刚刚发生变化/);
  r=await input();targets=await prepare(r,[request()]);await seed('10:20','10:25','另一条');
  assert.match((await execute(r,[request()],{},targets)).clarification_prompt,/刚刚发生变化/);
  r=await input();targets=await prepare(r,[request()]);await seed('14:00',null,'当前活动');
  assert.match((await execute(r,[request()],{},targets,[])).clarification_prompt,/刚刚发生变化/);
  assert.equal((await row('select deleted_at from public.time_entries where id=$1',[old.id])).deleted_at,null);
});

test('跨归属和伪造目标不能修改他人账本',async()=>{
  const own=await seed('09:00','12:00');const foreign=await seed('09:00','12:00','别人的活动',other);
  const r=await input();const targets=await prepare(r,[request()]);assert.equal(targets.length,1);
  const forged=structuredClone(targets);forged[0].id=foreign.id;
  assert.equal((await execute(r,[request()],{},forged)).status,'awaiting_clarification');
  assert.equal((await live())[0].id,own.id);assert.equal((await live(other))[0].id,foreign.id);
});

test('WHOOP评分睡眠与含扣减原段拒绝自动分摊，整批回滚',async()=>{
  await db.exec('savepoint sleep_case');
  const sleep=await seed('09:00','12:00','睡眠',owner,'whoop');let r=await input();
  assert.match((await execute(r)).clarification_prompt,/WHOOP/);
  assert.equal((await live())[0].id,sleep.id);
  await db.exec('rollback to savepoint sleep_case;release savepoint sleep_case');
  const old=await seed('09:00','12:00');await db.query('update public.time_entries set deduction_minutes=5 where id=$1',[old.id]);
  r=await input();assert.match((await execute(r)).clarification_prompt,/扣减/);assert.equal((await live())[0].duration_min,175);
});

test('重叠批次、无效分类和混合纠错拒绝且不留片段',async()=>{
  await seed('09:00','12:00');let r=await input();
  assert.match((await execute(r,[request(),request('10:30','11:00')])).clarification_prompt,/彼此重叠/);
  r=await input();assert.equal((await execute(r,[{...request(),category:'missing'}])).status,'awaiting_clarification');
  r=await input();assert.equal((await execute(r,[request()],{time_corrections:[{}]})).status,'awaiting_clarification');
  assert.equal((await live()).length,1);
});

test('未来、倒序和超长区间及越权字段不进入目标查询',async()=>{
  const r=await input();for(const bad of [request('20:00','21:00'),request('11:00','10:00'),
    {...request(),start_at:'2026-06-15T00:00:00+08:00'}, {...request(),deleted_at:at('10:00')}]){
    await db.exec('savepoint invalid');try{await assert.rejects(prepare(r,[bad]),{code:'22023'});}
    finally{await db.exec('rollback to savepoint invalid; release savepoint invalid');}
  }
});

test('后续人工修改任一生成片段或软删原段时，撤销不覆盖新修改',async()=>{
  for(const modifyOriginal of [false,true]){
    await db.exec('savepoint variant');
    const old=await seed('09:00','12:00');const r=await input();await execute(r);
    const target=modifyOriginal?old.id:(await live())[0].id;
    await db.query("update public.time_entries set note='保留人工修改' where id=$1",[target]);
    const saved=await undo();assert.equal(saved.parse_result.replacement_conflict,true);
    assert.equal((await row('select revoked_at from public.raw_inputs where id=$1',[r.id])).revoked_at,null);
    assert.equal((await row('select note from public.time_entries where id=$1',[target])).note,'保留人工修改');
    await db.exec('rollback to savepoint variant;release savepoint variant');
  }
});

test('匿名与网页身份不能执行区间RPC或片段插入',async()=>{
  const r=await input();for(const role of ['anon','authenticated']){
    for(const attempt of [()=>prepare(r,[request()]),()=>db.query('select public.insert_time_replacement_fragment($1,100,$2,$3,$4)',[r.id,at('10:00'),at('11:00'),{}])]){
      await db.exec(`savepoint forbidden;set local role ${role}`);
      try{await assert.rejects(attempt(),{code:'42501'});}
      finally{await db.exec('rollback to savepoint forbidden;release savepoint forbidden');}
    }
  }
});
