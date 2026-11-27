/**
 * [INPUT]: 确定性时段命令、计划校验器及仓储替身。
 * [OUTPUT]: 冻结日期、有效格式、无模型执行及替换RPC回执证据。
 * [POS]: 命令链路验收；真实裁剪与撤销由数据库测试验证。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseTimeCommand} from '../src/time-command.js';
import {validateParse} from '../src/parser/schema.js';
import {processNext} from '../src/processor.js';
import {SupabaseStore} from '../src/store/supabase.js';
import {formatReceipt,formatCommand} from '../src/reply.js';
import {RelayError} from '../src/errors.js';
import type {Category,ParseResult,RawInput,Store,MemoryBackend} from '../src/contracts.js';
const categories:Category[]=[{id:1,code:'work',name:'工作',kind:'time',is_active:true},
  {id:2,code:'uncategorized',name:'待确认',kind:'time',is_active:true}];
const received='2026-06-18T02:52:05.819Z';
const exact='增加一个时间段，10:15~10:45写方案';
const parsed=()=>parseTimeCommand(exact,received,categories)!;
test('明确区间直接生成区间替换，未指定分类留待本人规则匹配',()=>{
  assert.deepEqual(parsed().time_replacements,[{start_at:'2026-06-18T02:15:00.000Z',end_at:'2026-06-18T02:45:00.000Z',activity:'写方案',category:'uncategorized',note:null}]);
  assert.equal(parsed().time_entries.length,0);assert.deepEqual(validateParse(parsed(),categories),parsed());
});
test('明确日期、全角符号和分类名或code均可用',()=>{
  for(const text of ['修改时段 2026-06-17 10:15-10:45 写方案 [工作]','补录昨天10点15分到10点45分写方案【work】']){
    const entry=parseTimeCommand(text,received,categories)!.time_replacements![0]!;
    assert.equal(entry.start_at,'2026-06-17T02:15:00.000Z');assert.equal(entry.category,'work');assert.equal(entry.activity,'写方案');
  }
});
test('默认日期取接收时刻的北京时间，夜间跨日明确推到次日',()=>{
  assert.equal(parseTimeCommand('补录 00:10-00:20 写作','2026-06-17T16:30:00Z',categories)!.time_replacements![0]!.start_at,'2026-06-17T16:10:00.000Z');
  const entry=parseTimeCommand('修改时段 昨天 23:30-00:20 写作',received,categories)!.time_replacements![0]!;
  assert.equal(entry.start_at,'2026-06-17T15:30:00.000Z');assert.equal(entry.end_at,'2026-06-17T16:20:00.000Z');
});
test('无效日历、钟点、倒序、未来和分类只追问，不生成写入',()=>{
  for(const text of ['补录 2026-02-30 10:00-11:00 写作','补录 24:10-24:20 写作','补录 10:60-11:00 写作',
    '补录 10:15-10:15 写作','补录 10:45-10:15 写作','补录 18:00-19:00 写作','补录 10:15-10:45 写作 [不存在]']){
    const value=parseTimeCommand(text,received,categories)!;assert.ok(value.clarify,text);assert.equal(value.time_replacements,undefined);
  }
  for(const text of ['现在开始写方案','把上一段改为写作','今天做什么？'])assert.equal(parseTimeCommand(text,received,categories),null);
});
test('不能混合整条纠错和区间替换，不能用追问夹带写入',()=>{
  assert.throws(()=>validateParse({...parsed(),time_corrections:[{target:{position:'current'},patch:{category:'work'}}]},categories),/PARSER_TIME_REPLACEMENT_CONFLICT/);
  assert.throws(()=>validateParse({...parsed(),clarify:'哪一天'},categories),/PARSER_CLARIFICATION_CONFLICT/);
});
test('时段命令绕过模型和云记忆，直接提交真实上下文',async()=>{
  const input={id:'input',owner_id:'owner',lease_token:'lease',text:exact,received_at:received,input_kind:'record',status:'pending',receipt_text:null} as RawInput;
  let committed:ParseResult|undefined,receipt='';const context={ongoing:[],accounts:[]};
  const store={claim:async()=>input,context:async()=>context,categories:async()=>categories,
    apply:async(_:RawInput,plan:ParseResult,actual:unknown)=>{assert.equal(actual,context);committed=plan;return {...input,status:'parsed',parse_result:{...plan}};},
    records:async()=>({time_entries:[],transactions:[]}),queueReceipt:async(_:RawInput,text:string)=>{receipt=text;},
    fail:async()=>{throw Error('must not fail');}} as unknown as Store;
  await processNext(store,{enabled:true,parse:async()=>{throw Error('must not call model');}},
    {search:async()=>{throw Error('must not recall');}} as unknown as MemoryBackend);
  assert.deepEqual(committed,parsed());assert.ok(receipt);
});
test('仓储先获取版本快照，再提交区间RPC，普通计划不携带可选字段',async()=>{
  const store=new SupabaseStore('https://example.invalid','synthetic-key','owner');const calls:Array<{name:string,args:Record<string,unknown>}>=[];
  const input={id:'input',owner_id:'owner',lease_token:'lease'} as RawInput;const targets=[{id:'old',revision:7}];
  store.client.rpc=(async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {data:name==='find_time_replacement_targets'?targets:input,error:null};}) as unknown as typeof store.client.rpc;
  await store.apply(input,parsed(),{accounts:[],ongoing:[]});
  assert.deepEqual(calls.map(x=>x.name),['find_time_replacement_targets','apply_time_replacements']);
  assert.deepEqual(calls[1]!.args.p_expected_targets,targets);assert.deepEqual(calls[1]!.args.p_expected_ongoing,[]);
  calls.length=0;await store.apply(input,{time_entries:[],transactions:[],clarify:null,time_replacements:[]});
  assert.equal(calls[0]!.name,'apply_steward');assert.equal(Object.hasOwn(calls[0]!.args.p_result as object,'time_replacements'),false);
  calls.length=0;await store.apply(input,{time_entries:[],transactions:[],clarify:null,time_replacements:[],
    time_corrections:[{target:{position:'current'},patch:{activity:'洗漱',category:'work'}}]});
  assert.deepEqual(calls.map(x=>x.name),['find_time_correction_targets','apply_time_corrections']);
  assert.equal(Object.hasOwn(calls[1]!.args.p_result as object,'time_replacements'),false);
  assert.equal(Object.hasOwn(calls[1]!.args.p_result as object,'time_corrections'),true);
});
test('回执来自已提交的原段与新片段，撤销成功与冲突分别说明',()=>{
  const text=formatReceipt({time_entries:[{start_at:'2026-06-18T01:51:00Z',end_at:'2026-06-18T02:15:00Z',activity:'洗漱',category:'生活自理',duration_min:24},
    {start_at:'2026-06-18T02:15:00Z',end_at:'2026-06-18T02:45:00Z',activity:'写方案',category:'工作',duration_min:30}],transactions:[]},
    {_time_replacements:{originals:[{before:{start_at:'2026-06-18T01:51:00Z',end_at:'2026-06-18T02:45:00Z',activity:'洗漱',category:'生活自理'}}]}});
  assert.match(text,/原：2026-06-18 09:51–10:45 洗漱/);assert.match(text,/写方案.*30分钟/);assert.match(text,/洗漱.*24分钟/);
  assert.match(formatCommand({parse_result:{command:'undo',replacement_undone:true,restored_replacement_records:1}} as unknown as RawInput),/恢复 1 条原记录/);
  assert.match(formatCommand({parse_result:{command:'undo',replacement_conflict:true}} as unknown as RawInput),/本次未撤销/);
});
test('无效事实查询转事务追问，网络及权限错误保持失败分类',async()=>{
  const store=new SupabaseStore('https://example.invalid','synthetic-key','owner');
  const input={id:'input',owner_id:'owner',lease_token:'lease'} as RawInput;
  const calls:string[]=[];
  store.client.rpc=(async(name:string,args:Record<string,unknown>)=>{
    calls.push(name);
    if(name==='find_time_replacement_targets')return {data:null,error:{code:'22023'}};
    assert.equal(args.p_expected_targets,null);return {data:input,error:null};
  }) as unknown as typeof store.client.rpc;
  await store.apply(input,parsed());assert.deepEqual(calls,['find_time_replacement_targets','apply_time_replacements']);
  store.client.rpc=(async()=>({data:null,error:{code:'42501'}})) as unknown as typeof store.client.rpc;
  await assert.rejects(store.apply(input,parsed()),new RelayError('DB_42501'));
});
