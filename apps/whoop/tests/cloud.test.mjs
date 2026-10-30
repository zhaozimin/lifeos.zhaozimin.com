/**
 * [INPUT]: 原版隔离工作库、云端发布器与合成计划。
 * [OUTPUT]: 发布副本无OAuth凭据，等待状态不产生运动回执。
 * [POS]: 云端出口回归；不读取真实工作库或连接WHOOP。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';
import {publicStatus,publication,morningText,CloudBridge} from '../server/cloud.mjs';
test('健康发布只包含脱敏状态、图表和数据，不带本机密钥及CSRF',()=>{
 const dir=mkdtempSync(join(tmpdir(),'whoop-cloud-'));
 const app=createApp({config:{dataDir:dir,origin:'http://localhost:3210',port:3210}});
 try{
  app.store.set('settings',{clientId:'private-client',clientSecret:'private-secret'});
  app.store.set('tokens',{access_token:'private-access',refresh_token:'private-refresh'});
  const result=publication({...app,snapshot:(_demo,n)=>app.snapshot(true,n)});
  const text=JSON.stringify(result);
  for(const secret of ['private-client','private-secret','private-access','private-refresh',app.status().csrf,dir])assert.ok(!text.includes(secret));
  assert.equal(publicStatus(app).cloud,true);
  assert.ok(result.values['dashboard:90'].days.length);
  assert.ok(result.values.summary);
 }finally{app.store.close();rmSync(dir,{recursive:true,force:true});}
});
test('待评分的计划不能伪造可发送的训练剂量；正式回执有依据和完整页面',()=>{
 assert.throws(()=>morningText({publication:{state:'waiting'}}),/PLAN_NOT_PUBLISHED/);
 const text=morningText({targetDate:'2026-10-25',timeZone:'Asia/Shanghai',publication:{state:'published'},
  basis:{metrics:{recovery:67,sleepHours:6.5}},exercise:{mode:'轻量活动',minutes:20,steps:['先热身，再按舒适强度进行。'],adjustment:'不因单日高分突然加量。'}});
 assert.match(text,/20分钟/);assert.match(text,/当天已评分/);assert.match(text,/dashboard\/health/);
});

test('健康发布成功后调用同归属睡眠校准，未评分数据不由客户端推断',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'whoop-align-'));
 const app=createApp({config:{dataDir:dir,origin:'http://localhost:3210',port:3210}}),calls=[];
 try{
  const bridge=new CloudBridge({...app,snapshot:(_demo,n)=>app.snapshot(true,n)},
   {url:'https://example.supabase.co',key:'private-key',ownerId:'self'},async(url,request)=>{
    calls.push({route:url.split('/').at(-1),body:JSON.parse(request.body)});
    return new Response(JSON.stringify({enabled:true,applied:1}),{status:200});
   });
  const result=await bridge.publish();
  assert.deepEqual(calls.map(x=>x.route),['publish_whoop','reconcile_whoop_time','publish_visitor_health']);
  assert.deepEqual(calls[1].body,{p_owner_id:'self'});assert.equal(result.time.applied,1);
 }finally{app.store.close();rmSync(dir,{recursive:true,force:true});}
});
