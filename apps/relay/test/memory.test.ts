/**
 * [INPUT]: MemOS HTTP替身、合成消息与持久化队列替身。
 * [OUTPUT]: 身份隔离、召回预算、异步恢复与结果不明写入保护证据。
 * [POS]: 云记忆行为验收；不发送真实对话或消耗云配额。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import {MemOSCloud,MemoryError} from '../src/memory/cloud.js';
import {syncMemoryOnce} from '../src/memory/worker.js';
import type {MemoryBackend,MemoryJob,MemoryQueue,MemoryOutcome} from '../src/contracts.js';
import {readConfig} from '../src/config.js';
const options={key:'synthetic-private-key',userId:'test-user',agentId:'test-agent'};
const job={id:'job',message_id:'message',raw_input_id:'input',lease_token:'lease',role:'user',
 content:'我偏好先给结论。',happened_at:'2026-10-25T23:30:00Z',conversation_id:'test-conversation',task_id:null,state:'submitting'} as MemoryJob;
const response=(data:unknown)=>new Response(JSON.stringify({code:0,data}),{status:200});
test('云写入保留角色、北京时间和稳定来源；明确关闭公共记忆',async()=>{
 const client=new MemOSCloud(options,async(url,init)=>{
  assert.equal(url,'https://memos.memtensor.cn/api/openmem/v1/add/message');
  const body=JSON.parse(String(init?.body));
  assert.equal(body.user_id,options.userId);assert.equal(body.agent_id,options.agentId);assert.equal(body.allow_public,false);
  assert.equal(body.messages[0].chat_time,'2026-10-26 07:30:00');assert.equal(body.messages[0].role,'user');
  assert.equal(body.info.source_message_id,'message');assert.ok(!String(init?.body).includes(options.key));
  return response({task_id:'cloud-task',status:'running'});
 });
 assert.deepEqual(await client.submit(job),{task_id:'cloud-task',status:'running'});
});
test('召回限制到本人Agent和五条片段，工具与技能内容不注入',async()=>{
 const rows=Array.from({length:9},(_,i)=>({id:String(i),memory_value:'😀'.repeat(2000),conversation_id:'old'}));
 const client=new MemOSCloud(options,async(_url,init)=>{
  const body=JSON.parse(String(init?.body));assert.deepEqual(body.filter,{and:[{agent_id:'test-agent'}]});
  assert.equal(body.memory_limit_number,5);assert.ok(!body.include_memory_view.includes('skill'));
  return response({memory_detail_list:rows,tool_memory_detail_list:[{id:'tool',memory_value:'不要注入'}]});
 });
 const hits=await client.search('以前的偏好');assert.equal(hits.length,5);
 assert.equal(hits.reduce((n,x)=>n+Array.from(x.content).length,0),6000);
 assert.ok(hits.every(x=>x.kind==='fact'&&x.conversation_id==='old'));
});
test('写入网络或5xx结果不明，明确429可重试，认证失败不泄露上游正文',async()=>{
 for(const status of [401,429,503]){
  const client=new MemOSCloud(options,async()=>new Response('private upstream body',{status}));
  await assert.rejects(client.submit(job),(e:unknown)=>{
   assert.ok(e instanceof MemoryError);assert.equal(e.ambiguous,status===503);
   assert.equal(e.retryable,status!==401);assert.ok(!e.message.includes('private'));return true;
  });
 }
 await assert.rejects(new MemOSCloud(options,async()=>{throw Error('private body');}).submit(job),
  (e:unknown)=>e instanceof MemoryError&&e.ambiguous);
 await assert.rejects(new MemOSCloud(options,async()=>response({success:true})).submit(job),
  (e:unknown)=>e instanceof MemoryError&&e.ambiguous);
 assert.throws(()=>new MemOSCloud({...options,baseUrl:'https://attacker.invalid'}),{code:'MEMOS_CONFIG_INVALID'});
});
function queue(input:MemoryJob){
 const results:Array<{state:MemoryOutcome;task:string|null;code?:string}>=[];
 const q:MemoryQueue={claimMemory:async()=>input,finishMemory:async(_j,state,task,code)=>{results.push({state,task,code});}};
 return {q,results};
}
const log=pino({level:'silent'});
test('已持久化task_id的任务只轮询，恢复不会再次上传',async()=>{
 const {q,results}=queue({...job,task_id:'known-task',state:'processing'});let submissions=0;
 const backend:MemoryBackend={search:async()=>[],submit:async()=>{submissions++;throw Error('must not submit');},status:async id=>{assert.equal(id,'known-task');return 'completed';}};
 await syncMemoryOnce(q,backend,log);assert.equal(submissions,0);assert.deepEqual(results,[{state:'completed',task:'known-task',code:undefined}]);
});
test('写入不明不自动重投，轮询失败保留task_id后退避',async()=>{
 for(const task of [null,'known-task']){
  const {q,results}=queue({...job,task_id:task});
  const backend:MemoryBackend={search:async()=>[],submit:async()=>{throw new MemoryError('MEMOS_NETWORK_FAILED',true,true);},status:async()=>{throw new MemoryError('MEMOS_NETWORK_FAILED',true);}};
  await syncMemoryOnce(q,backend,log);assert.equal(results[0]?.state,task?'retry':'unknown');assert.equal(results[0]?.task,task);
 }
});
test('配置默认关闭；显式启用必须有私有凭据',()=>{
 const base={SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-key-long-enough',OWNER_AUTH_ID:'11111111-1111-4111-8111-111111111111'};
 assert.equal(readConfig(base).MEMOS_ENABLED,'false');
 assert.throws(()=>readConfig({...base,MEMOS_ENABLED:'true'}),/MEMOS_API_KEY/);
 assert.equal(readConfig({...base,MEMOS_ENABLED:'true',MEMOS_API_KEY:'private'}).MEMOS_AGENT_ID,'lifeos-butler');
});
