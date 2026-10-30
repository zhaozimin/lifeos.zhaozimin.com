/**
 * [INPUT]: 已构建relay、官方agy授权与隔离规则工作区。
 * [OUTPUT]: 连续边界、单次切换和明确执行请求的模型计划证据。
 * [POS]: 计时上线探针；串行模型调用，不连接微信、数据库或MemOS。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import assert from 'node:assert/strict';
import {AntigravityParser} from '../apps/relay/dist/src/parser/antigravity.js';
import {verifyWorkspaceRules} from '../apps/relay/dist/src/parser/rules.js';
const options={binary:'/home/lifeos/.local/bin/agy',model:'gemini-3.8-flash-low',workspace:process.env.AGY_WORKSPACE};
assert.ok(options.workspace);await verifyWorkspaceRules(options.workspace);
const parser=new AntigravityParser(true,options);
const categories=[['work','工作'],['rest','休息'],['food','饮食'],['uncategorized','未分类']]
 .map(([code,name],id)=>({id:id+1,kind:'time',code,name,is_active:true}));
const stamp=clock=>'2026-10-26T'+clock+':00+08:00';
const ongoing=(clock,activity,category)=>({accounts:[],ongoing:[{id:'11111111-1111-4111-8111-111111111111',
 revision:1,start_at:stamp(clock),activity,category}]});
const meal=ongoing('10:37','吃饭','food');
const checks=[
 {name:'连续边界先闭旧计时',text:'10点开始休息，10点37吃饭',clock:'10:37',context:ongoing('08:40','发送任务','work'),
  verify:r=>{assert.equal(r.clarify,null);assert.equal(r.time_entries.length,1);
   assert.equal(Date.parse(r.time_entries[0].start_at),Date.parse(stamp('10:00')));
   assert.equal(Date.parse(r.time_events?.[0]?.at),Date.parse(stamp('10:37')));}},
 {name:'新活动不索要确认',text:'11:07吃完饭，拉屎',clock:'11:07',context:meal,
  verify:r=>{assert.equal(r.clarify,null);assert.equal(r.time_events?.[0]?.action,'switch');
   assert.equal(Date.parse(r.time_events[0].at),Date.parse(stamp('11:07')));}},
 {name:'多行活动完整生成计划',text:'11:07吃完饭，拉屎\n11:13拉完屎，休息一会儿',clock:'11:19',context:meal,
  verify:r=>{assert.equal(r.clarify,null);assert.equal(r.time_entries.length,1);
   assert.equal(Date.parse(r.time_entries[0].start_at),Date.parse(stamp('11:07')));
   assert.equal(Date.parse(r.time_entries[0].end_at),Date.parse(stamp('11:13')));
   assert.equal(Date.parse(r.time_events?.[0]?.at),Date.parse(stamp('11:13')));}},
 {name:'明确执行上一条原话不再反问',text:'现在就写，以后不需要我确认，只要我说了这个时间在干什么，你就立刻写',clock:'11:27',context:meal,
  dialogue:[{text:'11:07吃完饭，拉屎\n11:13拉完屎，休息一会儿',reply:'请确认是否记录。',received_at:stamp('11:19')}],
  verify:r=>{assert.equal(r.clarify,null);assert.equal(r.time_entries.length,1);assert.equal(r.time_events?.[0]?.action,'switch');}},
];
let failed=0;
for(const item of checks){
 try{
  const result=await parser.parse({text:item.text,received_at:stamp(item.clock),categories,context:item.context,
   dialogue:item.dialogue??[],clarifications:[],memories:[],memory_status:'disabled'});
  item.verify(result);process.stdout.write(JSON.stringify({name:item.name,passed:true})+'\n');
 }catch(error){failed++;process.stdout.write(JSON.stringify({name:item.name,passed:false,code:error.code??'SEMANTIC_MISMATCH'})+'\n');}
}
process.stdout.write(JSON.stringify({model:options.model,total:checks.length,passed:checks.length-failed})+'\n');
if(failed)process.exitCode=1;
