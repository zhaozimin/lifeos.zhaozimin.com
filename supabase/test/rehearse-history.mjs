/**
 * [INPUT]: 私有迁移 SQL、源快照清单及云端分类副本。
 * [OUTPUT]: 临时 PostgreSQL 的数量、金额、时长和重导证据。
 * [POS]: 真实数据上线前演练；仅在内存数据库执行，不连接生产。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';

const folder=resolve(process.argv[2]);
const categoryFile=resolve(process.argv[3]);
const db=new PGlite();
async function applySql(sql) {
  if(!process.argv.includes('--staged'))return db.exec(sql);
  assert.ok(sql.startsWith('begin;\n')&&sql.endsWith('commit;\n'));
  const body=sql.slice('begin;\n'.length,-'commit;\n'.length);
  await db.exec('create temporary table if not exists history_stage(part integer primary key,content text);truncate history_stage;');
  for(let offset=0;offset<body.length;offset+=100000)
    await db.query('insert into history_stage values($1,$2)',[offset/100000,body.slice(offset,offset+100000)]);
  return db.exec("do $apply$ declare v_sql text; begin select string_agg(content,'' order by part) into v_sql from history_stage;execute v_sql;end $apply$;");
}
try {
  const sql=await readFile(join(folder,'history.sql'),'utf8');
  const report=JSON.parse(await readFile(join(folder,'report.json'),'utf8'));
  const categories=JSON.parse(await readFile(categoryFile,'utf8'));
  const owner=/'([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})'/.exec(sql)?.[1];
  assert.match(owner??'',/^[a-f0-9-]{36}$/);
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
  await db.query('insert into auth.users values($1)',[owner]);
  const dir=new URL('../migrations/',import.meta.url);
  for(const name of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort())
    await db.exec(await readFile(new URL(name,dir),'utf8'));
  for(const c of categories)await db.query(`insert into public.categories(id,owner_id,name,code,kind,nature,direction)
    values($1,$2,$3,$4,$5,$6,$7)`,[c.id,owner,c.name,c.code,c.kind,c.nature,c.direction]);
  await db.exec("select setval('public.categories_id_seq',(select max(id) from public.categories));");
  await applySql(sql);
  const row=async(sql,params=[]) => (await db.query(sql,params)).rows[0];
  const counts={};
  for(const [table,expected] of Object.entries(report.target_counts)) {
    counts[table]=(await row('select count(*)::int n from public.'+table)).n;
    assert.equal(counts[table],expected+(table==='categories'?categories.length:0));
  }
  const time=await row(`select count(*) filter(where deleted_at is null)::int live,
    count(*) filter(where deleted_at is null and end_at is null)::int open,
    sum(duration_min) filter(where deleted_at is null)::int net,
    sum(deduction_minutes) filter(where deleted_at is null)::int deducted from public.time_entries`);
  assert.equal(time.live,report.live_time);assert.equal(time.open,report.open_time);
  assert.equal(time.net,report.closed_net_minutes);assert.equal(time.deducted,report.deduction_minutes);
  const money=(await db.query(`select currency||':'||direction key,sum(amount_cents)::text cents
    from public.transactions where deleted_at is null group by currency,direction`)).rows;
  assert.deepEqual(Object.fromEntries(money.map(x=>[x.key,Number(x.cents)])),report.money_totals_cents);
  const sample=await row('select id,note,revision from public.time_entries where deleted_at is null and end_at is not null limit 1');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner,aal:'aal2'})]);
  await db.exec('set role authenticated');
  await db.query("select public.edit_record('time',$1,$2,$3)",[sample.id,sample.revision,{note:'迁移演练：保留人工修改'}]);
  await db.exec('reset role');
  await applySql(sql);
  assert.equal((await row('select note from public.time_entries where id=$1',[sample.id])).note,'迁移演练：保留人工修改');
  assert.equal((await row('select count(*)::int n from public.time_entries')).n,counts.time_entries);
  assert.equal((await row('select count(*)::int n from public.raw_inputs')).n,counts.raw_inputs);
  const proof={verified:true,network_database:false,counts,time,money_totals_cents:report.money_totals_cents,
    reimport_idempotent:true,web_edits_preserved:true,snapshot_at:report.snapshot_at};
  await writeFile(join(folder,'rehearsal.json'),JSON.stringify(proof,null,2)+'\n',{mode:0o600});
  process.stdout.write(JSON.stringify({verified:true,counts,reimport_idempotent:true,web_edits_preserved:true})+'\n');
}catch(error){process.stderr.write(JSON.stringify({error:error.message,code:error.code,position:error.position})+'\n');process.exitCode=1;}
finally{await db.close();}
