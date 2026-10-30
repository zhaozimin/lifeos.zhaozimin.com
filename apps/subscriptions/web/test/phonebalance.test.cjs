/**
 * [INPUT]: 依赖真实 React/Radix、JSDOM 和虚构余额 API
 * [OUTPUT]: 验证金色月数/余额圆环边界、详情切换、错误反馈与提交互斥
 * [POS]: 双模式订阅交互回归；不访问真实账本或运营商
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
require('./setup.cjs');
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { render, screen, fireEvent, cleanup, waitFor, act } = require('@testing-library/react');
const { MemoryRouter } = require('react-router-dom');
const { BalanceSettings } = require('../src/components/BalanceSettings.tsx');
const { BillingModeSettings } = require('../src/components/BillingModeSettings.tsx');
const { SubRow } = require('../src/components/SubRow.tsx');
const { PrivacyProvider } = require('../src/components/Veil.tsx');
const { api } = require('../src/api.ts');
const { EditorForm } = require('../src/pages/Editor.tsx');
const { Sheet, SheetContent } = require('../src/components/ui/sheet.tsx');
const { ConfirmProvider } = require('../src/components/ui/confirm.tsx');
const h = React.createElement;
const originalApi = { ...api };
function phone(changes = {}) {
  return {
    id: 'test-phone', name: '测试电话卡', website: 'phone.example.com', is_phone: true, billing_mode: 'balance', auto_charge_ready: false,
    amount_fen: 3000, amount_yuan: '30.00', cycle: 'monthly', cycle_days: null, auto_renew: true,
    status: 'active', display_status: 'active', next_renewal_on: '2026-11-01',
    balance_fen: null, balance_yuan: null, balance_stopped: false,
    balance_low: false, balance_cycles: 1, logo_src: '',
    days_left: 20, remain_ratio: 0.6, ...changes,
  };
}
afterEach(() => { cleanup(); Object.assign(api, originalApi); });

function card(item) {
  return h(MemoryRouter, null, h(PrivacyProvider, null, h('ul', null, h(SubRow, { item }))));
}
function ringRatio(ring) {
  const progress = ring.querySelector('circle[stroke-dasharray]');
  if (!progress) return 0;
  const [filled, empty] = progress.getAttribute('stroke-dasharray').split(' ').map(Number);
  return filled / (filled + empty);
}

test('看板电话卡用余额替换天数，10 元余额和 30 元订阅费显示三分之一', () => {
  const view = render(card(phone({ balance_fen: 1000, balance_yuan: '10.00', balance_low: true })));
  const ring = screen.getByRole('img', { name: '余额 10 元；订阅费 30 元；还差 20 元' });
  assert.equal(ring.querySelector('text').textContent, '10');
  assert.equal(ring.querySelectorAll('text')[1].textContent, '元');
  assert.equal(ring.querySelector('circle[stroke-dasharray]').getAttribute('stroke'), 'var(--balance-gold)');
  assert.ok(Math.abs(ringRatio(ring) - 1 / 3) < 1e-12);
  assert.equal(screen.queryByRole('group', { name: '测试电话卡充值' }), null);
  assert.equal(screen.queryByText('余额 ¥10'), null);
  assert.equal(view.container.querySelector('.phone-balance'), null);
  for (const name of ['+50', '+100', '自定义', '校准余额']) assert.equal(screen.queryByRole('button', { name }), null);
});

test('金色圆环足额只显示中文月数且不带月字，不足一期才显示余额和缺口', () => {
  const view = render(card(phone()));
  const unknown = screen.getByRole('img', { name: '余额未设置' });
  assert.equal(unknown.querySelector('text').textContent, '—');
  assert.equal(ringRatio(unknown), 0);
  const cases = [
    { balance: 0, fee: 3000, shown: '0', unit: '元', ratio: 0 },
    { balance: 2999, fee: 3000, shown: '29.99', unit: '元', ratio: 2999 / 3000 },
    { balance: 3000, fee: 3000, shown: '一', unit: '', ratio: 1 },
    { balance: 5999, fee: 3000, shown: '一', unit: '', ratio: 1 },
    { balance: 6000, fee: 3000, shown: '二', unit: '', ratio: 1 },
    { balance: 10000, fee: 3000, shown: '三', unit: '', ratio: 1 },
    { balance: 0, fee: 0, shown: '∞', unit: '', ratio: 1 },
    { balance: 1025, fee: 3075, shown: '10.25', unit: '元', ratio: 1 / 3 },
    { balance: 1234567, fee: 3000, shown: '四百一十一', unit: '', ratio: 1 },
  ];
  for (const value of cases) {
    view.rerender(card(phone({ balance_fen: value.balance, amount_fen: value.fee, days_left: -10, remain_ratio: 0, status: 'paused' })));
    const ring = screen.getByRole('img', { name: /余额|订阅费为 0/ });
    assert.equal(ring.querySelector('text').textContent, value.shown);
    assert.equal(ring.querySelectorAll('text')[1]?.textContent ?? '', value.unit);
    assert.equal(ring.querySelector('text').getAttribute('fill'), 'var(--balance-gold)');
    assert.ok(Math.abs(ringRatio(ring) - value.ratio) < 1e-12);
    if (value.fee > 0 && value.balance >= value.fee) assert.doesNotMatch(value.shown, /[0-9月]/);
    if (value.unit === '元') assert.ok(value.balance < value.fee);
  }
});

test('季付和年付以可支付的完整周期折合月数，自定义按 30 天向下折月', () => {
  const view = render(card(phone()));
  for (const value of [
    { cycle: 'quarterly', days: null, balance: 7500, shown: '六' },
    { cycle: 'yearly', days: null, balance: 7500, shown: '二十四' },
    { cycle: 'custom', days: 10, balance: 60000, shown: '六' },
    { cycle: 'custom', days: 10, balance: 3000, shown: '零' },
  ]) {
    view.rerender(card(phone({ cycle: value.cycle, cycle_days: value.days, balance_fen: value.balance })));
    const ring = screen.getByRole('img', { name: /余额可抵扣/ });
    assert.equal(ring.querySelector('text').textContent, value.shown);
    assert.equal(ring.querySelectorAll('text').length, 1);
    assert.equal(ringRatio(ring), 1);
  }
  view.rerender(card(phone({ cycle: 'yearly', amount_fen: 3000, balance_fen: 2999 })));
  const low = screen.getByRole('img', { name: '余额 29.99 元；订阅费 30 元；还差 0.01 元' });
  assert.equal(low.querySelector('text').textContent, '29.99');
  assert.ok(ringRatio(low) < 1);
});

test('电话卡也可选择自动扣款并显示期限进度', () => {
  render(card(phone({ billing_mode: 'auto_charge', balance_fen: 1000 })));
  const ring = screen.getByRole('img', { name: '还剩 20 天' });
  assert.equal(ring.querySelector('text').textContent, '20');
  assert.ok(Math.abs(ringRatio(ring) - 0.6) < 1e-12);
});

test('自动扣款式不显示余额入口', () => {
  render(h(BalanceSettings, { item: phone({ billing_mode: 'auto_charge' }) }));
  assert.equal(screen.queryByRole('button'), null);
});

test('非电话卡也支持余额充值和余额圆环', () => {
  const item = phone({ is_phone: false, name: '测试软件', cycle: 'yearly', balance_fen: 1000, balance_yuan: '10.00' });
  render(h(React.Fragment, null, card(item), h(BalanceSettings, { item })));
  assert.ok(screen.getByRole('img', { name: '余额 10 元；订阅费 30 元；还差 20 元' }));
  assert.ok(screen.getByRole('button', { name: '+50' }));
  assert.ok(screen.getByRole('button', { name: '+100' }));
  assert.ok(screen.getByRole('button', { name: '自定义' }));
});

test('50 和 100 快捷充值即时显示服务端余额', async () => {
  const calls = [];
  api.topUpBalance = async (id, amount, requestId) => {
    calls.push({ id, amount, requestId });
    return phone({ balance_yuan: amount + '.00', balance_fen: Number(amount) * 100 });
  };
  render(h(BalanceSettings, { item: phone() }));
  fireEvent.click(screen.getByRole('button', { name: '+50' }));
  await screen.findByText('余额 ¥50');
  fireEvent.click(screen.getByRole('button', { name: '+100' }));
  await screen.findByText('余额 ¥100');
  assert.deepEqual(calls.map((x) => x.amount), ['50', '100']);
  assert.notEqual(calls[0].requestId, calls[1].requestId);
});

test('自定义充值先校验小数位，默认金额留空', async () => {
  const calls = [];
  api.topUpBalance = async (id, amount) => { calls.push(amount); return phone({ balance_yuan: '12.35' }); };
  render(h(BalanceSettings, { item: phone() }));
  fireEvent.click(screen.getByRole('button', { name: '自定义' }));
  const input = screen.getByLabelText('充值金额（元）');
  assert.equal(input.value, '');
  fireEvent.change(input, { target: { value: '0.001' } });
  fireEvent.click(screen.getByRole('button', { name: '确认充值' }));
  assert.match(screen.getByRole('alert').textContent, /最多两位/);
  assert.equal(calls.length, 0);
  fireEvent.change(input, { target: { value: '12.35' } });
  fireEvent.click(screen.getByRole('button', { name: '确认充值' }));
  await screen.findByText('余额 ¥12.35');
  assert.deepEqual(calls, ['12.35']);
});

test('设置余额发送当前值，不调用充值接口', async () => {
  const calls = [];
  api.setBalance = async (id, amount) => { calls.push([id, amount]); return phone({ balance_yuan: '28.50' }); };
  api.topUpBalance = async () => { throw Error('不能充值'); };
  render(h(BalanceSettings, { item: phone() }));
  fireEvent.click(screen.getByRole('button', { name: '设置余额' }));
  fireEvent.change(screen.getByLabelText('当前余额（元）'), { target: { value: '28.50' } });
  fireEvent.click(screen.getByRole('button', { name: '保存余额' }));
  await screen.findByText('余额 ¥28.50');
  assert.deepEqual(calls, [['test-phone', '28.50']]);
});

test('连续点击只提交一次，失败重试使用同一个充值编号', async () => {
  let resolve;
  const pending = new Promise((r) => { resolve = r; });
  const ids = [];
  api.topUpBalance = async (id, amount, requestId) => { ids.push(requestId); return pending; };
  render(h(BalanceSettings, { item: phone() }));
  fireEvent.click(screen.getByRole('button', { name: '+50' }));
  fireEvent.click(screen.getByRole('button', { name: '+50' }));
  assert.equal(ids.length, 1);
  await act(async () => resolve(phone({ balance_yuan: '50.00' })));
  cleanup();
  let failed = true;
  const retries = [];
  api.topUpBalance = async (id, amount, requestId) => {
    retries.push(requestId);
    if (failed) { failed = false; throw Error('响应丢失，请重试'); }
    return phone({ balance_yuan: '50.00' });
  };
  render(h(BalanceSettings, { item: phone() }));
  fireEvent.click(screen.getByRole('button', { name: '+50' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '+50' }));
  await screen.findByText('余额 ¥50');
  assert.equal(retries.length, 2);
  assert.equal(retries[0], retries[1]);
});

test('充值结果在组件卸载后不得提交到其他编辑会话', async () => {
  let resolve;
  const pending = new Promise((r) => { resolve = r; });
  api.topUpBalance = () => pending;
  const calls = [];
  const view = render(h(BalanceSettings, { item: phone(), onUpdated: (value) => calls.push(value) }));
  fireEvent.click(screen.getByRole('button', { name: '+50' }));
  view.unmount();
  await act(async () => resolve(phone({ balance_yuan: '50.00' })));
  assert.deepEqual(calls, []);
});

test('余额不足时显示停止与恢复说明，充值后使用服务端的新周期', async () => {
  api.topUpBalance = async () => phone({ balance_yuan: '20.00', next_renewal_on: '2026-12-01', balance_low: true });
  const updated = [];
  render(h(BalanceSettings, { item: phone({ status: 'paused', balance_stopped: true, balance_yuan: '0.00' }), onUpdated: (x) => updated.push(x) }));
  assert.ok(screen.getByText('余额不足，已停止；充足后自动恢复。'));
  fireEvent.click(screen.getByRole('button', { name: '+50' }));
  await screen.findByText('2026-12-01 余额不足将停止。');
  await waitFor(() => assert.equal(updated[0].next_renewal_on, '2026-12-01'));
});

test('只读详情随计费刷新，编辑中的草稿不被远端余额刷新覆盖', async () => {
  let current = phone({ balance_yuan: '60.00', balance_fen: 6000, notes: '', category_id: 'cat_phone', logo_url: '' });
  Object.assign(api, {
    listMethods: async () => ({ items: [] }), listAccounts: async () => ({ items: [] }),
    listCategories: async () => ({ items: [{ id: 'cat_phone', name: '话费' }] }),
    getSubscription: async () => current, resolveLogo: async () => ({ logo_src: '' }),
  });
  render(h(MemoryRouter, null, h(PrivacyProvider, null, h(ConfirmProvider, null,
    h(Sheet, { open: true }, h(SheetContent, null, h(EditorForm, { id: current.id, onSaved() {}, onClosed() {} })))))));
  await screen.findByText('余额 ¥60');
  const panel = screen.getByRole('dialog');
  for (const name of ['+50', '+100', '自定义', '校准余额']) assert.ok(panel.contains(screen.getByRole('button', { name })));
  current = { ...current, balance_yuan: '10.00', balance_fen: 1000, balance_low: true };
  await act(async () => window.dispatchEvent(new Event('subos:changed')));
  await screen.findByText('余额 ¥10');
  fireEvent.click(screen.getByRole('button', { name: '编辑', exact: true }));
  const name = screen.getByLabelText('订阅名称');
  fireEvent.change(name, { target: { value: '未保存的名称' } });
  current = { ...current, name: '远端名称', balance_yuan: '0.00' };
  await act(async () => window.dispatchEvent(new Event('subos:changed')));
  assert.equal(name.value, '未保存的名称');
});

function editor(item, methods) {
  Object.assign(api, {
    listMethods: async () => ({ items: methods }), listAccounts: async () => ({ items: [] }),
    listCategories: async () => ({ items: [{ id: 'cat_ai', name: 'AI' }] }),
    getSubscription: async () => item, resolveLogo: async () => ({ logo_src: '' }),
  });
  return h(MemoryRouter, null, h(PrivacyProvider, null, h(ConfirmProvider, null,
    h(Sheet, { open: true }, h(SheetContent, null, h(EditorForm, { id: item.id, onSaved() {}, onClosed() {} }))))));
}
async function choose(label, option) {
  await waitFor(() => assert.equal(screen.getByRole('combobox', { name: label }).disabled, false));
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' });
  fireEvent.keyDown(await screen.findByRole('option', { name: option, exact: true }), { key: 'Enter' });
  await waitFor(() => assert.equal(screen.queryByRole('listbox'), null));
}

test('右侧面板保存两种订阅方式，保留余额并随方式显示入口', async () => {
  const method = { id: 'credit', name: '测试信用卡', account: '尾号 1234', kind: 'virtual_card', card_type: 'credit', status: 'active' };
  let item = phone({ is_phone: false, billing_mode: 'auto_charge', auto_charge_ready: true,
    payment_method_id: method.id, balance_yuan: '50.00', balance_fen: 5000, notes: '', logo_url: '', category_id: 'cat_ai' });
  const calls = [];
  render(editor(item, [method]));
  api.updateSubscription = async (id, payload) => { calls.push(payload); item = { ...item, ...payload }; return item; };
  await screen.findByRole('combobox', { name: '订阅方式' });
  await waitFor(() => assert.equal(screen.getByRole('button', { name: '编辑', exact: true }).disabled, false));
  assert.equal(screen.queryByRole('button', { name: '+50' }), null);
  fireEvent.click(screen.getByRole('button', { name: '编辑', exact: true }));
  await choose('订阅方式', '余额式订阅');
  assert.ok(screen.getByText('保存订阅方式后，即可设置余额或充值。'));
  fireEvent.click(screen.getByRole('button', { name: '更新', exact: true }));
  await screen.findByText('余额 ¥50');
  assert.equal(calls[0].billing_mode, 'balance');
  assert.equal(calls[0].expected_next_renewal_on, '2026-11-01');
  assert.ok(screen.getByRole('button', { name: '+50' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑', exact: true }));
  await choose('订阅方式', '自动扣款订阅');
  fireEvent.click(screen.getByRole('button', { name: '更新', exact: true }));
  await waitFor(() => assert.equal(calls.length, 2));
  assert.equal(calls[1].billing_mode, 'auto_charge');
  assert.equal(item.balance_fen, 5000);
  await waitFor(() => assert.equal(screen.queryByRole('button', { name: '+50' }), null));
});

test('自动扣款信用卡菜单仅提供正常信用卡，未绑定时给出配置提示', async () => {
  const methods = [
    { id: 'credit', name: '测试信用卡', kind: 'virtual_card', card_type: 'credit', status: 'active' },
    { id: 'debit', name: '测试借记卡', kind: 'physical_card', card_type: 'debit', status: 'active' },
    { id: 'frozen', name: '冻结信用卡', kind: 'virtual_card', card_type: 'credit', status: 'frozen' },
    { id: 'other', name: '其他支付', kind: 'other', card_type: '', status: 'active' },
  ];
  render(editor(phone({ billing_mode: 'auto_charge', notes: '', category_id: 'cat_ai', payment_method_id: null }), methods));
  await screen.findByText('尚未绑定正常状态的信用卡。点编辑选择信用卡后启用自动续期。');
  fireEvent.click(screen.getByRole('button', { name: '编辑', exact: true }));
  fireEvent.keyDown(screen.getByRole('combobox', { name: '扣款信用卡' }), { key: 'ArrowDown' });
  await screen.findByRole('option', { name: '测试信用卡', exact: true });
  for (const name of ['测试借记卡', '冻结信用卡', '其他支付']) assert.equal(screen.queryByRole('option', { name, exact: true }), null);
});

test('无需点击编辑，详情直接切换并保存两种方式，只提交计费字段', async () => {
  let item = phone({ billing_mode: 'auto_charge', balance_fen: 5000, balance_yuan: '50.00', notes: '' });
  render(editor(item, []));
  const calls = [];
  api.updateSubscription = async (id, payload) => { calls.push(payload); item = { ...item, ...payload }; return item; };
  await screen.findByRole('button', { name: '编辑', exact: true });
  assert.equal(screen.getByRole('combobox', { name: '订阅方式' }).disabled, false);
  await choose('订阅方式', '余额式订阅');
  await screen.findByText('已切换为余额式订阅，已保存。');
  assert.ok(screen.getByRole('button', { name: '+50' }));
  assert.ok(screen.getByRole('button', { name: '编辑', exact: true }));
  assert.equal(screen.queryByRole('button', { name: '更新', exact: true }), null);
  assert.deepEqual(calls[0], { billing_mode: 'balance', expected_next_renewal_on: '2026-11-01' });
  await choose('订阅方式', '自动扣款订阅');
  await screen.findByText('已切换为自动扣款订阅，已保存。');
  assert.equal(screen.queryByRole('button', { name: '+50' }), null);
  assert.equal(item.balance_fen, 5000);
  assert.equal(calls.length, 2);
});

test('切换失败在控件旁显示原因，保留原方式且可重试', async () => {
  const item = phone({ notes: '' });
  render(editor(item, []));
  let failed = true;
  api.updateSubscription = async (id, payload) => {
    if (failed) throw Error('测试网络失败，请重试');
    return { ...item, ...payload };
  };
  await screen.findByRole('button', { name: '编辑', exact: true });
  await choose('订阅方式', '自动扣款订阅');
  const error = await screen.findByRole('alert');
  assert.equal(error.textContent, '测试网络失败，请重试');
  assert.ok(error.parentElement.contains(screen.getByRole('combobox', { name: '订阅方式' })));
  assert.match(screen.getByRole('combobox', { name: '订阅方式' }).textContent, /余额式/);
  failed = false;
  await choose('订阅方式', '自动扣款订阅');
  await screen.findByText('已切换为自动扣款订阅，已保存。');
  assert.equal(screen.queryByRole('alert'), null);
});

test('充值提交期间禁止切换方式，切换提交期间禁止充值和编辑', async () => {
  const item = phone({ notes: '' });
  render(editor(item, []));
  let finishTopup, finishMode;
  api.topUpBalance = () => new Promise((resolve) => { finishTopup = resolve; });
  api.updateSubscription = () => new Promise((resolve) => { finishMode = resolve; });
  await screen.findByRole('button', { name: '+50' });
  fireEvent.click(screen.getByRole('button', { name: '+50' }));
  assert.equal(screen.getByRole('combobox', { name: '订阅方式' }).disabled, true);
  assert.equal(screen.getByRole('button', { name: '编辑', exact: true }).disabled, true);
  await act(async () => finishTopup({ ...item, balance_fen: 5000, balance_yuan: '50.00' }));
  await choose('订阅方式', '自动扣款订阅');
  assert.ok(screen.getByText('正在保存订阅方式…'));
  assert.equal(screen.getByRole('combobox', { name: '订阅方式' }).disabled, true);
  assert.equal(screen.getByRole('button', { name: '+50' }).disabled, true);
  await act(async () => finishMode({ ...item, billing_mode: 'auto_charge', balance_fen: 5000, balance_yuan: '50.00' }));
  assert.equal(screen.getByRole('combobox', { name: '订阅方式' }).disabled, false);
});

test('切换成功后，较早的详情刷新不得改回原方式', async () => {
  const item = phone({ billing_mode: 'auto_charge', notes: '' });
  render(editor(item, []));
  await screen.findByDisplayValue(item.name);
  await screen.findByRole('button', { name: '编辑', exact: true });
  let finishRead;
  api.getSubscription = () => new Promise((resolve) => { finishRead = resolve; });
  await act(async () => window.dispatchEvent(new Event('subos:changed')));
  await waitFor(() => assert.equal(typeof finishRead, 'function'));
  api.updateSubscription = async (id, payload) => ({ ...item, ...payload });
  await choose('订阅方式', '余额式订阅');
  await screen.findByText('已切换为余额式订阅，已保存。');
  await act(async () => finishRead(item));
  assert.match(screen.getByRole('combobox', { name: '订阅方式' }).textContent, /余额式/);
});

test('关闭设置后，迟到的方式切换结果不提交到其他会话', async () => {
  const item = phone();
  let finish;
  const updated = [];
  api.updateSubscription = () => new Promise((resolve) => { finish = resolve; });
  const view = render(h(BillingModeSettings, { item, value: item.billing_mode, editing: false, disabled: false,
    onDraftChange() {}, onUpdated: (value) => updated.push(value), onBusyChange() {} }));
  await choose('订阅方式', '自动扣款订阅');
  view.unmount();
  await act(async () => finish({ ...item, billing_mode: 'auto_charge' }));
  assert.deepEqual(updated, []);
});
