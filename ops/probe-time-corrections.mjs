/**
 * [INPUT]: 构建后的relay、官方agy与隔离规则工作区。
 * [OUTPUT]: 时间纠错、混合切换和普通补录的真实模型路由证据。
 * [POS]: 上线语义探针；使用合成内容，不连接数据库、微信或MemOS。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import assert from 'node:assert/strict';
import {AntigravityParser} from '../apps/relay/dist/src/parser/antigravity.js';
import {verifyWorkspaceRules} from '../apps/relay/dist/src/parser/rules.js';
const workspace=process.env.AGY_WORKSPACE;assert.ok(workspace);await verifyWorkspaceRules(workspace);
const parser=new AntigravityParser(true,{binary:'/home/lifeos/.local/bin/agy',
  model:'gemini-3.8-flash-low',workspace});
const stamp=time=>`2026-10-28T${time}:00+08:00`;
const categories=[['work','工作'],['rest','清醒休息'],['food','饮食'],['learn','学习成长'],['uncategorized','待确认']]
  .map(([code,name],index)=>({id:index+1,code,name,kind:'time',is_active:true}));
const context={accounts:[],ongoing:[{id:'11111111-1111-4111-8111-111111111111',
  revision:1,start_at:stamp('18:13'),activity:'休息',category:'rest'}]};
const edit=result=>{assert.equal(result.clarify,null);assert.equal(result.time_corrections?.length,1);
  assert.equal(result.time_entries.length,0);assert.equal(result.unsupported,null);return result.time_corrections[0];};
const checks=[
  {name:'明确纠错直接修改',text:'18:13到18:25在写作，没有在休息，我记录错了，请修改一下',
    verify:r=>{const value=edit(r);assert.equal(value.patch.category,'work');assert.match(value.patch.activity,/写/);
      assert.equal(Date.parse(value.target.start_at),Date.parse(stamp('18:13')));}},
  {name:'纠错与下一活动一起提交',text:'我从18点13分开始一直到18点25分都在写作，现在18点25分我要吃饭了',
    verify:r=>{edit(r);assert.equal(r.time_events?.[0]?.activity,'吃饭');assert.equal(Date.parse(r.time_events[0].at),Date.parse(stamp('18:25')));}},
  {name:'旧钟点查找新钟点修改',text:'把上一段活动的结束时间改成18:10，其他内容保留',
    verify:r=>{const value=edit(r);assert.equal(value.target.position,'previous');
      assert.equal(Date.parse(value.patch.end_at),Date.parse(stamp('18:10')));assert.equal(value.patch.activity,undefined);}},
  {name:'昨天的纠错有明确日期',text:'把昨天9点到10点记成工作的那段改成学习',
    verify:r=>{const value=edit(r);assert.equal(value.patch.category,'learn');
      assert.equal(Date.parse(value.target.start_at),Date.parse('2026-10-27T09:00:00+08:00'));}},
  {name:'普通补录沿用新增流程',text:'18点20分到18点25分写文案',
    verify:r=>{assert.equal(r.clarify,null);assert.equal(r.time_corrections?.length??0,0);assert.equal(r.time_entries.length,1);}},
  {name:'缺少目标只追问一个问题',text:'帮我把时间改一下',
    verify:r=>{assert.ok(r.clarify);assert.equal(r.time_corrections?.length??0,0);}},
];
let failed=0;
for(const item of checks){
  try{
    const result=await parser.parse({text:item.text,received_at:stamp('18:30'),categories,context,
      clarifications:[],dialogue:[],memories:[],memory_status:'disabled'});
    item.verify(result);process.stdout.write(JSON.stringify({name:item.name,passed:true})+'\n');
  }catch(error){failed++;process.stdout.write(JSON.stringify({name:item.name,passed:false,code:error.code??'SEMANTIC_MISMATCH'})+'\n');}
}
process.stdout.write(JSON.stringify({total:checks.length,passed:checks.length-failed})+'\n');
if(failed)process.exitCode=1;
