/**
 * [INPUT]: 全部生产迁移和隔离PostgreSQL引擎。
 * [OUTPUT]: 计时连续性、冲突回滚、追问分流和停止取消证据。
 * [POS]: 微信计时回归；使用合成身份，不连接生产项目。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db,sequence=0;
const owner='11111111-1111-4111-8111-111111111111';
const empty={time_entries:[],transactions:[],clarify:null};
const at=value=>'2026-11-10T'+value+(value.length===5?':00':'')+'+08:00';
async function row(sql,params=[]){return (await db.query(sql,params)).rows[0];}
async function input(text,clock,kind='record',source='wechat'){
 const id=(await row('select public.ingest_input($1,$2,$3,$4,$5,$6,$7) id',
  [owner,source,'timing:'+ ++sequence,text,clock.includes('T')?clock:at(clock),{},kind])).id;
 return row("update public.raw_inputs set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=$1 returning *",[id]);
}
async function execute(r,plan){
 const context=(await row('select public.get_steward_context($1) data',[owner])).data;
 const saved=await row('select * from public.apply_steward($1,$2,$3,$4)',[r.id,r.lease_token,plan,context.ongoing]);
 await db.query("update public.raw_inputs set receipt_text='合成回执',lease_token=null,lease_until=null where id=$1",[r.id]);
 return saved;
}
async function command(r,name){
 const saved=await row('select * from public.run_command($1,$2,$3)',[r.id,r.lease_token,name]);
 await db.query("update public.raw_inputs set receipt_text='合成回执' where id=$1",[r.id]);
 return saved;
}
function event(clock,activity='活动',action='switch'){
 return {...empty,time_events:[{action,at:at(clock),activity:action==='stop'?null:activity,
  category:action==='stop'?null:'uncategorized',note:null}]};
}
function segment(start,end,activity){return {start_at:at(start),end_at:at(end),activity,category:'uncategorized',note:null};}
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create schema auth;create table auth.users(id uuid primary key);
  grant usage on schema public,auth to anon,authenticated,service_role;
  create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
  create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
  insert into auth.users values('${owner}');`);
 const dir=new URL('../migrations/',import.meta.url);
 for(const file of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
 await db.query("insert into public.categories(owner_id,kind,code,name) values($1,'time','uncategorized','未分类')",[owner]);
});
after(async()=>{await db?.close();});

test('连续补录先闭旧计时，再写中段与最后活动；重放与撤销保留因果',async()=>{
 const start=await input('8:40开始发送任务','08:40');await execute(start,event('08:40','发送任务'));
 const first=await input('10点休息，10点37吃饭','10:37');
 const plan={...event('10:37','吃饭'),time_entries:[segment('10:00','10:37','休息')]};
 assert.equal((await execute(first,plan)).status,'parsed');
 let rows=(await db.query('select activity,start_at,end_at from public.time_entries where deleted_at is null order by start_at')).rows;
 assert.deepEqual(rows.map(x=>x.activity),['发送任务','休息','吃饭']);
 assert.equal(Date.parse(rows[0].end_at),Date.parse(at('10:00')));
 const second=await input('11:07上厕所，11:13休息','11:13');
 const secondPlan={...event('11:13','休息'),time_entries:[segment('11:07','11:13','上厕所')]};
 const result=await execute(second,secondPlan);assert.equal(result.status,'parsed');
 assert.equal(result.parse_result._time_effects.length,1);
 rows=(await db.query('select activity,start_at,end_at from public.time_entries where deleted_at is null order by start_at')).rows;
 assert.deepEqual(rows.map(x=>x.activity),['发送任务','休息','吃饭','上厕所','休息']);
 assert.equal(Date.parse(rows[2].end_at),Date.parse(at('11:07')));assert.equal(rows[4].end_at,null);
 await execute(second,secondPlan);assert.equal((await row('select count(*)::int n from public.time_entries')).n,5);
 const undo=await input('撤销','11:14','command');
 await command(undo,'undo');
 assert.equal((await row('select count(*)::int n from public.time_entries where deleted_at is null')).n,3);
 assert.equal((await row("select end_at from public.time_entries where activity='吃饭'")).end_at,null);
});

test('真实已结束记录冲突时整条回滚，不提前改变旧计时或保存半段',async()=>{
 const raw=await input('补录错误区间','11:15');
 const before=(await row("select * from public.time_entries where activity='吃饭'"));
 const result=await execute(raw,{...event('11:15','活动'),time_entries:[segment('09:00','11:00','错误时段')]});
 assert.equal(result.status,'awaiting_clarification');
 assert.equal((await row('select count(*)::int n from public.time_entries where raw_input_id=$1',[raw.id])).n,0);
 assert.equal((await row('select end_at from public.time_entries where id=$1',[before.id])).end_at,null);
});

test('旧追问不吞新活动和问题；停止独立执行并取消旧追问，重放不重复',async()=>{
 for(const text of ['11:16开始休息','为什么重复提示？']){
  const r=await input(text,'11:16');await db.query('update public.raw_inputs set lease_token=null,lease_until=null where id=$1',[r.id]);
  const claimed=await row('select * from public.claim_next_input($1,true)',[owner]);
  assert.equal(claimed.id,r.id);assert.equal(claimed.clarification_for,null);
  await execute(claimed,{...empty,archive_kind:'raw',answer:'合成答复'});
 }
 const stop=await input('停止计时','11:17','command');
 const result=await command(stop,'stop');
 assert.equal(result.status,'parsed');assert.equal(result.parse_result.command,'stop');
 assert.equal(result.parse_result.stopped_count,1);assert.ok(result.parse_result.cancelled_waits>=1);
 assert.equal((await row('select count(*)::int n from public.time_entries where end_at is null and deleted_at is null')).n,0);
 assert.deepEqual((await command(stop,'stop')).parse_result,result.parse_result);
 assert.equal((await row("select count(*)::int n from public.raw_inputs where status='awaiting_clarification'")).n,0);
});

test('金额短答仍接原追问；独立活动、跨来源与过期短答不绑定',async()=>{
 const waiting=await input('花了点钱','11:18');await execute(waiting,{...empty,clarify:'金额是多少？'});
 const amount=await input('38元','11:19');await db.query('update public.raw_inputs set lease_token=null,lease_until=null where id=$1',[amount.id]);
 let r=await row('select * from public.claim_next_input($1,true)',[owner]);assert.equal(r.id,waiting.id);
 assert.equal(r.reply_input_id,amount.id);await execute(r,{...empty,archive_kind:'raw'});
 const old=await input('金额待补','11:20');await execute(old,{...empty,clarify:'金额是多少？'});
 for(const [clock,source] of [['11:21','another'],['12:00','wechat']]){
  const short=await input('38元',clock,'record',source);await db.query('update public.raw_inputs set lease_token=null,lease_until=null where id=$1',[short.id]);
  r=await row('select * from public.claim_next_input($1,true)',[owner]);assert.equal(r.id,short.id);assert.equal(r.clarification_for,null);
  await execute(r,{...empty,archive_kind:'raw'});
 }
 const cancel=await input('取消追问','12:01','command');
 const result=await command(cancel,'cancel');
 assert.equal(result.parse_result.cancelled_waits,1);
 assert.equal((await row('select receipt_text from public.raw_inputs where id=$1',[old.id])).receipt_text,null);
});

test('超过24小时仍可明确停止；同一分钟停止保留真实秒数，不伪造一分钟',async()=>{
 const raw=await input('现在开始','12:02');await execute(raw,event('12:02'));
 const stop=await input('停止计时','12:02:15','command');
 let result=await command(stop,'stop');assert.equal(result.status,'parsed');
 assert.equal((await row('select duration_min from public.time_entries where raw_input_id=$1',[raw.id])).duration_min,0);
 const restart=await input('再次开始','12:03');await execute(restart,event('12:03'));
 const later=await input('停止计时','2026-11-11T13:04:00+08:00','command');
 result=await command(later,'stop');assert.equal(result.status,'parsed');
});
