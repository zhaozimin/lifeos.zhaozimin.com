/**
 * [INPUT]: 全部迁移、双归属合成账本和公开健康副本。
 * [OUTPUT]: 匿名白名单、固定归属、只读权限及标题开关验收。
 * [POS]: 访客数据库边界；不连接生产项目。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const canary='PRIVATE-TITLE-NOTE-ACCOUNT';
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);grant usage on schema public,auth to anon,authenticated,service_role;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 insert into auth.users values('${owner}'),('${other}');`);
 const dir=new URL('../migrations/',import.meta.url);for(const file of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
 for(const id of [owner,other]){
  const c=(await db.query("insert into public.categories(owner_id,kind,code,name,nature) values($1,'time','work','工作','core') returning id",[id])).rows[0].id;
  const r=(await db.query("select public.ingest_input($1,'wechat','visitor-test',$2,'2026-10-26T01:00:00Z','{}','record') id",[id,canary])).rows[0].id;
  await db.query("insert into public.time_entries(raw_input_id,item_index,start_at,end_at,category_id,activity,note,project,tags) values($1,0,'2026-10-26T01:00:00Z','2026-10-26T02:00:00Z',$2,$3,$3,$3,array[$3])",[r,c,canary]);
 }
 await db.query('insert into public.visitor_settings(id,owner_id) values(1,$1)',[owner]);
 await db.query("insert into public.visitor_health_publications(owner_id,range_days,value) values($1,30,'{\"safe\":42}')",[owner]);
});
after(async()=>{await db?.close();});
async function asAnon(fn){await db.exec('set role anon');try{return await fn();}finally{await db.exec('reset role');}}
const time=()=>db.query("select public.visitor_time('2026-10-26T00:00:00Z','2026-10-27T00:00:00Z') value");
test('默认关闭；开放后匿名只见固定归属和白名单字段',async()=>{
 await asAnon(()=>assert.rejects(time()));
 await db.exec('update public.visitor_settings set enabled=true');
 const value=await asAnon(async()=>(await time()).rows[0].value);
 assert.equal(value.entries.length,1);assert.equal(value.entries[0].activity,'工作');
 assert.ok(!JSON.stringify(value).includes(canary));assert.ok(!JSON.stringify(value).includes(owner));
 assert.deepEqual(Object.keys(value.entries[0]).sort(),['activity','category_id','deduction_minutes','end_at','id','source','start_at']);
 assert.deepEqual((await asAnon(()=>db.query('select public.visitor_health(30) value'))).rows[0].value,{safe:42});
});
test('匿名不能读取私有底表、原健康副本、写配置或调用发布器',async()=>{
 await asAnon(async()=>{
  for(const table of ['raw_inputs','time_entries','transactions','whoop_publications']){
   try{const r=await db.query(`select * from public.${table}`);assert.equal(r.rows.length,0);}catch(e){assert.match(e.message,/permission denied/);}
  }
  for(const sql of ['select * from public.visitor_settings','select * from public.visitor_health_publications','update public.visitor_settings set enabled=false',"select public.publish_visitor_health('11111111-1111-4111-8111-111111111111','{}')",'select public.time_sleep_summary_for_owner(null,current_date,current_date)'])await assert.rejects(db.query(sql));
  await assert.rejects(db.query("select public.visitor_time('2020-01-01','2026-01-01')"));
 });
});
test('原始标题需要显式开关；其他敏感字段仍不返回',async()=>{
 await db.exec('update public.visitor_settings set share_activity_titles=true');
 const value=(await asAnon(time)).rows[0].value;assert.equal(value.entries[0].activity,canary);
 assert.equal(value.entries[0].note,undefined);assert.equal(value.entries[0].tags,undefined);assert.equal(value.entries[0].project,undefined);
});
test('健康发布器只接受服务身份，匿名读取仍走固定归属投影',async()=>{
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'service_role'})]);
 await db.exec('set role service_role');
 try{await db.query('select public.publish_visitor_health($1,$2)',[owner,{'7':{safe:7},'30':{safe:30},'90':{safe:90}}]);}
 finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claims','{}',false)");}
 assert.deepEqual((await asAnon(()=>db.query('select public.visitor_health(90) value'))).rows[0].value,{safe:90});
});
test('完整财务投影不选择金额、账户、商户与原始标题',async()=>{
 for(const id of [owner,other]){
  const c=(await db.query("insert into public.categories(owner_id,kind,code,name,direction) values($1,'money','expense-private',$2,'expense') returning id",[id,canary])).rows[0].id;
  const r=(await db.query("select id from public.raw_inputs where owner_id=$1 limit 1",[id])).rows[0].id;
  await db.query("insert into public.transactions(raw_input_id,item_index,occurred_at,direction,amount_cents,currency,category_id,account,merchant,note,title) values($1,0,'2026-10-26T01:23:00Z','expense',987654321,'CNY',$2,$3,$3,$3,$3)",[r,c,canary]);
 }
 const value=(await asAnon(()=>db.query('select public.visitor_finance() value'))).rows[0].value;
 assert.equal(value.length,1);assert.deepEqual(Object.keys(value[0]).sort(),['category','day','id','kind']);assert.equal(value[0].category,'其他支出');assert.ok(!JSON.stringify(value).includes(canary));assert.ok(!JSON.stringify(value).includes('987654321'));
});
