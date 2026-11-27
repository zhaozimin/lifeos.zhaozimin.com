/**
 * [INPUT]: 全部迁移、大类策略夹具、WHOOP睡眠计划与模拟微信记录。
 * [OUTPUT]: 纠错空替换字段回归、昨日时间轴异常巡检、合体晨间推送与对话上下文可见性证据。
 * [POS]: 0033 晨间巡检与纠错加固的隔离 PostgreSQL 事务测试，不连接生产项目。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

let db;
const owner='11111111-1111-4111-8111-111111111111';
const hash='c'.repeat(64);
const groups=[
  ['time-group-work','工作','core'],
  ['time-group-selfcare','生活自理','support'],
  ['time-group-meal','饮食','support'],
  ['time-group-sleep','睡眠','recovery'],
  ['time-group-entertainment','娱乐','leisure'],
  ['time-group-rest','清醒休息','recovery'],
  ['uncategorized','待确认','support'],
].map(([code,name,nature])=>({code,name,nature,keywords:[]}));
const rules=[
  {activity:'洗漱',group:'生活自理'},
  {activity:'洗澡',group:'生活自理'},
  {activity:'吃饭',group:'饮食'},
  {activity:'吃午饭',group:'饮食'},
  {activity:'睡眠',group:'睡眠'},
  {activity:'写代码',group:'工作'},
  {activity:'录制视频',group:'工作'},
  {activity:'剪视频',group:'工作'},
  {activity:'写稿',group:'工作'},
  {activity:'刷手机',group:'娱乐'},
  {activity:'休息',group:'清醒休息'},
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
async function catId(name){
  return (await row("select id from public.categories where owner_id=$1 and kind='time' and is_active and name=$2",[owner,name])).id;
}
async function clearEntries(){
  await db.exec("delete from public.time_entries; delete from public.time_sleep_alignments; delete from public.whoop_records; delete from public.whoop_plans; delete from public.whoop_publications; update public.raw_inputs set revoked_at=now() where revoked_at is null;");
}
async function insertEntry(extId,receivedAt,startAt,endAt,categoryName,activity,tags=[]){
  const rawId=(await row(
    "insert into public.raw_inputs(owner_id,source,external_id,text,received_at,payload,input_kind,status) values($1,'wechat',$2,$3,$4,'{\"from_user_id\":\"u1\",\"context_token\":\"ctx1\"}','record','parsed') returning id",
    [owner,extId,activity,receivedAt],
  )).id;
  const cid=await catId(categoryName);
  await row(
    'insert into public.time_entries(raw_input_id,item_index,start_at,end_at,category_id,activity,tags) values($1,0,$2,$3,$4,$5,$6)',
    [rawId,startAt,endAt,cid,activity,tags],
  );
  return rawId;
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

test('apply_time_corrections 容忍空 time_replacements，不再抛出 invalid steward plan',async()=>{
  await clearEntries();
  await insertEntry('wx:open','2026-11-26T03:02:00Z','2026-11-26T03:02:00Z',null,'工作','整理课件');
  const id=(await row("select public.ingest_input($1,'wechat','wx:fix','11:02，洗漱','2026-11-26T03:02:30Z','{\"from_user_id\":\"u1\",\"context_token\":\"ctx1\"}','record') id",[owner])).id;
  const leased=await row("update public.raw_inputs set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=$1 returning *",[id]);
  const req=[{target:{position:'current'},patch:{activity:'洗漱',category:'time-group-selfcare'}}];
  const targets=(await row('select public.find_time_correction_targets($1,$2) t',[id,JSON.stringify(req)])).t;
  const saved=await row('select * from public.apply_time_corrections($1,$2,$3,$4,$5)',[
    id,leased.lease_token,
    JSON.stringify({time_entries:[],transactions:[],clarify:null,time_replacements:[],time_corrections:req}),
    JSON.stringify(targets),null,
  ]);
  assert.equal(saved.status,'parsed');
  const entry=await row('select activity from public.time_entries where deleted_at is null');
  assert.equal(entry.activity,'洗漱');

  // 非空 time_replacements 与 time_corrections 混用时仍明确中文拒绝。
  const id2=(await row("select public.ingest_input($1,'wechat','wx:mix','混用','2026-11-26T03:05:00Z','{}','record') id",[owner])).id;
  const leased2=await row("update public.raw_inputs set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=$1 returning *",[id2]);
  const rejected=await row('select * from public.apply_time_corrections($1,$2,$3,$4,$5)',[
    id2,leased2.lease_token,
    JSON.stringify({
      time_entries:[],transactions:[],clarify:null,time_corrections:req,
      time_replacements:[{start_at:'2026-11-26T02:00:00Z',end_at:'2026-11-26T02:30:00Z',activity:'写作',category:'time-group-work'}],
    }),
    JSON.stringify(targets),null,
  ]);
  assert.equal(rejected.status,'awaiting_clarification');
  assert.match(rejected.clarification_prompt,/分开发送/);
});

test('昨日完整闭合且活动未超阈值时，晨间核对报告零异常',async()=>{
  await clearEntries();
  // 2026-11-25 00:00+08:00 至 2026-11-26 07:30+08:00 完全连续，且洗漱35分、洗澡50分、吃饭90分均踩线不超。
  await insertEntry('wx:2','2026-11-25T08:35:00+08:00','2026-11-25T08:00:00+08:00','2026-11-25T08:35:00+08:00','生活自理','洗漱');
  await insertEntry('wx:3','2026-11-25T12:00:00+08:00','2026-11-25T08:35:00+08:00','2026-11-25T12:00:00+08:00','工作','写代码');
  await insertEntry('wx:4','2026-11-25T13:30:00+08:00','2026-11-25T12:00:00+08:00','2026-11-25T13:30:00+08:00','饮食','吃午饭');
  await insertEntry('wx:5','2026-11-25T22:00:00+08:00','2026-11-25T13:30:00+08:00','2026-11-25T22:00:00+08:00','工作','录制视频');
  await insertEntry('wx:6','2026-11-25T22:50:00+08:00','2026-11-25T22:00:00+08:00','2026-11-25T22:50:00+08:00','生活自理','洗澡');
  await insertEntry('wx:7','2026-11-25T23:30:00+08:00','2026-11-25T22:50:00+08:00','2026-11-25T23:30:00+08:00','娱乐','刷手机');
  // 前夜与昨夜均走真实 WHOOP 睡眠校准。
  await row("insert into public.whoop_records(owner_id,kind,source_id,payload) values($1,'sleeps','sleep-prev',$2)",[
    owner,JSON.stringify(mkSleep('sleep-prev','2026-11-24T23:30:00+08:00','2026-11-25T08:00:00+08:00',false)),
  ]);
  await row("insert into public.whoop_records(owner_id,kind,source_id,payload) values($1,'sleeps','sleep-last',$2)",[
    owner,JSON.stringify(mkSleep('sleep-last','2026-11-25T23:30:00+08:00','2026-11-26T07:30:00+08:00',false)),
  ]);
  await row('select public.reconcile_whoop_time($1)',[owner]);

  const audit=(await row("select public.get_morning_time_audit($1,'2026-11-26','Asia/Shanghai','2026-11-26T08:00:00+08:00') a",[owner])).a;
  assert.equal(audit.issue_count,0);
  assert.match(audit.text,/已完整闭合，无空白或超时异常/);
});

test('跨时间洗漱被WHOOP入睡截断、超阈值活动、1分钟空白与未收尾项全部精准检出且不重复',async()=>{
  await clearEntries();
  // 白天连续记录，但洗漱 36m、洗澡 51m、吃饭 91m，且 14:20-14:21 有 1 分钟空白。
  await insertEntry('wx:d1','2026-11-25T08:36:00+08:00','2026-11-25T08:00:00+08:00','2026-11-25T08:36:00+08:00','生活自理','洗漱');
  await insertEntry('wx:d2','2026-11-25T12:00:00+08:00','2026-11-25T08:36:00+08:00','2026-11-25T12:00:00+08:00','工作','写代码');
  await insertEntry('wx:d3','2026-11-25T13:31:00+08:00','2026-11-25T12:00:00+08:00','2026-11-25T13:31:00+08:00','饮食','吃饭');
  await insertEntry('wx:d4','2026-11-25T14:20:00+08:00','2026-11-25T13:31:00+08:00','2026-11-25T14:20:00+08:00','工作','剪视频');
  // 14:20-14:21 空白 1 分钟
  await insertEntry('wx:d5','2026-11-25T22:00:00+08:00','2026-11-25T14:21:00+08:00','2026-11-25T22:00:00+08:00','工作','写稿');
  await insertEntry('wx:d6','2026-11-25T22:51:00+08:00','2026-11-25T22:00:00+08:00','2026-11-25T22:51:00+08:00','生活自理','洗澡');
  await insertEntry('wx:d7','2026-11-25T23:10:00+08:00','2026-11-25T22:51:00+08:00','2026-11-25T23:10:00+08:00','待确认','杂事');
  // 睡前 23:10 洗漱未点结束，跨夜至 WHOOP 入睡 01:25。
  await insertEntry('wx:d8','2026-11-25T23:10:00+08:00','2026-11-25T23:10:00+08:00',null,'生活自理','洗漱');
  // 昨日一条挂起追问。
  await row(
    "insert into public.raw_inputs(owner_id,source,external_id,text,received_at,payload,input_kind,status,clarification_prompt) values($1,'wechat','wx:clarify','花了35元','2026-11-25T18:40:00+08:00','{}','record','awaiting_clarification','哪个账户？')",
    [owner],
  );
  // 写入前夜与昨夜 WHOOP 睡眠并执行校准。
  await row("insert into public.whoop_records(owner_id,kind,source_id,payload) values($1,'sleeps','sleep-prev-2',$2)",[
    owner,JSON.stringify(mkSleep('sleep-prev-2','2026-11-24T23:30:00+08:00','2026-11-25T08:00:00+08:00',false)),
  ]);
  const sleep=mkSleep('sleep-night-1','2026-11-26T01:25:00+08:00','2026-11-26T07:30:00+08:00',false);
  await row("insert into public.whoop_records(owner_id,kind,source_id,payload) values($1,'sleeps','sleep-night-1',$2)",[owner,JSON.stringify(sleep)]);
  await row('select public.reconcile_whoop_time($1)',[owner]);

  const audit=(await row("select public.get_morning_time_audit($1,'2026-11-26','Asia/Shanghai','2026-11-26T08:00:00+08:00') a",[owner])).a;
  const kinds=audit.items.map(x=>x.kind);
  assert.equal(kinds.filter(k=>k==='pre_sleep_unclosed').length,1);
  assert.equal(kinds.filter(k=>k==='overlong_activity').length,3); // 仅白天3条，跨夜洗漱不重复报
  assert.equal(kinds.filter(k=>k==='gap').length,1);
  assert.equal(kinds.filter(k=>k==='pending_clarification').length,1);
  assert.equal(kinds.filter(k=>k==='uncategorized').length,1);
  assert.match(audit.text,/睡前未闭合（跨夜）：23:10–次日01:25 洗漱（135分钟，至入睡前未结束）/);
  assert.match(audit.text,/洗漱超过35分钟/);
  assert.match(audit.text,/洗澡超过50分钟/);
  assert.match(audit.text,/吃饭超过90分钟/);
  assert.match(audit.text,/记录空白：14:20–14:21（1分钟未记录）/);
  assert.match(audit.text,/未处理追问：18:40「花了35元」/);
  assert.match(audit.text,/待确认分类：22:51–23:10 杂事/);
});

test('合体晨间推送与微信对话闭环：同一条消息含WHOOP计划与昨日核对，且投递后进入最近对话',async()=>{
  await clearEntries();
  const nowRow=await row("select (now() at time zone 'Asia/Shanghai')::date as d, (now() at time zone 'Asia/Shanghai')::time as t");
  const today=nowRow.d.toISOString().slice(0,10);
  // 写入一条24h内微信上下文消息。
  await row(
    "insert into public.raw_inputs(owner_id,source,external_id,text,received_at,payload,input_kind,status) values($1,'wechat','wx:ctx','早安',now()-interval '1 hour','{\"from_user_id\":\"u1\",\"context_token\":\"ctx-fresh\"}','record','parsed')",
    [owner],
  );
  // 准备已发布的今日 WHOOP 计划并确保 reportTime 允许当前时间（若当前在上海16点后则直接测 get_recent_dialogue 闭环）。
  await row(
    "insert into public.whoop_publications(owner_id,key,value) values($1,'status','{\"settings\":{\"reportTime\":\"00:00\"}}')",
    [owner],
  );
  await row(
    "insert into public.whoop_plans(owner_id,target_date,time_zone,revision,payload) values($1,$2,'Asia/Shanghai',1,'{\"publication\":{\"state\":\"published\"}}')",
    [owner,today],
  );
  const enq=(await row("select public.enqueue_whoop_morning($1,$2,'Asia/Shanghai',1,$3) r",[
    owner,today,`${today} 今日运动计划\n恢复 80% · 睡眠 7.5小时`,
  ])).r;

  let morningRow;
  if (enq.queued) {
    morningRow=await row("select * from public.raw_inputs where owner_id=$1 and source='system' and external_id=$2",[owner,`health:morning:${today}:Asia/Shanghai`]);
    assert.match(morningRow.receipt_text,/今日运动计划/);
    assert.match(morningRow.receipt_text,/昨日时间轴核对/);
    assert.ok(morningRow.parse_result.audit);
    assert.ok(morningRow.reply_expires_at);
  } else {
    // 若测试运行在上海时间 >= 16:00，窗口外属预期行为；手插一条等价晨报验证对话闭环。
    assert.equal(enq.reason,'outside_window_or_waiting');
    morningRow=await row(
      "insert into public.raw_inputs(owner_id,source,external_id,text,received_at,payload,input_kind,status,parse_result,receipt_text) values($1,'system',$2,'晨间运动计划与昨日时间核对',now()-interval '10 minutes','{\"from_user_id\":\"u1\",\"context_token\":\"ctx-fresh\"}','command','parsed','{\"command\":\"health\"}',$3) returning *",
      [owner,`health:morning:${today}:Asia/Shanghai`,'今日运动计划\n\n昨日时间轴核对\n1. 记录空白：14:20–15:00（40分钟未记录）'],
    );
  }

  // 新发一条微信回复，先验证未投递的晨报不会进入对话，投递后立刻可见。
  const replyInput=await row(
    "insert into public.raw_inputs(owner_id,source,external_id,text,received_at,payload,input_kind,status) values($1,'wechat','wx:reply1','1 是在午休',now()+interval '1 minute','{}','record','pending') returning id",
    [owner],
  );
  const beforeDelivery=(await row('select public.get_recent_dialogue($1) d',[replyInput.id])).d;
  assert.equal(beforeDelivery.some(x=>x.reply?.includes('昨日时间轴核对')),false);

  await row('update public.raw_inputs set delivered_at=now() where id=$1',[morningRow.id]);
  const afterDelivery=(await row('select public.get_recent_dialogue($1) d',[replyInput.id])).d;
  assert.equal(afterDelivery.some(x=>x.reply?.includes('昨日时间轴核对')),true);
});

test('权限边界：anon 与 authenticated 无权调用巡检与晨间入队函数',async()=>{
  for(const role of ['anon','authenticated']){
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(db.query("select public.get_morning_time_audit($1,'2026-11-26')",[owner]),/permission denied/);
      await assert.rejects(db.query("select public.enqueue_whoop_morning($1,'2026-11-26','Asia/Shanghai',1,'x')",[owner]),/permission denied/);
    } finally {
      await db.exec('reset role');
    }
  }
});
