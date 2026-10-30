/**
 * [INPUT]: 已构建relay、官方agy授权与指定规则工作区。
 * [OUTPUT]: 合成提问、追问、混合句及记录回归的真实模型证据。
 * [POS]: 问答上线探针；串行调用，不连接数据库或微信。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import assert from 'node:assert/strict';
import { AntigravityParser } from '../apps/relay/dist/src/parser/antigravity.js';
import { verifyWorkspaceRules } from '../apps/relay/dist/src/parser/rules.js';
const options={binary:'/home/lifeos/.local/bin/agy',model:'gemini-3.8-flash-low',
  workspace:process.env.AGY_WORKSPACE??'/var/lib/lifeos/parser-workspace'};
await verifyWorkspaceRules(options.workspace);
const parser=new AntigravityParser(true,options);
const categories=[['time','uncategorized','未分类'],['time','work','工作'],['time','rest','休息'],
  ['money','uncategorized','未分类'],['money','food','餐饮']]
  .map(([kind,code,name],i)=>({id:i+1,kind,code,name,is_active:true}));
const context={accounts:[{name:'生活账户',type:'digitalWallet'}],ongoing:[]};
const noWrite=r=>assert.equal(r.time_entries.length+r.transactions.length+(r.time_events?.length??0),0);
const answered=r=>{assert.ok(r.answer&&r.answer.length>12);assert.equal(r.clarify,null);};
const cases=[
 {name:'身份与能力',text:'你是谁？我可以直接向你提问吗？',verify:r=>{noWrite(r);answered(r);}},
 {name:'一般知识解释',text:'用两句话解释机会成本，并给我一个日常例子。',verify:r=>{noWrite(r);answered(r);assert.match(r.answer,/机会成本|放弃|选择/);}},
 {name:'最近对话追问',text:'第二步先放哪些内容？',dialogue:[{text:'我想做个人网站，请分两步介绍。',
  reply:'第一步整理资料；第二步上线一个包含介绍和作品的静态展示页。',received_at:'2026-10-26T00:00:00Z'}],
  verify:r=>{noWrite(r);answered(r);assert.match(r.answer,/网站|展示|介绍|作品|联系/);}},
 {name:'情绪互动',text:'今天做事总没头绪，你能陪我梳理一下吗？',verify:r=>{noWrite(r);answered(r);}},
 {name:'明确仅存档',text:'仅存档，不用回答：我想到博客可以增加访谈栏目。',verify:r=>{noWrite(r);assert.ok(!r.answer);assert.equal(r.archive_kind,'inspiration');}},
 {name:'未来问题不记活动',text:'如果明天开始写代码，应该先做哪些准备？',verify:r=>{noWrite(r);answered(r);}},
 {name:'记账同时提问',text:'生活账户付38元午饭，微信支付。顺便解释一下预算是什么。',verify:r=>{
  assert.equal(r.transactions[0]?.amount_cents,3800);assert.equal(r.transactions[0]?.funding_account,'生活账户');
  assert.equal(r.time_events?.length??0,0);answered(r);assert.match(r.answer,/预算/);}},
 {name:'资金账户仍需追问',text:'午饭38元微信付的',verify:r=>{noWrite(r);assert.ok(r.clarify);assert.ok(!r.answer);}},
 {name:'开始记录仍切换',text:'现在开始写代码',verify:r=>{assert.equal(r.time_events?.[0]?.action,'switch');assert.equal(r.transactions.length,0);}},
];
const selected=process.env.PROBE_CASES?cases.filter(c=>process.env.PROBE_CASES.split(',').includes(c.name)):cases;
assert.ok(selected.length,'没有匹配的探针场景');
const results=[];
for(const c of selected){
 const started=Date.now();
 try{
  const result=await parser.parse({text:c.text,received_at:'2026-10-26T00:10:00Z',categories,
   clarifications:[],context,dialogue:c.dialogue??[]});
  c.verify(result);results.push({name:c.name,passed:true,milliseconds:Date.now()-started,answer:result.answer??null});
 }catch(error){results.push({name:c.name,passed:false,code:error.code??error.message});}
 process.stdout.write(JSON.stringify(results.at(-1))+'\n');
}
const passed=results.filter(r=>r.passed).length;
process.stdout.write(JSON.stringify({model:options.model,total:selected.length,passed})+'\n');
if(passed!==selected.length)process.exitCode=1;
