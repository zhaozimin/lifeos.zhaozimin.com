/**
 * [INPUT]: 已构建 relay、官方 agy OAuth 与专用规则工作区。
 * [OUTPUT]: 合成语句的真实模型路由验收，不调用数据库或微信。
 * [POS]: 管家上线探针；串行调用现有模型，执行前暂停生产解析器。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import assert from 'node:assert/strict';
import { AntigravityParser } from '../apps/relay/dist/src/parser/antigravity.js';
import { verifyWorkspaceRules } from '../apps/relay/dist/src/parser/rules.js';

const options={binary:process.env.AGY_BIN??'/home/lifeos/.local/bin/agy',
  model:'gemini-3.8-flash-low',workspace:process.env.AGY_WORKSPACE??'/var/lib/lifeos/parser-workspace'};
await verifyWorkspaceRules(options.workspace);
const parser=new AntigravityParser(true,options);
const categories=[
  ['time','uncategorized','未归类'],['time','work','开发创作'],['time','rest','休息'],
  ['time','sleep','睡眠'],['money','uncategorized','未分类'],['money','food','餐饮'],
].map(([kind,code,name],i)=>({id:i+1,kind,code,name,is_active:true}));
const context={accounts:[{name:'生活账户',type:'digitalWallet'},{name:'储蓄账户',type:'savings'}],ongoing:[]};
const none=r=>assert.equal(r.time_entries.length+r.transactions.length+(r.time_events?.length??0),0);
const cases=[
  ['开始活动','现在开始写代码',r=>{assert.equal(r.time_events?.[0]?.action,'switch');assert.equal(r.transactions.length,0);}],
  ['休息不是睡眠','我休息一下',r=>assert.equal(r.time_events?.[0]?.category,'rest')],
  ['睡眠切换','我睡了',r=>assert.equal(r.time_events?.[0]?.category,'sleep')],
  ['渠道不猜账户','午饭38元微信付的',r=>{none(r);assert.ok(r.clarify);}],
  ['纯收支不切时间','生活账户付38元午饭，微信支付',r=>{assert.equal(r.transactions[0]?.funding_account,'生活账户');assert.equal(r.transactions[0]?.amount_cents,3800);assert.equal(r.time_events?.length??0,0);}],
  ['灵感保留原话','突然想到，定价页可以把年付放在前面',r=>{none(r);assert.equal(r.archive_kind,'inspiration');}],
  ['日记保留原话','记一下今天：下午和王磊聊了课程大纲',r=>{none(r);assert.equal(r.archive_kind,'diary');}],
  ['混合句三个域','生活账户付38元午饭，现在开始写代码，突然想到定价可以改',r=>{assert.equal(r.transactions.length,1);assert.equal(r.time_events?.length,1);assert.equal(r.archive_kind,'inspiration');}],
  ['时长不猜起止','刚才开会一个半小时',r=>{none(r);assert.ok(r.clarify);}],
  ['转账不伪装支出','生活账户转到储蓄账户3000元',r=>{assert.equal(r.transactions.length,0);assert.equal(r.unsupported,'transfer');}],
  ['完整时间段','今天9点到10点写方案',r=>{assert.equal(r.time_entries.length,1);assert.equal(Date.parse(r.time_entries[0].start_at),Date.parse('2026-10-25T09:00:00+08:00'));}],
  ['明确停止记录','先记到这里，我不记了',r=>assert.equal(r.time_events?.[0]?.action,'stop')],
];
const results=[];
for(const [name,text,verify] of cases){
  const started=Date.now();
  try{
    const result=await parser.parse({text,received_at:'2026-10-25T10:30:25+08:00',categories,context,clarifications:[]});
    verify(result);results.push({name,passed:true,milliseconds:Date.now()-started});
  }catch(error){results.push({name,passed:false,code:error.code??'SEMANTIC_MISMATCH',milliseconds:Date.now()-started});}
  process.stdout.write(JSON.stringify(results.at(-1))+'\n');
  if(results.at(-1).code==='PARSER_REQUEST_FAILED')break;
}
const passed=results.filter(r=>r.passed).length;
process.stdout.write(JSON.stringify({model:options.model,total:cases.length,completed:results.length,passed})+'\n');
if(passed!==cases.length)process.exitCode=1;
