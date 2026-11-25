/**
 * [INPUT]: 全部迁移、大类策略夹具、模拟微信切换与WHOOP睡眠。
 * [OUTPUT]: 睡眠邻近短空白推定、跨夜生活自理醒后转手机、如厕超10分转休息与v1升级回归证据。
 * [POS]: 0030过渡规则的隔离数据库事务测试，不连接生产项目。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

let db;
const owner='11111111-1111-4111-8111-111111111111';
const hash='b'.repeat(64);
const groups=[
 ['time-group-work','工作','core'],
 ['time-group-selfcare','生活自理','support'],
 ['time-group-sleep','睡眠','recovery'],
 ['time-group-entertainment','娱乐','leisure'],
 ['time-group-rest','清醒休息','recovery'],
 ['time-group-social','私人社交','leisure'],
 ['uncategorized','待确认','support'],
].map(([code,name,nature])=>({code,name,nature,keywords:[]}));
const rules=[
 {activity:'上厕所',group:'生活自理'},
 {activity:'拉屎',group:'生活自理'},
 {activity:'洗漱',group:'生活自理'},
 {activity:'休息',group:'清醒休息'},
 {activity:'刷手机',group:'娱乐'},
];

const mkSleep=(id,start,end,nap=false)=>({
 id,cycle_id:1,nap,score_state:'SCORED',start,end,
 score:{stage_summary:{
  total_light_sleep_time_milli:Math.floor((Date.parse(end)-Date.parse(start))*0.6),
  total_slow_wave_sleep_time_milli:Math.floor((Date.parse(end)-Date.parse(start))*0.2),
  total_rem_sleep_time_milli:Math.floor((Date.parse(end)-Date.parse(start))*0.15),
  total_awake_time_milli:Math.floor((Date.parse(end)-Date.parse(start))*0.05),
  total_no_data_time_milli:0,
 }},
});

async function row(sql,args=[]){return (await db.query(sql,args)).rows[0];}
async function rows(sql,args=[]){return (await db.query(sql,args)).rows;}
async function catId(name){
 return (await row("select id from public.categories where owner_id=$1 and kind='time' and is_active and name=$2",[owner,name])).id;
}
async function wechatApply(extId,text,clock,plan){
 const id=(await row("select public.ingest_input($1,'wechat',$2,$3,$4,'{}','record') id",[owner,extId,text,clock])).id;
 const input=await row("update public.raw_inputs set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=$1 returning *",[id]);
 const context=(await row('select public.get_steward_context($1) c',[owner])).c;
 const res=await row('select * from public.apply_steward($1,$2,$3,$4)',[id,input.lease_token,{time_entries:[],transactions:[],clarify:null,...plan},context.ongoing]);
 return {id,res};
}
async function undoAt(extId,clock){
 const id=(await row("select public.ingest_input($1,'wechat',$2,'撤销',$3,'{}','command') id",[owner,extId,clock])).id;
 const input=await row("update public.raw_inputs set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=$1 returning *",[id]);
 return row("select * from public.run_command($1,$2,'undo')",[id,input.lease_token]);
}
async function activeBetween(fromIso,toIso){
 return rows(`select t.start_at,t.end_at,t.duration_min,t.activity,c.name as cat,t.tags
  from public.time_entries t join public.categories c on c.id=t.category_id
  where t.deleted_at is null and t.start_at>=$1 and t.start_at<$2 order by t.start_at,t.id`,[fromIso,toIso]);
}

before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create schema auth;create table auth.users(id uuid primary key);grant usage on schema public,auth to anon,authenticated,service_role;
  create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
  create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
  insert into auth.users values('${owner}');`);
 const dir=new URL('../migrations/',import.meta.url);
 for(const file of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort()){
  await db.exec(await readFile(new URL(file,dir),'utf8'));
 }
 await row('select public.install_time_groups($1,$2,$3,$4,true)',[owner,hash,groups,rules]);
});
after(async()=>{await db?.close();});

test('睡眠前后≤4小时短空白自动补刷手机（复现11-09）且支持次日消息后到增量补齐',async()=>{
 await wechatApply('nov9-chat','22:07到00:14聊天','2026-11-09T00:15:00+08:00',{
  time_entries:[{start_at:'2026-11-08T22:07:00+08:00',end_at:'2026-11-09T00:14:00+08:00',category:'time-group-social',activity:'和荆通聊天',note:null}],
  time_events:[],
 });
 await db.query("insert into public.whoop_records(owner_id,kind,source_id,payload) values($1,'sleeps','sleep-nov9',$2)",[
  owner,mkSleep('sleep-nov9','2026-11-09T00:46:00+08:00','2026-11-09T07:25:00+08:00'),
 ]);
 // 07:30 首次同步时晨间尚未发消息：只补睡前 00:14-00:46，不补无界的睡后空白。
 const first=(await row('select public.reconcile_whoop_time($1) r',[owner])).r;
 assert.equal(first.applied,1);
 const beforeMorning=await activeBetween('2026-11-08T22:00:00+08:00','2026-11-09T12:00:00+08:00');
 assert.deepEqual(beforeMorning.map(x=>[x.activity,x.cat,x.duration_min]),[
  ['和荆通聊天','私人社交',127],
  ['刷手机','娱乐',32],
  ['睡眠','睡眠',379],
 ]);
 // 08:34 晨间消息到达后再次同步：增量补齐 07:25-08:34，不重删主睡眠。
 await wechatApply('nov9-morning','8:34-9:29去打印承诺书','2026-11-09T09:30:00+08:00',{
  time_entries:[{start_at:'2026-11-09T08:34:00+08:00',end_at:'2026-11-09T09:29:00+08:00',category:'time-group-work',activity:'去打印承诺书',note:null}],
  time_events:[],
 });
 const second=(await row('select public.reconcile_whoop_time($1) r',[owner])).r;
 assert.equal(second.applied,1);
 const full=await activeBetween('2026-11-08T22:00:00+08:00','2026-11-09T12:00:00+08:00');
 assert.deepEqual(full.map(x=>[x.activity,x.cat,x.duration_min]),[
  ['和荆通聊天','私人社交',127],
  ['刷手机','娱乐',32],
  ['睡眠','睡眠',379],
  ['刷手机','娱乐',69],
  ['去打印承诺书','工作',55],
 ]);
 assert.ok(full[1].tags.includes('whoop-gap-estimate'));
 assert.ok(full[3].tags.includes('whoop-gap-estimate'));
 // 再次运行幂等；人工软删 after-gap 后也不会复活。
 const third=(await row('select public.reconcile_whoop_time($1) r',[owner])).r;
 assert.equal(third.applied,0);assert.equal(third.unchanged,1);
 await db.query("update public.time_entries set deleted_at=now() where activity='刷手机' and start_at='2026-11-09T07:25:00+08:00'");
 const fourth=(await row('select public.reconcile_whoop_time($1) r',[owner])).r;
 assert.equal(fourth.applied,0);
 assert.equal((await activeBetween('2026-11-09T07:20:00+08:00','2026-11-09T08:30:00+08:00')).length,0);
});

test('超过4小时或小于1分钟的空白不自动补造刷手机',async()=>{
 await wechatApply('long-before','18:00-19:00吃饭','2026-11-10T19:05:00+08:00',{
  time_entries:[{start_at:'2026-11-10T18:00:00+08:00',end_at:'2026-11-10T19:00:00+08:00',category:'time-group-rest',activity:'吃饭',note:null}],
  time_events:[],
 });
 await wechatApply('long-after','12:30-13:00工作','2026-11-11T13:05:00+08:00',{
  time_entries:[{start_at:'2026-11-11T12:30:00+08:00',end_at:'2026-11-11T13:00:00+08:00',category:'time-group-work',activity:'工作',note:null}],
  time_events:[],
 });
 await db.query("insert into public.whoop_records(owner_id,kind,source_id,payload) values($1,'sleeps','sleep-longgap',$2)",[
  owner,mkSleep('sleep-longgap','2026-11-11T00:00:00+08:00','2026-11-11T07:00:00+08:00'),
 ]);
 await row('select public.reconcile_whoop_time($1)',[owner]);
 const list=await activeBetween('2026-11-10T18:00:00+08:00','2026-11-11T13:05:00+08:00');
 assert.deepEqual(list.map(x=>x.activity),['吃饭','睡眠','工作']);
});

test('跨夜洗漱未切休息：睡前保留洗漱，醒后自动转刷手机；睡中开始的活动不误改',async()=>{
 await wechatApply('wash-start','21:40洗漱','2026-11-14T21:40:00+08:00',{
  time_events:[{action:'switch',at:'2026-11-14T21:40:00+08:00',category:'time-group-selfcare',activity:'洗漱',note:null}],
 });
 await db.query("insert into public.whoop_records(owner_id,kind,source_id,payload) values($1,'sleeps','sleep-wash',$2)",[
  owner,mkSleep('sleep-wash','2026-11-14T23:30:00+08:00','2026-11-15T07:30:00+08:00'),
 ]);
 await row('select public.reconcile_whoop_time($1)',[owner]);
 await wechatApply('wash-morning','08:30开工','2026-11-15T08:30:00+08:00',{
  time_events:[{action:'switch',at:'2026-11-15T08:30:00+08:00',category:'time-group-work',activity:'写代码',note:null}],
 });
 const list=await activeBetween('2026-11-14T21:00:00+08:00','2026-11-15T09:00:00+08:00');
 assert.deepEqual(list.map(x=>[x.activity,x.cat,x.duration_min]),[
  ['洗漱','生活自理',110],
  ['睡眠','睡眠',456],
  ['刷手机','娱乐',60],
  ['写代码','工作',null],
 ]);
 // 停止进行中以便下个用例干净。
 await wechatApply('wash-stop','09:00停止','2026-11-15T09:00:00+08:00',{
  time_events:[{action:'stop',at:'2026-11-15T09:00:00+08:00',category:null,activity:null,note:null}],
 });
});

test('睡前上厕所跨夜（复现11-12/13）：前10分保留上厕所，余量转睡前刷手机，醒后亦转刷手机',async()=>{
 await wechatApply('night-toilet','23:27上厕所','2026-11-16T23:27:00+08:00',{
  time_events:[{action:'switch',at:'2026-11-16T23:27:00+08:00',category:'time-group-selfcare',activity:'上厕所',note:null}],
 });
 await db.query("insert into public.whoop_records(owner_id,kind,source_id,payload) values($1,'sleeps','sleep-toilet',$2)",[
  owner,mkSleep('sleep-toilet','2026-11-17T00:04:00+08:00','2026-11-17T06:54:00+08:00'),
 ]);
 await row('select public.reconcile_whoop_time($1)',[owner]);
 await wechatApply('night-toilet-wake','08:00吃早饭','2026-11-17T08:00:00+08:00',{
  time_events:[{action:'switch',at:'2026-11-17T08:00:00+08:00',category:'time-group-work',activity:'工作',note:null}],
 });
 const list=await activeBetween('2026-11-16T23:00:00+08:00','2026-11-17T08:30:00+08:00');
 assert.deepEqual(list.map(x=>[x.activity,x.cat,x.duration_min]),[
  ['上厕所','生活自理',10],
  ['刷手机','娱乐',27],
  ['睡眠','睡眠',389],
  ['刷手机','娱乐',66],
  ['工作','工作',null],
 ]);
 assert.ok(list[1].tags.includes('toilet-auto-rest'));
 await wechatApply('night-toilet-stop','08:30停止','2026-11-17T08:30:00+08:00',{
  time_events:[{action:'stop',at:'2026-11-17T08:30:00+08:00',category:null,activity:null,note:null}],
 });
});

test('白天上厕所超10分钟未点结束：自动截断10分钟并补休息，回执可见且撤销原子恢复',async()=>{
 await wechatApply('day-toilet','08:51拉屎','2026-11-19T08:51:00+08:00',{
  time_events:[{action:'switch',at:'2026-11-19T08:51:00+08:00',category:'time-group-selfcare',activity:'拉屎',note:null}],
 });
 const switched=await wechatApply('day-wash','9:58洗漱','2026-11-19T09:58:00+08:00',{
  time_events:[{action:'switch',at:'2026-11-19T09:58:00+08:00',category:'time-group-selfcare',activity:'洗漱',note:null}],
 });
 const list=await activeBetween('2026-11-19T08:50:00+08:00','2026-11-19T10:05:00+08:00');
 assert.deepEqual(list.map(x=>[x.activity,x.cat,x.duration_min]),[
  ['拉屎','生活自理',10],
  ['休息','清醒休息',57],
  ['洗漱','生活自理',null],
 ]);
 assert.ok(list[1].tags.includes('toilet-auto-rest'));
 // 回执快照完整包含三段。
 const snapshot=(await row('select public.get_input_records($1) s',[switched.id])).s;
 assert.deepEqual(snapshot.time_entries.map(x=>[x.activity,x.duration_min]),[['拉屎',10],['休息',57],['洗漱',null]]);
 // 撤销：删除休息与洗漱，并恢复 08:51 拉屎为进行中。
 await undoAt('day-undo','2026-11-19T09:59:00+08:00');
 const afterUndo=await activeBetween('2026-11-19T08:50:00+08:00','2026-11-19T10:05:00+08:00');
 assert.deepEqual(afterUndo.map(x=>[x.activity,x.duration_min]),[['拉屎',null]]);
 // 用明确结束话语（13分钟“拉完屎”）则尊重本人明示事实，不截断。
 await wechatApply('day-explicit','09:04拉完屎开始工作','2026-11-19T09:04:00+08:00',{
  time_events:[{action:'switch',at:'2026-11-19T09:04:00+08:00',category:'time-group-work',activity:'工作',note:null}],
 });
 const afterExplicit=await activeBetween('2026-11-19T08:50:00+08:00','2026-11-19T10:05:00+08:00');
 assert.deepEqual(afterExplicit.map(x=>[x.activity,x.duration_min]),[['拉屎',13],['工作',null]]);
 await wechatApply('day-stop','09:10停止','2026-11-19T09:10:00+08:00',{
  time_events:[{action:'stop',at:'2026-11-19T09:10:00+08:00',category:null,activity:null,note:null}],
 });
});

test('闭合补录与停止计时触发如厕10分封顶；复合活动拉屎洗漱不截断',async()=>{
 await wechatApply('t-entry-start','14:00上厕所','2026-11-20T14:00:00+08:00',{
  time_events:[{action:'switch',at:'2026-11-20T14:00:00+08:00',category:'time-group-selfcare',activity:'上厕所',note:null}],
 });
 await wechatApply('t-entry-next','14:30到15:00写文案','2026-11-20T15:01:00+08:00',{
  time_entries:[{start_at:'2026-11-20T14:30:00+08:00',end_at:'2026-11-20T15:00:00+08:00',category:'time-group-work',activity:'写文案',note:null}],
  time_events:[],
 });
 const list1=await activeBetween('2026-11-20T14:00:00+08:00','2026-11-20T15:05:00+08:00');
 assert.deepEqual(list1.map(x=>[x.activity,x.duration_min]),[['上厕所',10],['休息',20],['写文案',30]]);
 // 复合活动“拉屎洗漱”持续 20 分钟不截断。
 await wechatApply('t-combo-start','16:00拉屎洗漱','2026-11-20T16:00:00+08:00',{
  time_events:[{action:'switch',at:'2026-11-20T16:00:00+08:00',category:'time-group-selfcare',activity:'拉屎洗漱',note:null}],
 });
 await wechatApply('t-combo-stop','16:20停止','2026-11-20T16:20:00+08:00',{
  time_events:[{action:'stop',at:'2026-11-20T16:20:00+08:00',category:null,activity:null,note:null}],
 });
 const list2=await activeBetween('2026-11-20T16:00:00+08:00','2026-11-20T16:25:00+08:00');
 assert.deepEqual(list2.map(x=>[x.activity,x.duration_min]),[['拉屎洗漱',20]]);
});

test('旧v1校准记录安全升级至v2：跨夜洗漱醒后改刷手机且保留晨间闭合点',async()=>{
 const washCat=await catId('生活自理');
 const sleepCat=await catId('睡眠');
 const origRaw=(await row("select public.ingest_input($1,'wechat','v1-wash','22:00洗漱','2026-11-22T22:00:00+08:00','{}','record') id",[owner])).id;
 const orig=await row("insert into public.time_entries(raw_input_id,item_index,start_at,end_at,category_id,activity) values($1,0,'2026-11-22T22:00:00+08:00',null,$2,'洗漱') returning id,to_jsonb(time_entries.*) as raw",[origRaw,washCat]);
 const savedOrig=JSON.stringify([orig.raw]);
 await db.query('update public.time_entries set deleted_at=now() where id=$1',[orig.id]);
 const sPayload=mkSleep('sleep-v1','2026-11-22T23:30:00+08:00','2026-11-23T06:30:00+08:00');
 await db.query("insert into public.whoop_records(owner_id,kind,source_id,payload) values($1,'sleeps','sleep-v1',$2)",[owner,sPayload]);
 const wRaw=(await row("insert into public.raw_inputs(owner_id,source,external_id,text,received_at,payload,input_kind,status,receipt_text,delivered_at) values($1,'whoop','sleep:v1','WHOOP睡眠校准','2026-11-23T06:30:00+08:00','{}','import','parsed','ok',now()) returning id",[owner])).id;
 const sRow=await row("insert into public.time_entries(raw_input_id,item_index,start_at,end_at,category_id,activity,tags) values($1,0,'2026-11-22T23:30:00+08:00','2026-11-23T06:30:00+08:00',$2,'睡眠',array['whoop-sleep']) returning id,revision,to_jsonb(time_entries.*) as raw",[wRaw,sleepCat]);
 const bRow=await row("insert into public.time_entries(raw_input_id,item_index,start_at,end_at,category_id,activity,tags) values($1,1,'2026-11-22T22:00:00+08:00','2026-11-22T23:30:00+08:00',$2,'洗漱',array['whoop-boundary-fragment']) returning id,revision,to_jsonb(time_entries.*) as raw",[wRaw,washCat]);
 const aRow=await row("insert into public.time_entries(raw_input_id,item_index,start_at,end_at,category_id,activity,tags) values($1,2,'2026-11-23T06:30:00+08:00',null,$2,'洗漱',array['whoop-boundary-fragment']) returning id,revision,to_jsonb(time_entries.*) as raw",[wRaw,washCat]);
 const payloadHash=(await row("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') h",[JSON.stringify(sPayload)])).h;
 await db.query(`insert into public.time_sleep_alignments(owner_id,sleep_id,payload_hash,status,start_at,end_at,asleep_millis,awake_millis,no_data_millis,originals,generated,rule_version)
  values($1,'sleep-v1',$2,'applied','2026-11-22T23:30:00+08:00','2026-11-23T06:30:00+08:00',20000000,1000000,0,$3::jsonb,$4::jsonb,1)`,[
  owner,payloadHash,savedOrig,JSON.stringify([
   {id:sRow.id,revision:sRow.revision,role:'sleep',baseline:sRow.raw},
   {id:bRow.id,revision:bRow.revision,role:'before',sourceId:orig.id,baseline:bRow.raw},
   {id:aRow.id,revision:aRow.revision,role:'after',sourceId:orig.id,baseline:aRow.raw},
  ]),
 ]);
 // 模拟晨间切换闭合了 v1 的 after 段。
 await db.query("update public.time_entries set end_at='2026-11-23T07:20:00+08:00' where id=$1",[aRow.id]);
 const res=(await row('select public.reconcile_whoop_time($1) r',[owner])).r;
 assert.equal(res.applied,1);assert.equal(res.conflicts,0);
 const list=await activeBetween('2026-11-22T22:00:00+08:00','2026-11-23T08:00:00+08:00');
 assert.deepEqual(list.map(x=>[x.activity,x.cat,x.duration_min]),[
  ['洗漱','生活自理',90],
  ['睡眠','睡眠',399],
  ['刷手机','娱乐',50],
 ]);
 assert.equal((await row("select rule_version from public.time_sleep_alignments where sleep_id='sleep-v1'")).rule_version,2);
});

test('辅助函数仅限service_role执行，authenticated与anon无权调用',async()=>{
 for(const role of ['anon','authenticated']){
  await db.query(`set role ${role}`);
  await assert.rejects(db.query("select public.is_toilet_activity('上厕所')"),{code:'42501'});
  await assert.rejects(db.query("select public.has_explicit_toilet_end('拉完屎')"),{code:'42501'});
  await assert.rejects(db.query('select public.resolve_rest_category($1)',[owner]),{code:'42501'});
  await db.query('reset role');
 }
});
