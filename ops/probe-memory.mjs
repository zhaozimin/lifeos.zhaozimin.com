/**
 * [INPUT]: MemOS私有凭据、已构建relay与专用规则工作区。
 * [OUTPUT]: 隔离合成身份的云端写入、跨会话召回和agy使用记忆证据。
 * [POS]: 长期记忆上线探针；不写业务库，不向微信发送消息。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {MemOSCloud} from '../apps/relay/dist/src/memory/cloud.js';
import {AntigravityParser} from '../apps/relay/dist/src/parser/antigravity.js';
import {verifyWorkspaceRules} from '../apps/relay/dist/src/parser/rules.js';
const userId='lifeos-probe:'+randomUUID(),agentId='lifeos-butler-probe';
const memory=new MemOSCloud({key:process.env.MEMOS_API_KEY,userId,agentId,recallTimeoutMs:8000});
const secret='琥珀钟楼7391';
const result=await memory.submit({id:randomUUID(),message_id:randomUUID(),raw_input_id:randomUUID(),
 role:'user',content:'这是合成测试，不是真人事实。我的测试项目名是演示工坊，专属暗号是'+secret+'。',
 happened_at:new Date().toISOString(),conversation_id:'probe-session-a',task_id:null,state:'submitting',lease_token:randomUUID()});
let status=result.status;
for(let i=0;i<24&&status==='running';i++){await delay(5000);status=await memory.status(result.task_id);}
assert.equal(status,'completed');
let memories=[];
for(let i=0;i<4;i++){
 memories=await memory.search('我之前提到的演示工坊专属暗号是什么？');
 if(memories.some(x=>x.content.includes(secret)))break;
 await delay(5000);
}
assert.ok(memories.some(x=>x.content.includes(secret)),'跨会话召回没有命中测试事实');
const workspace=process.env.AGY_WORKSPACE??'/var/lib/lifeos/parser-workspace';
await verifyWorkspaceRules(workspace);
const parser=new AntigravityParser(true,{binary:'/home/lifeos/.local/bin/agy',model:'gemini-3.8-flash-low',workspace});
const answer=await parser.parse({text:'我之前提到的演示工坊专属暗号是什么？',received_at:new Date().toISOString(),
 categories:[{id:1,code:'uncategorized',name:'未分类',kind:'time',is_active:true}],clarifications:[],
 context:{accounts:[],ongoing:[]},dialogue:[],memories,memory_status:'enabled'});
assert.ok(answer.answer?.includes(secret));
assert.equal(answer.time_entries.length+answer.transactions.length+(answer.time_events?.length??0),0);
process.stdout.write(JSON.stringify({cloud_completed:true,cross_session_recall:true,agy_used_memory:true,
 recent_dialogue_empty:true,isolated_test_identity:true,user_id:userId,agent_id:agentId,task_id:result.task_id})+'\n');
