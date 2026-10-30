/**
 * [INPUT]: 生产迁移、固定北京时间及临时PostgreSQL。
 * [OUTPUT]: 提醒去重、绑定隔离、重试和服务身份权限证据。
 * [POS]: 微信提醒事务验收；只用合成订阅，不连接生产库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const at='2026-12-31T01:00:00Z'; // 上海09:00，跨年提前七天。
async function row(sql,args=[]) {return (await db.query(sql,args)).rows[0];}
async function enqueue(id='test-sub',day='2027-01-07',person=owner,account='bot-new',user='self') {
  return (await row('select public.enqueue_subscription_reminder($1,$2,$3,$4,$5,$6) value',
    [person,id,day,'合成扣款提醒',account,user])).value;
}
async function context(external,user='self',person=owner,received=at) {
  return (await row("select public.ingest_input($1,'wechat',$2,'合成原话',$3,$4,'record') id",
    [person,external,received,{from_user_id:user,context_token:'synthetic-context'}])).id;
}
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    insert into auth.users values('${owner}'),('${other}');`);
  const dir=new URL('../migrations/',import.meta.url);
  for(const name of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort()) {
    let sql=await readFile(new URL(name,dir),'utf8');
    // 只替换通知事务的时钟，权限、去重和数据结构均执行生产迁移。
    if(name==='0026_subscription_reminders.sql') sql=sql.replace('v_now timestamptz:=now();',`v_now timestamptz:='${at}';`);
    await db.exec(sql);
  }
});
after(async()=>{await db?.close();});

test('没有当前绑定上下文时不入队，不借用旧机器人、他人或未来消息',async()=>{
  await context('bot-old:old');
  await context('bot-new:other-user','other');
  await context('bot-new:other-owner','self',other);
  await context('bot-new:future','self',owner,'2027-01-01T00:00:00Z');
  assert.equal((await enqueue()).reason,'no_context');
  assert.equal((await row("select count(*)::int n from public.raw_inputs where source='system'")).n,0);
});

test('同一续费日期只入队一次；投递前不记成功，不生成财务流水',async()=>{
  const target=await context('bot-new:current','self',owner,'2026-12-31T00:59:59Z');
  assert.equal((await enqueue()).queued,true);
  assert.equal((await enqueue()).reason,'already_queued');
  const entry=await row("select * from public.raw_inputs where source='system'");
  assert.equal(entry.reply_input_id,target);
  assert.equal(entry.delivered_at,null);
  assert.equal(entry.receipt_text,'合成扣款提醒');
  assert.equal(entry.reply_expires_at.toISOString(),'2026-12-31T16:00:00.000Z');
  assert.equal((await row('select count(*)::int n from public.transactions')).n,0);
  assert.equal((await row('select count(*)::int n from public.memory_jobs j join public.conversation_messages m on m.id=j.message_id where m.raw_input_id=$1',[entry.id])).n,0);
});

test('失败可以重新投递；新上下文替换旧上下文，成功后不得再次入队',async()=>{
  const entry=await row("select * from public.raw_inputs where source='system'");
  await db.query('update public.raw_inputs set reply_attempts=5 where id=$1',[entry.id]);
  assert.equal((await enqueue()).reason,'retry_queued');
  assert.equal((await row('select reply_attempts n from public.raw_inputs where id=$1',[entry.id])).n,0);
  const fresh=await context('bot-new:fresh','self',owner,'2026-12-31T01:00:00Z');
  assert.equal((await enqueue()).reason,'retry_queued');
  assert.equal((await row('select reply_input_id from public.raw_inputs where id=$1',[entry.id])).reply_input_id,fresh);
  await db.query('select public.accept_reply($1,$2,1)',[owner,entry.id]);
  assert.equal((await enqueue()).reason,'already_queued');
  assert.equal((await row("select count(*)::int n from public.raw_inputs where source='system'")).n,1);
});

test('只认精确七天；不同订阅独立提醒，浏览器不参与',async()=>{
  assert.equal((await enqueue('six','2027-01-06')).reason,'not_due');
  assert.equal((await enqueue('eight','2027-01-08')).reason,'not_due');
  assert.equal((await enqueue('another')).queued,true);
  assert.equal((await enqueue('another')).reason,'already_queued');
});

test('匿名与已登录网页均不能调用主动推送事务',async()=>{
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    try {await assert.rejects(enqueue('forbidden'),{code:'42501'});}
    finally {await db.exec('reset role');}
  }
});

test('下一个续费周期重新提醒；夜间不发送，跨日不补发旧七天文案',async()=>{
  const sql=(await readFile(new URL('../migrations/0026_subscription_reminders.sql',import.meta.url),'utf8'));
  const functionSql=sql.slice(sql.indexOf('create function')).replace('create function','create or replace function');
  await db.exec(functionSql.replace('v_now timestamptz:=now();',"v_now timestamptz:='2027-01-24T01:00:00Z';"));
  assert.equal((await enqueue('test-sub','2027-01-31')).queued,true);
  await db.exec(functionSql.replace('v_now timestamptz:=now();',"v_now timestamptz:='2027-01-24T14:00:00Z';"));
  assert.equal((await enqueue('night','2027-01-31')).reason,'outside_window');
  assert.equal((await enqueue('stale','2027-01-30')).reason,'not_due');
});
