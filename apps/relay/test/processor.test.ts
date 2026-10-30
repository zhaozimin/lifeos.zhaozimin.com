/**
 * [INPUT]: 原话状态机、仓储替身和合成账目。
 * [OUTPUT]: 确定性停止取消、对话恢复、延期与账目回执证据。
 * [POS]: 应用业务验收；数据库事务另由 PostgreSQL 集成测试验证。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Parser, RawInput, Store } from '../src/contracts.js';
import {matchCommand} from '../src/contracts.js';
import { processNext } from '../src/processor.js';
import { money } from '../src/reply.js';
import { RelayError } from '../src/errors.js';
import { runWorker } from '../src/worker.js';
import pino from 'pino';

const raw = { id: 'raw', owner_id: 'self', text: '午饭38', received_at: '2026-10-24T04:00:00Z',
  input_kind: 'record', status: 'pending', lease_token: 'lease', revoked_at: null, receipt_text: null } as RawInput;
const empty = { time_entries: [], transactions: [], clarify: null };
function setup(input = raw) {
  const events: string[] = []; let receipt = ''; let command = '';
  const store = {
    claim: async () => input, categories: async () => [], clarifications: async () => ['补充'],
    context: async () => ({ accounts: [], ongoing: [] }),
    dialogue: async () => [],
    apply: async () => { events.push('commit'); return { ...input, status: 'parsed' }; },
    fail: async (_: RawInput, code: string) => { events.push(code); return { ...input, status: 'failed' }; },
    command: async (_: RawInput, value: string) => { command = value; return { ...input, status: 'parsed', parse_result: { command: value } }; },
    records: async () => { events.push('snapshot'); return { time_entries: [], transactions: [{
      occurred_at: raw.received_at, direction: 'expense', amount_cents: 3800, currency: 'CNY',
      category: '未分类收支', account: 'wechat_pay', note: '午饭' }] }; },
    queueReceipt: async (_: RawInput, text: string) => { events.push('receipt'); receipt = text; },
  } as unknown as Store;
  return { store, events, get receipt() { return receipt; }, get command() { return command; } };
}
test('先提交，再读取已入账快照生成回执；原始时间和补充原话交给模型', async () => {
  const state = setup();
  const parser: Parser = { enabled: true, parse: async (input) => {
    assert.equal(input.received_at, raw.received_at); assert.deepEqual(input.clarifications, ['补充']); return empty;
  } };
  await processNext(state.store, parser);
  assert.deepEqual(state.events, ['commit', 'snapshot', 'receipt']); assert.match(state.receipt, /¥38.00/);
});
test('额度错误只延期，回执明确已存原话', async () => {
  const state = setup();
  await processNext(state.store, { enabled: true, parse: async () => { throw new RelayError('PARSER_REQUEST_FAILED'); } });
  assert.deepEqual(state.events, ['PARSER_REQUEST_FAILED', 'receipt']); assert.match(state.receipt, /原话已保留.*重试/);
});
test('已提交但未生成回执时只恢复回执，不再调用模型', async () => {
  const state = setup({ ...raw, status: 'parsed' });
  await processNext(state.store, { enabled: true, parse: async () => { throw new Error('must not call'); } });
  assert.deepEqual(state.events, ['snapshot', 'receipt']);
});
test('系统小结复用回执恢复，不领取新的模型任务或生成账目', async () => {
  const state=setup({...raw,source:'system',text:'每日小结',input_kind:'command',status:'parsed',parse_result:{
    command:'daily',day:'2026-11-03',as_of:'2026-11-03T23:30:00+08:00',time:[],money:[],
    covered_minutes:0,gap_minutes:1410,gaps:[],gaps_truncated:false,gap_min_minutes:5,
  }});
  await processNext(state.store,{enabled:true,parse:async()=>{throw new Error('must not call model');}});
  assert.deepEqual(state.events,['receipt']);assert.equal(state.command,'');
  assert.match(state.receipt,/2026-11-03 今日小结/);
});
test('已撤销原话不解析，帮助指令不调用模型', async () => {
  const parser: Parser = { enabled: true, parse: async () => { throw new Error('must not call'); } };
  const revoked = setup({ ...raw, revoked_at: '2026-10-24T05:00:00Z' });
  await processNext(revoked.store, parser); assert.deepEqual(revoked.events, []);
  const help = setup({ ...raw, input_kind: 'command', text: '帮助' });
  await processNext(help.store, parser); assert.equal(help.command, 'help'); assert.match(help.receipt, /指令：今天、撤销、帮助/);
});
test('整数分格式化不会产生浮点尾差', () => {
  assert.equal(money(1), '¥0.01'); assert.equal(money(1990), '¥19.90');
  assert.equal(money(100001), '¥1,000.01'); assert.equal(money(1234, 'USD'), '$12.34');
});

test('停止和取消不调用模型或记忆检索，直接执行控制事务',async()=>{
 for(const [text,command] of [['停止计时！','stop'],['取消追问','cancel']] as const){
  const state=setup({...raw,input_kind:'command',text});
  state.store.command=async(_input,value)=>({...raw,input_kind:'command',status:'parsed',parse_result:{
   command:value,stopped_count:value==='stop'?1:0,_stopped_at:raw.received_at}});
  await processNext(state.store,{enabled:true,parse:async()=>{throw Error('must not call model');}},
   {search:async()=>{throw Error('must not recall');},submit:async()=>{throw Error('unused');},status:async()=>{throw Error('unused');}});
  assert.match(state.receipt,command==='stop'?/已停止计时/:/已取消待补充/);
 }
});

test('控制词完整匹配，不将活动叙述或问题误判成停止命令',()=>{
 assert.equal(matchCommand(' 停止计时！ '),'stop');assert.equal(matchCommand('取消追问'),'cancel');
 for(const text of ['停止学习，开始休息','为什么不能停止？','取消了吗？'])assert.equal(matchCommand(text),null);
});

test('最近对话送入模型；提交后的自然回答可恢复，不再次调用模型',async()=>{
  const state=setup();
  const dialogue=[{text:'我想先做内容，再做网站',reply:'可以分为两步。',received_at:raw.received_at}];
  state.store.dialogue=async()=>dialogue;
  state.store.records=async()=>({time_entries:[],transactions:[]});
  state.store.apply=async(_input,result)=>({...raw,status:'parsed',parse_result:{...result}});
  await processNext(state.store,{enabled:true,parse:async input=>{
    assert.deepEqual(input.dialogue,dialogue);
    return {...empty,archive_kind:'raw',answer:'第二步可以先搭一个展示页。'};
  }});
  assert.equal(state.receipt,'第二步可以先搭一个展示页。');
  const resumed=setup({...raw,status:'parsed',parse_result:{answer:'这是已经提交的回答。'}});
  resumed.store.records=async()=>({time_entries:[],transactions:[]});
  await processNext(resumed.store,{enabled:true,parse:async()=>{throw Error('must not re-run');}});
  assert.equal(resumed.receipt,'这是已经提交的回答。');
});

test('模型尚未返回时仍发送原话确认，模型调用保持单个', async () => {
  const stop = new AbortController();
  let release!: () => void; let acknowledged!: () => void; let modelStarted!: () => void;
  const parsing = new Promise<void>((resolve) => { release = resolve; });
  const sent = new Promise<void>((resolve) => { acknowledged = resolve; });
  const started = new Promise<void>((resolve) => { modelStarted = resolve; });
  let calls = 0; let finalCommitted = false;
  const state = setup();
  state.store.pendingReceipts = async () => [{ ...raw, receipt_text: '已存原话，正在整理。', receipt_revision: 0 }];
  state.store.replyTarget = async () => ({ user_id: 'self', context_token: 'test' });
  state.store.delivered = async () => {};
  const worker = runWorker(state.store, { enabled: true, parse: async () => {
    calls++; modelStarted(); await parsing; finalCommitted = true; return empty;
  } }, { run: async () => {}, reply: async () => { acknowledged(); } }, pino({ level: 'silent' }), stop.signal);
  const guard = setTimeout(() => { stop.abort(); release(); }, 2_000);
  try {
    await started; await sent;
    assert.equal(finalCommitted, false); assert.equal(calls, 1);
  } finally { clearTimeout(guard); stop.abort(); release(); await worker; }
});

test('云记忆不可用时照常回答；已召回片段作为只读上下文传入',async()=>{
 for(const unavailable of [false,true]){
  const state=setup();state.store.records=async()=>({time_entries:[],transactions:[]});
  state.store.apply=async(_i,result)=>({...raw,status:'parsed',parse_result:{...result}});
  await processNext(state.store,{enabled:true,parse:async input=>{
   assert.equal(input.memory_status,unavailable?'unavailable':'enabled');
   assert.equal(input.memories?.length,unavailable?0:1);
   return {...empty,answer:'可以继续回答当前问题。'};
  }},{search:async()=>{if(unavailable)throw Error('offline');return [{id:'m1',kind:'preference',content:'偏好先给结论'}];},
   submit:async()=>{throw Error('not called here');},status:async()=>{throw Error('not called here');}});
  assert.equal(state.receipt,'可以继续回答当前问题。');
 }
});
