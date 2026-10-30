/**
 * [INPUT]: 解析契约、合成 JSON 与官方 CLI 替身。
 * [OUTPUT]: 自然回答、活动、账户、追问互斥与格式重试证据。
 * [POS]: 解析边界测试；不消耗模型额度，不冒充真实准确率测评。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Category, ParseResult } from '../src/contracts.js';
import { validateParse } from '../src/parser/schema.js';
import { AntigravityParser } from '../src/parser/antigravity.js';
import { cliEnvironment } from '../src/parser/runner.js';
import { decodeResponse } from '../src/parser/response.js';
import { RelayError } from '../src/errors.js';
import { formatDaily, money as formatMoney } from '../src/reply.js';
import { formatReceipt } from '../src/reply.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readStewardRules, verifyWorkspaceRules } from '../src/parser/rules.js';

const categories: Category[] = [
  { id: 1, code: 'uncategorized', name: '未分类时间', kind: 'time', is_active: true },
  { id: 2, code: 'uncategorized', name: '未分类收支', kind: 'money', is_active: true },
  { id: 3, code: 'work', name: '工作', kind: 'time', is_active: true },
  { id: 4, code: 'old', name: '停用', kind: 'money', is_active: false },
];
const empty: ParseResult = { time_entries: [], transactions: [], clarify: null };
const time = { start_at: '2026-10-24T10:00:00+08:00', end_at: '2026-10-24T11:20:00+08:00',
  category: 'work', activity: '写方案' };
const money = { occurred_at: '2026-10-24T12:00:00+08:00', direction: 'expense' as const,
  amount_cents: 3800, currency: 'CNY', category: 'uncategorized', account: 'wechat_pay', merchant: null, note: '午饭' };
const t = (value: object) => ({ ...empty, time_entries: [{ ...time, ...value }] });
const m = (value: object) => ({ ...empty, transactions: [{ ...money, ...value }] });
const valid: Array<[string, unknown]> = [
  ['时长八十分', t({})], ['明确起止', t({ start_at: '2026-10-24T01:00:00Z' })],
  ['昨晚跨午夜', t({ start_at: '2026-10-23T23:00:00+08:00', end_at: '2026-10-24T01:00:00+08:00' })],
  ['多段时间', { ...empty, time_entries: [time, { ...time, activity: '阅读' }] }],
  ['午饭三十八', m({})], ['小数换分', m({ amount_cents: 1990 })],
  ['收入', m({ direction: 'income', amount_cents: 100000 })],
  ['支付宝', m({ account: 'alipay' })], ['现金', m({ account: 'cash' })],
  ['未知账户', m({ account: null })], ['时间收支混合', { ...empty, time_entries: [time], transactions: [money] }],
  ['缺金额追问', { ...empty, clarify: '花了多少钱？' }], ['闲聊空数组', empty],
  ['未知分类兜底', t({ category: 'uncategorized' })],
];
for (const [name, value] of valid) test(`接受：${name}`, () => { validateParse(value, categories); });
const invalid: Array<[string, unknown]> = [
  ['浮点分', m({ amount_cents: 38.5 })], ['零金额', m({ amount_cents: 0 })],
  ['负金额', m({ amount_cents: -1 })], ['不安全整数', m({ amount_cents: Number.MAX_SAFE_INTEGER + 1 })],
  ['无时区', t({ start_at: '2026-10-24T10:00:00' })], ['非法日期', t({ start_at: '明天' })],
  ['倒序时间', t({ end_at: '2026-10-24T09:00:00+08:00' })], ['零时长', t({ end_at: time.start_at })],
  ['未知分类', m({ category: 'food' })], ['停用分类', m({ category: 'old' })],
  ['分类种类错误', m({ category: 'work' })], ['额外字段', { ...empty, sql: 'delete' }],
  ['追问与账目冲突', { ...m({}), clarify: '多少钱？' }], ['空追问', { ...empty, clarify: '' }],
  ['币种小写', m({ currency: 'cny' })], ['缺数组', { clarify: null }],
  ['新记外币', m({ currency: 'USD', amount_cents: 1234 })],
  ['过多记录', { ...empty, transactions: Array(51).fill(money) }],
];
for (const [name, value] of invalid) test(`拒绝：${name}`, () => { assert.throws(() => validateParse(value, categories)); });

const input = { text: '午饭38', received_at: '2026-10-24T04:00:00Z', categories, clarifications: [] };
const options = { binary: '/unused/agy', model: 'gemini-3.8-flash-high', workspace: '/unused' };
test('CLI 支持结构化字段和 response，错误 JSON 只补试一次且时间不变', async () => {
  let calls = 0; const prompts: string[] = [];
  const parser = new AntigravityParser(true, options, async (prompt) => {
    prompts.push(prompt); calls++;
    if (calls === 1) return { status: 'SUCCESS', response: 'wrong JSON' };
    return { status: 'SUCCESS', structured_output: m({}) };
  });
  const result = await parser.parse(input);
  assert.equal(result.transactions[0]?.amount_cents, 3800); assert.equal(calls, 2);
  assert.ok(prompts[1]!.startsWith(prompts[0]!));
  assert.match(prompts[1]!, /上次输出未通过机器校验/);
  assert.match(prompts[0]!, /2026-10-24T04:00:00Z/);
  assert.doesNotMatch(prompts[0]!, /"code":"old"/);
  const responseParser = new AntigravityParser(true, options, async () => ({ status: 'SUCCESS', response: JSON.stringify(empty) }));
  assert.deepEqual(await responseParser.parse(input), empty);
});
test('完整 JSON 代码块可解码，解释文字和多个对象不能被截取为账目', () => {
  for (const response of [JSON.stringify(empty), '```json\n' + JSON.stringify(empty) + '\n```',
    '```\n' + JSON.stringify(empty) + '\n```']) {
    assert.deepEqual(decodeResponse({ status: 'SUCCESS', response }), empty);
  }
  for (const response of ['这是结果：' + JSON.stringify(empty), JSON.stringify(empty) + '\n' + JSON.stringify(empty),
    '```javascript\n' + JSON.stringify(empty) + '\n```']) {
    assert.throws(() => decodeResponse({ status: 'SUCCESS', response }), { code: 'PARSER_JSON_INVALID' });
  }
});
test('空模型响应有明确错误码，格式纠正重试仍保留原始时间锚', async () => {
  for (const response of [undefined, null, '', '  \n']) {
    assert.throws(() => decodeResponse({ status: 'SUCCESS', response }), { code: 'PARSER_RESPONSE_EMPTY' });
  }
  const prompts: string[] = [];
  const parser = new AntigravityParser(true, options, async (prompt) => {
    prompts.push(prompt);
    return { status: 'SUCCESS', response: prompts.length === 1 ? '' : '```json\n' + JSON.stringify(empty) + '\n```' };
  });
  assert.deepEqual(await parser.parse(input), empty);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1]!, /PARSER_RESPONSE_EMPTY/);
  assert.ok(prompts[1]!.startsWith(prompts[0]!));
});
test('空响应最多调用两次，失败信封不能借结构化字段被当作成功', async () => {
  let calls = 0;
  await assert.rejects(new AntigravityParser(true, options, async () => {
    calls++; return { status: 'SUCCESS', response: '' };
  }).parse(input), { code: 'PARSER_RESPONSE_EMPTY' });
  assert.equal(calls, 2);
  assert.throws(() => decodeResponse({ status: 'ERROR', structured_output: empty }), { code: 'PARSER_REQUEST_FAILED' });
});
test('额度与进程错误不立即重复调用，禁用时完全不调用 CLI', async () => {
  let calls = 0;
  const run = async () => { calls++; throw new RelayError('PARSER_TIMEOUT'); };
  await assert.rejects(new AntigravityParser(true, options, run).parse(input), { code: 'PARSER_TIMEOUT' });
  assert.equal(calls, 1);
  await assert.rejects(new AntigravityParser(false, options, run).parse(input), { code: 'PARSER_DISABLED' });
  assert.equal(calls, 1);
});
test('数据库与微信密钥不传给 CLI 子进程', () => {
  assert.deepEqual(cliEnvironment({ HOME: '/home/lifeos', PATH: '/bin', SUPABASE_SERVICE_ROLE_KEY: 'secret',
    GOOGLE_API_KEY: 'not-used', WECHAT_TOKEN: 'private',MEMOS_API_KEY:'memory-private' }), { HOME: '/home/lifeos', PATH: '/bin' });
});

test('收入分类不能承接支出，未分类仍允许两种方向', () => {
  const list: Category[] = [...categories, { id: 5, code: 'income_only', name: '收入', kind: 'money',
    is_active: true, direction: 'income', keywords: ['收入'] }];
  assert.throws(() => validateParse(m({ category: 'income_only' }), list), { code: 'PARSER_CATEGORY_DIRECTION_INVALID' });
  validateParse(m({ category: 'income_only', direction: 'income' }), list);
  validateParse(m({ direction: 'income' }), list);
});
test('每日小结确定性展示币种与空白，不把大整数金额转成浮点', () => {
  const value=formatDaily({command:'daily',day:'2026-11-03',as_of:'2026-11-03T23:30:00+08:00',
    time:[{name:'写作',minutes:300}],money:[{currency:'CNY',direction:'expense',cents:'3800'},
      {currency:'USD',direction:'income',cents:'9007199254740993'}],covered_minutes:240,gap_minutes:1170,
    gaps:[{start_at:'2026-11-03T11:00:00+08:00',end_at:'2026-11-03T23:30:00+08:00',minutes:750}],
    gaps_truncated:true,gap_min_minutes:5});
  assert.match(value,/2026-11-03 今日小结/);assert.match(value,/支出 ¥38.00/);
  assert.match(value,/收入 \$90,071,992,547,409.93/);assert.match(value,/覆盖时长已去重/);
  assert.match(value,/11:00–23:30（750 分钟）/);
  assert.throws(()=>formatMoney(Number.MAX_SAFE_INTEGER+1),{code:'REPLY_AMOUNT_INVALID'});
  assert.equal(formatMoney(-50),'-¥0.50');
  assert.equal(formatMoney('-123456'),'-¥1,234.56');
});

test('活动切换有明确语义，stop 不得夹带新活动；追问不与切换一起提交', () => {
  const event = {action:'switch',at:time.start_at,activity:'写方案',category:'work',note:null};
  validateParse({...empty,time_events:[event]},categories);
  validateParse({...empty,time_events:[{...event,action:'stop',activity:null,category:null}]},categories);
  for(const value of [{...event,category:'不存在'}, {...event,action:'stop'}, {...event,activity:null}]) {
    assert.throws(()=>validateParse({...empty,time_events:[value]},categories),{code:'PARSER_TIME_EVENT_INVALID'});
  }
  assert.throws(()=>validateParse({...empty,time_events:[event],clarify:'几点？'},categories),{code:'PARSER_CLARIFICATION_CONFLICT'});
});
test('资金账户必须来自真实上下文；支付渠道不能冒充资金账户', () => {
  const context={accounts:[{name:'生活账户',type:'digitalWallet'}],ongoing:[]};
  assert.throws(()=>validateParse(m({}),categories,context),{code:'PARSER_ACCOUNT_REQUIRED'});
  assert.throws(()=>validateParse(m({funding_account:'wechat_pay'}),categories,context),{code:'PARSER_ACCOUNT_INVALID'});
  validateParse(m({funding_account:'生活账户'}),categories,context);
});
test('存档回执基于数据库标签；进行中与停止状态不伪造时长或笔记文件', () => {
  const snapshot={time_entries:[],transactions:[]};
  assert.equal(formatReceipt(snapshot,{archive_kind:'inspiration'}),'✓ 灵感原话已存数据库');
  assert.equal(formatReceipt(snapshot,{archive_kind:'diary'}),'✓ 日记原话已存数据库');
  assert.equal(formatReceipt(snapshot,{archive_kind:'emotion'}),'✓ 已存原话');
  assert.match(formatReceipt(snapshot,{unsupported:'obsidian_binding'}),/尚未连接本机 Obsidian/);
  assert.match(formatReceipt({time_entries:[{...time,category:'工作',end_at:null,duration_min:null}],transactions:[]}),/^▶ 写方案/);
  assert.equal(formatReceipt(snapshot,{_stopped_at:time.start_at}),'⏸ 10:00起暂停记录');
});

test('手报睡觉等待WHOOP校准，不将临时计时宣称为设备实睡',()=>{
 const text=formatReceipt({time_entries:[{...time,activity:'睡觉',category:'待确认',end_at:null,duration_min:null}],transactions:[]});
 assert.match(text,/等待WHOOP校准/);assert.doesNotMatch(text,/已校准|实睡/);
});
test('VPS AGENTS.md 必须与源提示词逐字一致，缺失或漂移阻止上线', async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'lifeos-steward-'));
  try {
    await assert.rejects(verifyWorkspaceRules(workspace),{code:'STEWARD_RULES_MISSING'});
    await writeFile(join(workspace,'AGENTS.md'),await readStewardRules());
    await verifyWorkspaceRules(workspace);
    await writeFile(join(workspace,'AGENTS.md'),'旧规则');
    await assert.rejects(verifyWorkspaceRules(workspace),{code:'STEWARD_RULES_MISMATCH'});
  }finally{await rm(workspace,{recursive:true,force:true});}
});

test('自然回答限长且不得和记账追问混交；回复保留实质回答和已提交账目',()=>{
  validateParse({...empty,answer:'可以，先说明你想解决的问题。'},categories);
  for(const answer of ['', ' '.repeat(2),'a'.repeat(3001),{content:'不能传对象'}]) {
    assert.throws(()=>validateParse({...empty,answer},categories),{code:'PARSER_SCHEMA_INVALID'});
  }
  assert.throws(()=>validateParse({...empty,clarify:'哪个账户？',answer:'已帮你记账。'},categories),
    {code:'PARSER_CLARIFICATION_CONFLICT'});
  assert.equal(formatReceipt({time_entries:[],transactions:[]},{archive_kind:'raw',answer:'先完成第一步，再验证效果。'}),
    '先完成第一步，再验证效果。');
  const reply=formatReceipt({time_entries:[],transactions:[money]}, {answer:'预算可以按周检查。'});
  assert.match(reply,/¥38.00/);assert.match(reply,/预算可以按周检查/);
});
