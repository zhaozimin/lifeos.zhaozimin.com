/**
 * [INPUT]: 生产迁移、合成微信命令和隔离PostgreSQL。
 * [OUTPUT]: 唯一定位、版本冲突、混合事务回滚、追问和纠错撤销的证据。
 * [POS]: 时间纠错集成验收；不改真实账本、不发送微信。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db,sequence=0;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const stamp=time=>`2026-11-10T${time}:00+08:00`;
const empty={time_entries:[],transactions:[],time_events:[],clarify:null};
async function row(sql,args=[]) {return (await db.query(sql,args)).rows[0];}
async function input(text,at='18:30',person=owner,lease=true,kind='record') {
  const {id}=await row("select public.ingest_input($1,'wechat',$2,$3,$4,'{}',$5) id",
    [person,`correction:${++sequence}`,text,stamp(at),kind]);
  return lease?row("update public.raw_inputs set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=$1 returning *",[id])
    :row('select * from public.raw_inputs where id=$1',[id]);
}
async function seed(activity,start,end,person=owner,source='wechat') {
  const {id}=await row("insert into public.raw_inputs(owner_id,source,external_id,text,received_at,payload,input_kind,status,receipt_text) values($1,$2,$3,$4,$5,'{}','record','parsed','seed') returning id",
    [person,source,`seed:${++sequence}`,activity,stamp(start)]);
  return row("insert into public.time_entries(raw_input_id,item_index,start_at,end_at,category_id,activity) values($1,0,$2,$3,(select id from public.categories where owner_id=$4 and code='rest'),$5) returning *",
    [id,stamp(start),end?stamp(end):null,person,activity]);
}
const correction=(target,patch={activity:'写作',category:'work'})=>({target,patch});
async function prepare(r,requests) {return (await row('select public.find_time_correction_targets($1,$2) value',[r.id,requests])).value;}
async function execute(r,requests,extra={},prepared=null) {
  const targets=prepared??await prepare(r,requests);
  const context=(await row('select public.get_steward_context($1) value',[r.owner_id])).value;
  const saved=await row('select * from public.apply_time_corrections($1,$2,$3,$4,$5)',
    [r.id,r.lease_token,{...empty,...extra,time_corrections:requests},targets,context.ongoing]);
  await db.query("update public.raw_inputs set receipt_text='合成回执',lease_token=null,lease_until=null where id=$1",[r.id]);
  return saved;
}
async function undo() {
  const r=await input('撤销','18:31',owner,true,'command');
  return row("select * from public.run_command($1,$2,'undo')",[r.id,r.lease_token]);
}
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
  for(const person of [owner,other])await db.query("insert into public.categories(owner_id,kind,code,name) values($1,'time','rest','休息'),($1,'time','work','工作'),($1,'time','food','饮食'),($1,'time','uncategorized','待确认')",[person]);
});
after(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('begin');});
afterEach(async()=>{await db.exec('rollback');});

test('修改原记录活动及分类，保留原话、编号、版本和审计，重试不重复修改',async()=>{
  const old=await seed('休息','18:13','18:25');
  const r=await input('把18:13到18:25的休息改为写作');
  const edits=[correction({start_at:stamp('18:13'),end_at:stamp('18:25')})];
  const saved=await execute(r,edits);
  assert.equal(saved.status,'parsed');
  const changed=await row('select * from public.time_entries where id=$1',[old.id]);
  assert.equal(changed.activity,'写作');assert.equal(changed.raw_input_id,old.raw_input_id);assert.equal(changed.revision,2);
  assert.equal((await row('select text from public.raw_inputs where id=$1',[old.raw_input_id])).text,'休息');
  assert.equal((await row('select count(*)::int n from public.record_changes where record_id=$1',[old.id])).n,1);
  assert.equal(saved.parse_result._time_corrections[0].before.activity,'休息');
  assert.equal(saved.parse_result._time_corrections[0].after.category,'工作');
  await execute(r,edits);
  assert.equal((await row('select revision from public.time_entries where id=$1',[old.id])).revision,2);
});

test('纠正正在计时的整段并开始吃饭，一起提交；撤销恢复原段并移除新段',async()=>{
  const old=await seed('休息','18:13',null);
  const r=await input('18:13到18:25实际在写作，现在18:25吃饭','18:25');
  const saved=await execute(r,[correction({start_at:stamp('18:13'),end_at:stamp('18:25')})],
    {time_events:[{action:'switch',at:stamp('18:25'),category:'food',activity:'吃饭',note:null}]});
  assert.equal(saved.status,'parsed');
  const rows=(await db.query('select * from public.time_entries where deleted_at is null order by start_at')).rows;
  assert.deepEqual(rows.map(x=>x.activity),['写作','吃饭']);assert.equal(rows[0].end_at.getTime(),Date.parse(stamp('18:25')));
  const restored=await undo();assert.equal(restored.parse_result.restored_corrections,1);
  const live=(await db.query('select * from public.time_entries where deleted_at is null')).rows;
  assert.equal(live.length,1);assert.equal(live[0].id,old.id);assert.equal(live[0].activity,'休息');assert.equal(live[0].end_at,null);
});

test('后续切换校验失败时，先前纠错也回滚',async()=>{
  const old=await seed('休息','18:13','18:25');
  const r=await input('修改并切换','18:30');
  const saved=await execute(r,[correction({start_at:stamp('18:13')})],
    {time_events:[{action:'switch',at:stamp('20:00'),category:'food',activity:'吃饭',note:null}]});
  assert.equal(saved.status,'awaiting_clarification');
  assert.equal((await row('select activity from public.time_entries where id=$1',[old.id])).activity,'休息');
  assert.equal((await row('select count(*)::int n from public.record_changes')).n,0);
});

test('按当前段纠错再切换时，撤销同时恢复活动和原进行中边界',async()=>{
  const old=await seed('休息','18:13',null);const r=await input('当前段改为写作，然后吃饭','18:25');
  const saved=await execute(r,[correction({position:'current'})],
    {time_events:[{action:'switch',at:stamp('18:25'),category:'food',activity:'吃饭',note:null}]});
  assert.equal(saved.status,'parsed');assert.equal(saved.parse_result._time_corrections[0].after.revision,3);
  assert.equal((await undo()).parse_result.restored_corrections,1);
  const restored=await row('select * from public.time_entries where id=$1',[old.id]);
  assert.equal(restored.activity,'休息');assert.equal(restored.end_at,null);
});

test('同句修改相邻两段的共有边界，不因中间状态重叠而半提交',async()=>{
  const first=await seed('休息','16:00','17:00');const second=await seed('吃饭','17:00','17:30');
  const r=await input('两段的交界都改为16:50');
  const saved=await execute(r,[correction({start_at:stamp('16:00')},{end_at:stamp('16:50')}),
    correction({start_at:stamp('17:00')},{start_at:stamp('16:50')})]);
  assert.equal(saved.status,'parsed');assert.equal(saved.parse_result._time_corrections.length,2);
  assert.equal((await row('select end_at from public.time_entries where id=$1',[first.id])).end_at.getTime(),Date.parse(stamp('16:50')));
  assert.equal((await row('select start_at from public.time_entries where id=$1',[second.id])).start_at.getTime(),Date.parse(stamp('16:50')));
  assert.equal((await undo()).parse_result.restored_corrections,2);
});

test('起止时间可修改，重叠和倒序都拒绝，保留原值',async()=>{
  const old=await seed('休息','16:00','17:00');await seed('吃饭','17:00','17:30');
  let r=await input('结束改为16:50');
  assert.equal((await execute(r,[correction({start_at:stamp('16:00')},{end_at:stamp('16:50')})])).status,'parsed');
  r=await input('结束改为17:10');
  const result=await execute(r,[correction({start_at:stamp('16:00')},{end_at:stamp('17:10')})]);
  assert.match(result.clarification_prompt,/重叠/);
  r=await input('结束改为15点');
  assert.equal((await execute(r,[correction({start_at:stamp('16:00')},{end_at:stamp('15:00')})])).status,'awaiting_clarification');
  assert.equal((await row('select end_at from public.time_entries where id=$1',[old.id])).end_at.getTime(),Date.parse(stamp('16:50')));
});

test('多个候选先追问；日期和区间短答接回原纠错，新的活动不被吞掉',async()=>{
  await seed('休息','16:00','17:00');await seed('休息','18:13','18:25');
  const r=await input('今天休息改成写作','18:26');
  const waiting=await execute(r,[correction({day:'2026-11-10',activity:'休息'})]);
  assert.match(waiting.clarification_prompt,/找到多条/);
  const activity=await input('18:27开始工作','18:27',owner,false);
  assert.equal((await row('select * from public.claim_next_input($1,true)',[owner])).id,activity.id);
  await db.query("update public.raw_inputs set status='parsed',receipt_text='done',lease_token=null,lease_until=null where id=$1",[activity.id]);
  const answer=await input('18:13到18:25那条','18:28',owner,false);
  const claimed=await row('select * from public.claim_next_input($1,true)',[owner]);
  assert.equal(claimed.id,r.id);assert.equal(claimed.reply_input_id,answer.id);
  assert.equal((await row('select clarification_for from public.raw_inputs where id=$1',[answer.id])).clarification_for,r.id);
  assert.equal((await execute(claimed,[correction({start_at:stamp('18:13'),end_at:stamp('18:25')})])).status,'parsed');
});

test('未找到、跨归属、伪造目标及过期版本都不能写入',async()=>{
  const old=await seed('休息','18:13','18:25');const foreign=await seed('休息','18:13','18:25',other);
  let r=await input('改一段不存在的记录');
  assert.match((await execute(r,[correction({start_at:stamp('10:00')})])).clarification_prompt,/没有找到/);
  r=await input('修改休息');const edits=[correction({start_at:stamp('18:13')})];
  const prepared=await prepare(r,edits);assert.equal(prepared[0].count,1);
  const forged=structuredClone(prepared);forged[0].matches[0].id=foreign.id;
  assert.equal((await execute(r,edits,{},forged)).status,'awaiting_clarification');
  r=await input('再修改休息');const version=await prepare(r,edits);
  await db.query("update public.time_entries set note='网页刚刚改过' where id=$1",[old.id]);
  assert.match((await execute(r,edits,{},version)).clarification_prompt,/刚刚发生变化/);
  assert.equal((await row('select activity from public.time_entries where id=$1',[foreign.id])).activity,'休息');
});

test('当前段与上一段可定位；WHOOP评分睡眠保持设备真源保护',async()=>{
  const closed=await seed('休息','16:00','17:00');const current=await seed('休息','18:13',null);
  let r=await input('上一段改写作');assert.equal((await prepare(r,[correction({position:'previous'})]))[0].matches[0].id,closed.id);
  assert.equal((await prepare(r,[correction({position:'current'})]))[0].matches[0].id,current.id);
  const sleep=await seed('睡眠','12:00','13:00',owner,'whoop');
  r=await input('修改WHOOP睡眠');
  assert.match((await execute(r,[correction({start_at:stamp('12:00')})])).clarification_prompt,/WHOOP/);
  assert.equal((await row('select activity from public.time_entries where id=$1',[sleep.id])).activity,'睡眠');
});

test('昨天最后一段按指定日期查找，既有长备注不阻止活动纠错',async()=>{
  const old=await seed('休息','12:00','13:00');await seed('休息','16:00','17:00');
  await db.query("update public.time_entries set start_at=start_at-interval '1 day',end_at=end_at-interval '1 day',note=$2 where id=$1",[old.id,'历史备注'.repeat(200)]);
  const r=await input('昨天最后一段改为写作');
  const edits=[correction({day:'2026-11-09',position:'previous'})];
  assert.equal((await prepare(r,edits))[0].matches[0].id,old.id);
  assert.equal((await execute(r,edits)).status,'parsed');
  assert.equal((await row('select note from public.time_entries where id=$1',[old.id])).note,'历史备注'.repeat(200));
});

test('纠错之后再有网页修改，撤销保留后续修改并给出明确结果',async()=>{
  const old=await seed('休息','18:13','18:25');const r=await input('改写作');
  await execute(r,[correction({start_at:stamp('18:13')})]);
  await db.query("update public.time_entries set note='保留后续人工修改' where id=$1",[old.id]);
  const result=await undo();assert.equal(result.parse_result.correction_conflict,true);
  assert.equal((await row('select activity from public.time_entries where id=$1',[old.id])).activity,'写作');
  assert.equal((await row('select revoked_at from public.raw_inputs where id=$1',[r.id])).revoked_at,null);
});

test('网页和匿名不能调用纠错RPC，非法补丁不能改变来源或删除记录',async()=>{
  const old=await seed('休息','18:13','18:25');const r=await input('修改');
  const saved=await execute(r,[correction({start_at:stamp('18:13')},{deleted_at:'2026-11-10'})]);
  assert.equal(saved.status,'awaiting_clarification');assert.equal((await row('select deleted_at from public.time_entries where id=$1',[old.id])).deleted_at,null);
  for(const role of ['anon','authenticated']){
    await db.exec(`savepoint forbidden; set local role ${role}`);
    try {await assert.rejects(prepare(r,[correction({position:'current'})]),{code:'42501'});}
    finally {await db.exec('rollback to savepoint forbidden; release savepoint forbidden');}
  }
});
