/**
 * [INPUT]: 已构建relay、官方agy授权与隔离规则工作区。
 * [OUTPUT]: 本人大类、休息措辞差异与睡眠待校准的模型路由证据。
 * [POS]: 大类上线探针；只用合成表达，不连接微信或业务数据库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import assert from 'node:assert/strict';
import {AntigravityParser} from '../apps/relay/dist/src/parser/antigravity.js';
import {verifyWorkspaceRules} from '../apps/relay/dist/src/parser/rules.js';
const options={binary:'/home/lifeos/.local/bin/agy',model:'gemini-3.8-flash-low',workspace:process.env.AGY_WORKSPACE};
await verifyWorkspaceRules(options.workspace);
const parser=new AntigravityParser(true,options);
const categories=[['uncategorized','待确认'],['time-group-work','工作'],['time-group-learning','学习成长'],
 ['time-group-self-care','生活自理'],['time-group-food','饮食'],['time-group-rest','清醒休息'],['time-group-sleep','睡眠'],
 ['time-group-exercise','运动'],['time-group-entertainment','娱乐'],['time-group-social','私人社交'],['time-group-travel','出行']]
 .map(([code,name],id)=>({id:id+1,code,name,kind:'time',is_active:true}));
const checks=[['视频创作属于工作','现在开始剪辑视频','time-group-work'],
 ['如厕属于生活自理','现在去拉屎','time-group-self-care'],['本人休息用语属于娱乐','现在休息一会儿','time-group-entertainment'],
 ['另一休息用语属于清醒休息','现在休息一下','time-group-rest']];
let failures=0;
for(const [name,text,category] of checks){
 try{
  const result=await parser.parse({text,received_at:'2026-10-26T15:00:00+08:00',categories,
   context:{accounts:[],ongoing:[]},dialogue:[],clarifications:[],memories:[],memory_status:'disabled'});
  assert.equal(result.clarify,null);assert.equal(result.time_events?.[0]?.category,category);
  process.stdout.write(JSON.stringify({name,passed:true})+'\n');
 }catch(error){failures++;process.stdout.write(JSON.stringify({name,passed:false,code:error.code??'SEMANTIC_MISMATCH'})+'\n');}
}
process.stdout.write(JSON.stringify({model:options.model,total:checks.length,passed:checks.length-failures})+'\n');
if(failures)process.exitCode=1;
