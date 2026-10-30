/**
 * [INPUT]: 演示数据库与正式时间、历史读取接口。
 * [OUTPUT]: 演示隔离、写入、冲突和正式投影兼容性验收。
 * [POS]: UI预览边界回归；无云端连接或真实账户。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoDatabase} from '../preview/database';
import {native} from '../worker/native';
import {records,recordDetail,editRecord} from '../worker/records';
import {today} from '../src/model';
import type {Transaction} from '../src/model';
test('演示账本经正式投影读取，修改不会进入另一会话',async()=>{
  const a=demoDatabase(),b=demoDatabase();
  const result=await native(a.client,{method:'GET',path:'/v1/time/segments'}) as any;
  assert.ok(result.segments.length>100);
  const first=result.segments[0];
  const saved=await native(a.client,{method:'PUT',path:`/v1/time/segments/${first.id}`,body:{title:'UI试改',revision:first.revision}}) as any;
  assert.equal(saved.segment.title,'UI试改');
  assert.ok(!b.tables.time_entries.some(r=>r.activity==='UI试改'));
  await assert.rejects(native(a.client,{method:'PUT',path:`/v1/time/segments/${first.id}`,body:{title:'过期覆盖',revision:first.revision}}));
  const summary=await native(a.client,{method:'GET',path:'/v1/time/summary/range',params:{from:today(),to:today()}}) as any;
  assert.ok(summary.days.length===1);
});
test('演示历史详情和编辑复用正式接口',async()=>{
  const {client}=demoDatabase();
  const page=await records(client,new URL('http://demo/api/records?kind=money'));
  const id=page.rows[0].id;
  const url=new URL(`http://demo/api/record?kind=money&id=${id}`);
  const detail=await recordDetail(client,url);
  assert.ok(detail.record.data.revision);
  await editRecord(client,{kind:'money',id,revision:detail.record.data.revision,patch:{title:'演示编辑'}});
  const updated=await recordDetail(client,url);
  assert.equal((updated.record.data as Transaction).title,'演示编辑');
  assert.equal(updated.changes.length,1);
});
