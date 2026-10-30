/**
 * [INPUT]: 私有云端快照、本人返还的大类应用计划与全部迁移。
 * [OUTPUT]: 原始时间保真、大类覆盖和WHOOP全量校准演练报告。
 * [POS]: 本机隔离演练；不连接生产库，不读取OAuth或模型凭据。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {readFile,readdir,writeFile,chmod} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
const [livePath,planPath,reportPath]=process.argv.slice(2);assert.ok(livePath&&planPath&&reportPath);
const live=JSON.parse(await readFile(livePath,'utf8')),plan=JSON.parse(await readFile(planPath,'utf8'));
const db=new PGlite();
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);grant usage on schema public,auth to anon,authenticated,service_role;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
 await db.query('insert into auth.users values($1)',[plan.ownerId]);
 const dir=new URL('../migrations/',import.meta.url);for(const file of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
 await db.query('insert into public.categories select * from jsonb_populate_recordset(null::public.categories,$1)',[JSON.stringify(live.categories)]);
 await db.exec("select setval(pg_get_serial_sequence('public.categories','id'),(select max(id) from public.categories));");
 const raw=new Map();for(const t of live.time)raw.set(t.raw_input_id,{id:t.raw_input_id,owner_id:t.owner_id,source:t.source,
  external_id:t.external_id,text:t.raw_text,received_at:t.start_at,payload:{},input_kind:'import',status:'parsed',
  receipt_text:'隔离演练，不发送回执',delivered_at:new Date().toISOString()});
 await db.query(`insert into public.raw_inputs(id,owner_id,source,external_id,text,received_at,payload,input_kind,status,receipt_text,delivered_at)
  select id,owner_id,source,external_id,text,received_at,payload,input_kind,status::public.input_status,receipt_text,delivered_at
  from jsonb_to_recordset($1) as x(id uuid,owner_id uuid,source text,external_id text,text text,received_at timestamptz,
   payload jsonb,input_kind text,status text,receipt_text text,delivered_at timestamptz)`,[JSON.stringify([...raw.values()])]);
 const columns=(await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='time_entries' and is_generated='NEVER' order by ordinal_position")).rows.map(r=>r.column_name);
 await db.query(`insert into public.time_entries(${columns.join(',')}) select ${columns.join(',')} from jsonb_populate_recordset(null::public.time_entries,$1)`,[JSON.stringify(live.time)]);
 await db.query('insert into public.whoop_records select * from jsonb_populate_recordset(null::public.whoop_records,$1)',[JSON.stringify(live.sleep)]);
 const result=(await row('select public.apply_time_group_review($1,$2,$3,$4,$5,$6) result',
  [plan.ownerId,plan.reviewHash,plan.groups,plan.rules,plan.entries,plan.includeNaps])).result;
 assert.equal(result.sleep.invalid,0);assert.equal(result.sleep.conflicts,0);assert.equal(result.sleep.applied,live.sleep.length);
 const classified=(await db.query(`select c.name,count(*)::int records from public.time_entries t join public.categories c on c.id=t.category_id where t.deleted_at is null group by c.name order by c.name`)).rows;
 const changed=(await row(`select count(*)::int n from jsonb_populate_recordset(null::public.time_entries,$1) original join public.time_entries t on t.id=original.id
  where (t.start_at,t.end_at,t.activity) is distinct from (original.start_at,original.end_at,original.activity)`,[JSON.stringify(live.time)])).n;
 assert.equal(changed,0);
 const counts=await row('select count(*)::int n from public.time_entries');
 const again=(await row('select public.reconcile_whoop_time($1) result',[plan.ownerId])).result;
 assert.equal(again.applied,0);assert.equal(again.unchanged,live.sleep.length);assert.deepEqual(await row('select count(*)::int n from public.time_entries'),counts);
 const measured=await row(`select count(*)::int nights,sum(t.duration_min)::int minutes,
  bool_and(t.duration_min=floor(a.asleep_millis/60000.0)::int) exact_minutes
  from public.time_sleep_alignments a join public.raw_inputs r on r.owner_id=a.owner_id and r.payload->>'sleep_id'=a.sleep_id
  join public.time_entries t on t.raw_input_id=r.id and t.item_index=0 and t.deleted_at is null where a.status='applied'`);
 assert.ok(measured.exact_minutes);
 const report={verified:true,groups:plan.groups.length,reviewed_records:plan.entries.length,alignment:result.sleep,classified,
  original_times_unchanged:changed===0,repeated_sync_idempotent:true,measured,
  open_clocks:(await row('select count(*)::int n from public.time_entries where deleted_at is null and end_at is null')).n};
 await writeFile(reportPath,JSON.stringify(report,null,2));await chmod(reportPath,0o600);console.log(JSON.stringify(report));
}finally{await db.close();}
