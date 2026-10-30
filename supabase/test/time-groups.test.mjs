/**
 * [INPUT]: 全部迁移、本人分类夹具与合成WHOOP睡眠。
 * [OUTPUT]: 大类应用、设备时长、手机首尾、幂等、校正及权限证据。
 * [POS]: 分类与生理时间交汇的事务回归，不连接生产项目。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db,originalId;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const hash='a'.repeat(64);
const groups=[['time-group-work','工作','core'],['time-group-sleep','睡眠','recovery'],['time-group-entertainment','娱乐','leisure'],
 ['time-group-rest','清醒休息','recovery'],['uncategorized','待确认','support']].map(([code,name,nature])=>({code,name,nature,keywords:[]}));
const rules=[{activity:'剪辑视频',group:'工作'},{activity:'睡觉',group:'睡眠'},{activity:'休息一下',group:'清醒休息'},{activity:'休息一会儿',group:'娱乐'}];
const sleep={id:'sleep-night',cycle_id:1,nap:false,score_state:'SCORED',start:'2026-10-19T16:00:00Z',end:'2026-10-20T00:00:00Z',
 score:{stage_summary:{total_light_sleep_time_milli:4*3600000,total_slow_wave_sleep_time_milli:2*3600000,
  total_rem_sleep_time_milli:3600000,total_awake_time_milli:3600000,total_no_data_time_milli:0}}};
async function row(sql,args=[]){return (await db.query(sql,args)).rows[0];}
async function category(name){return (await row("select id from public.categories where owner_id=$1 and kind='time' and is_active and name=$2",[owner,name])).id;}
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);grant usage on schema public,auth to anon,authenticated,service_role;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 insert into auth.users values('${owner}'),('${other}');`);
 const dir=new URL('../migrations/',import.meta.url);for(const file of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
 await db.query("insert into public.categories(owner_id,kind,code,name,nature) values($1,'time','uncategorized','旧未分类','support'),($1,'time','old-sleep','旧睡眠','recovery')",[owner]);
 const raw=(await row("select public.ingest_input($1,'wechat','bedtime','22点睡觉，9点起床','2026-10-20T01:00:00Z','{}','record') id",[owner])).id;
 originalId=(await row("insert into public.time_entries(raw_input_id,item_index,start_at,end_at,category_id,activity) values($1,0,'2026-10-19T14:00:00Z','2026-10-20T01:00:00Z',(select id from public.categories where code='old-sleep'),'睡觉') returning id",[raw])).id;
 await db.query("insert into public.whoop_records(owner_id,kind,source_id,payload) values($1,'sleeps','sleep-night',$2)",[owner,sleep]);
});
after(async()=>{await db?.close();});

test('只填大类即可应用；WHOOP实际7小时，首尾3小时手机，原话与原段完整保留',async()=>{
 const entries=[{id:originalId,revision:1,activity:'睡觉',group:'睡眠'}];
 const result=(await row('select public.apply_time_group_review($1,$2,$3,$4,$5,true) result',[owner,hash,groups,rules,entries])).result;
 assert.equal(result.records,1);assert.equal(result.sleep.applied,1);
 const list=(await db.query(`select t.*,c.name from public.time_entries t join public.categories c on c.id=t.category_id where t.deleted_at is null order by start_at`)).rows;
 assert.deepEqual(list.map(r=>[r.activity,r.name,r.duration_min]),[['刷手机','娱乐',120],['睡眠','睡眠',420],['刷手机','娱乐',60]]);
 assert.equal(list[1].duration_min,420);assert.equal(list[1].deduction_minutes,60);
 assert.equal((await row('select activity,deleted_at from public.time_entries where id=$1',[originalId])).activity,'睡觉');
 assert.ok((await row('select deleted_at from public.time_entries where id=$1',[originalId])).deleted_at);
 assert.equal((await row("select text from public.raw_inputs where external_id='bedtime'")).text,'22点睡觉，9点起床');
 assert.equal((await row('select count(*)::int n from public.categories where is_active')).n,5);
});
test('重复同步不重复记录、修改版本或原话',async()=>{
 const before=await row('select (select count(*) from public.time_entries) t,(select count(*) from public.raw_inputs) r,(select count(*) from public.record_changes) c');
 const result=(await row('select public.reconcile_whoop_time($1) result',[owner])).result;assert.equal(result.unchanged,1);assert.equal(result.applied,0);
 assert.deepEqual(await row('select (select count(*) from public.time_entries) t,(select count(*) from public.raw_inputs) r,(select count(*) from public.record_changes) c'),before);
});
test('按本人习惯精确区分休息用语，手报睡眠先等待设备评分',async()=>{
 for(const [i,title,expected] of [[1,'休息一下','清醒休息'],[2,'休息一会儿','娱乐'],[3,'剪辑视频','工作'],[4,'睡觉','待确认']]){
  const raw=(await row("select public.ingest_input($1,'wechat',$2,$3,'2026-10-21T01:00:00Z','{}','record') id",[owner,'exact:'+i,title])).id;
  const saved=await row("insert into public.time_entries(raw_input_id,item_index,start_at,end_at,category_id,activity) values($1,0,'2026-10-21T01:00:00Z','2026-10-21T01:10:00Z',$2,$3) returning category_id,tags",[raw,await category('待确认'),title]);
  assert.equal((await row('select name from public.categories where id=$1',[saved.category_id])).name,expected);
  if(title==='睡觉')assert.ok(saved.tags.includes('whoop-pending'));
 }
});
test('WHOOP修订可重新校准；主睡眠时间禁止网页覆盖',async()=>{
 const revised={...sleep,start:'2026-10-19T16:30:00Z',updated_at:'revision-2',score:{stage_summary:{...sleep.score.stage_summary,total_awake_time_milli:1800000}}};
 await db.query("update public.whoop_records set payload=$1 where source_id='sleep-night'",[revised]);
 const result=(await row('select public.reconcile_whoop_time($1) result',[owner])).result;assert.equal(result.applied,1);assert.equal(result.conflicts,0);
 const main=await row("select * from public.time_entries where deleted_at is null and activity='睡眠'");
 assert.equal(Date.parse(main.start_at),Date.parse(revised.start));assert.equal(main.deduction_minutes,30);
 await assert.rejects(db.query("update public.time_entries set end_at=end_at+interval '1 hour' where id=$1",[main.id]),{code:'22023'});
});
test('后续人工事实发生变化时保留修改并标记冲突，不覆盖用户数据',async()=>{
 const phone=await row("select id from public.time_entries where deleted_at is null and activity='刷手机' order by start_at desc limit 1");
 await db.query("update public.time_entries set note='本人补充事实' where id=$1",[phone.id]);
 await db.query("update public.whoop_records set payload=jsonb_set(payload,'{updated_at}','\"revision-3\"') where source_id='sleep-night'");
 const result=(await row('select public.reconcile_whoop_time($1) result',[owner])).result;assert.equal(result.conflicts,1);
 assert.equal((await row('select note from public.time_entries where id=$1',[phone.id])).note,'本人补充事实');
});
test('午睡同样读取WHOOP评分；无评分不伪造睡眠或手机',async()=>{
 const nap={...sleep,id:'sleep-nap',cycle_id:2,nap:true,start:'2026-10-22T05:00:00Z',end:'2026-10-22T05:30:00Z',
  score:{stage_summary:{total_light_sleep_time_milli:20*60000,total_slow_wave_sleep_time_milli:0,total_rem_sleep_time_milli:5*60000,total_awake_time_milli:5*60000,total_no_data_time_milli:0}}};
 await db.query("insert into public.whoop_records(owner_id,kind,source_id,payload) values($1,'sleeps','sleep-nap',$2),($1,'sleeps','pending',$3)",[owner,nap,{...nap,id:'pending',score_state:'PENDING_SCORE'}]);
 const result=(await row('select public.reconcile_whoop_time($1) result',[owner])).result;assert.equal(result.applied,1);
 const main=await row("select * from public.time_entries where deleted_at is null and tags@>array['whoop-nap']");assert.equal(main.duration_min,25);
 assert.equal((await row("select count(*)::int n from public.time_sleep_alignments where sleep_id='pending'")).n,0);
});
test('本人AAL2可读规则，异主与AAL1不可读，安装和校准仅服务端执行',async()=>{
 for(const [person,aal,n] of [[owner,'aal2',4],[owner,'aal1',0],[other,'aal2',0]]){
  await db.query('set role authenticated');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:person,aal})]);
  assert.equal((await row('select count(*)::int n from public.time_group_rules')).n,n);
  await assert.rejects(db.query('select public.reconcile_whoop_time($1)',[owner]),{code:'42501'});await db.query('reset role');
 }
});

test('反复说睡觉延续待校准原段；正常晨间切换不阻止后续WHOOP修订',async()=>{
 const execute=async(text,clock,action,activity=null,category=null)=>{
  const id=(await row("select public.ingest_input($1,'wechat',$2,$3,$4,'{}','record') id",[owner,text+clock,text,clock])).id;
  const input=await row("update public.raw_inputs set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=$1 returning *",[id]);
  const context=(await row('select public.get_steward_context($1) c',[owner])).c;
  return row('select * from public.apply_steward($1,$2,$3,$4)',[id,input.lease_token,{time_entries:[],transactions:[],clarify:null,
   time_events:[{action,at:clock,activity,category,note:null}]},context.ongoing]);
 };
 await execute('睡觉','2026-10-23T14:00:00Z','switch','睡觉','time-group-sleep');
 const first=await row('select * from public.time_entries where deleted_at is null and end_at is null');
 await execute('还是睡觉','2026-10-23T14:05:00Z','switch','睡觉','time-group-sleep');
 assert.equal((await row('select * from public.time_entries where deleted_at is null and end_at is null')).id,first.id);
 const fresh={...sleep,id:'open-night',cycle_id:3,start:'2026-10-23T16:00:00Z',end:'2026-10-24T00:00:00Z'};
 await db.query("insert into public.whoop_records values($1,'sleeps','open-night',$2,now())",[owner,fresh]);
 await row('select public.reconcile_whoop_time($1)',[owner]);
 await execute('现在开工','2026-10-24T01:00:00Z','switch','剪辑视频','time-group-work');
 await db.query("update public.whoop_records set payload=jsonb_set(payload,'{updated_at}','\"revised\"') where source_id='open-night'");
 const result=(await row('select public.reconcile_whoop_time($1) r',[owner])).r;assert.equal(result.applied,1);
 const tail=await row("select t.* from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id where r.payload->>'sleep_id'='open-night' and t.activity='刷手机' and t.start_at='2026-10-24T00:00:00Z' and t.deleted_at is null");
 assert.equal(Date.parse(tail.end_at),Date.parse('2026-10-24T01:00:00Z'));
 assert.equal((await row('select count(*)::int n from public.time_entries where deleted_at is null and end_at is null')).n,1);
});

test('睡眠卡片按醒来日期汇总WHOOP评分，含午睡，AAL1不得读取',async()=>{
 await db.query('set role authenticated');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner,aal:'aal2'})]);
 const result=(await row("select public.get_time_sleep_summary('2026-10-20','2026-10-20') r")).r;
 assert.equal(result.nights,1);assert.equal(result.sleepMinutes,420);
 assert.equal(result.conflicts,1,JSON.stringify({result,alignments:(await db.query('select sleep_id,status,reason from public.time_sleep_alignments')).rows}));
 const nap=(await row("select public.get_time_sleep_summary('2026-10-22','2026-10-22') r")).r;assert.equal(nap.naps,1);assert.equal(nap.sleepMinutes,25);
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner,aal:'aal1'})]);
 await assert.rejects(db.query("select public.get_time_sleep_summary('2026-10-20','2026-10-20')"),{code:'42501'});await db.query('reset role');
});
