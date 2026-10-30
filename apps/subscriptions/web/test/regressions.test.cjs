/**
 * [INPUT]: 依赖真实 React/Radix、Testing Library 与本地 JSDOM，API 使用虚构数据
 * [OUTPUT]: 通知失败回执、取消状态入口、编辑会话竞态、脱敏 Portal、跨页刷新与路由回归
 * [POS]: web 的审计回归；操作真实组件 DOM，不以手写 hook 替身代替 React 生命周期
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
require('./setup.cjs');
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { render, screen, fireEvent, waitFor, cleanup, act } = require('@testing-library/react');
const { MemoryRouter } = require('react-router-dom');
const { api } = require('../src/api.ts');
const { PrivacyProvider } = require('../src/components/Veil.tsx');
const { ConfirmProvider } = require('../src/components/ui/confirm.tsx');
const { ShellProvider, useShell } = require('../src/shell.tsx');
const { BoardPage } = require('../src/pages/Board.tsx');
const { CardsPage } = require('../src/pages/Cards.tsx');
const { MethodsPage } = require('../src/pages/Methods.tsx');
const { Select } = require('../src/components/ui/select.tsx');
const { useAsyncScope } = require('../src/lib/asyncScope.ts');
const { subscribeRefresh } = require('../src/lib/refresh.ts');
const { deliverDueReminders } = require('../src/lib/notify.ts');
const h = React.createElement;
const originalApi = { ...api };
const emptySummary = { active_count: 0, paused_count: 0, ended_count: 0, soon_count: 0, overdue_count: 0, monthly_yuan: '0.00', yearly_yuan: '0.00', projected_yuan: '0.00', this_month_yuan: '0.00', by_category: [], curve: [] };
function defaults() {
  Object.assign(api, {
    listCategories: async () => ({ items: [] }), listAccounts: async () => ({ items: [] }),
    listMethods: async () => ({ items: [] }), listCards: async () => ({ items: [] }),
    listSubscriptions: async () => ({ items: [] }), summary: async () => emptySummary,
    reminders: async () => ({ items: [], due: [] }), cardAiStatus: async () => ({ available: false }),
  });
}
function wrapped(child, shell = false) {
  return h(MemoryRouter, null, h(PrivacyProvider, null, h(ConfirmProvider, null, shell ? h(ShellProvider, null, child) : child)));
}
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
function card(id, issuer, last4) { return { id, name: `卡${id}`, issuer, last4, kind: 'physical_card', card_type: 'credit', network: 'visa', status: 'active', currency: 'CNY', expiry_month: '', cover_key: '', cover_src: '', cover_source_url: '', note: '', subscription_count: 0 }; }
afterEach(() => { cleanup(); Object.assign(api, originalApi); localStorage.clear(); sessionStorage.clear(); delete window.Notification; delete globalThis.Notification; });

test('系统通知失败只释放失败条目，成功条目才回执', async () => {
  const due = ['失败', '成功'].map((name, n) => ({ id: String(n), name, wave: 7, next_renewal_on: '2026-09-13', amount_yuan: '10', delivery_token: String(n) }));
  const acked = [], released = [];
  class Notification { static permission = 'granted'; constructor(name) { if (name.startsWith('失败')) throw Error('系统拒绝'); } }
  globalThis.Notification = window.Notification = Notification;
  api.reminders = api.claimReminders = async () => ({ items: [], due });
  api.ackReminders = async (items) => acked.push(...items);
  api.releaseReminders = async (items) => released.push(...items);
  await deliverDueReminders();
  assert.deepEqual(acked.map((x) => x.name), ['成功']);
  assert.deepEqual(released.map((x) => x.name), ['失败']);
  assert.equal(JSON.parse(localStorage.getItem([...Array(localStorage.length)].map((_, i) => localStorage.key(i)).find((x) => x.startsWith('subos:notified:')))).length, 1);
});

test('取消未到期订阅在结束筛选可见，全部仍只含生效订阅', async () => {
  defaults();
  api.listSubscriptions = async () => ({ items: [{ id: 'cancelled', name: '取消但未到期', logo_src: '', status: 'cancelled', urgency: 'ok', category_id: null, days_left: 15, amount_yuan: '10', monthly_yuan: '10', cycle: 'monthly', website: 'example.com', next_renewal_on: '2026-09-21', remain_ratio: 0.5 }] });
  function Filter() { const { setFilter } = useShell(); return h('button', { onClick: () => setFilter('ended') }, '结束筛选'); }
  render(wrapped(h(React.Fragment, null, h(Filter), h(BoardPage)), true));
  await screen.findByText('这一栏是空的。');
  fireEvent.click(screen.getByText('结束筛选'));
  await screen.findByText('取消但未到期');
});

test('A 卡识别完成前关闭并打开 B，不得改写 B', async () => {
  defaults();
  api.listCards = async () => ({ items: [card('A', '甲银行', '1111'), card('B', '乙银行', '2222')] });
  const pending = deferred();
  api.identifyCard = () => pending.promise;
  render(wrapped(h(CardsPage)));
  const a = await screen.findByRole('button', { name: /甲银行.*卡A/ });
  fireEvent.click(a);
  const input = screen.getByPlaceholderText(/前 8 位|完整卡号/);
  fireEvent.change(input, { target: { value: '4242424242424242' } });
  fireEvent.click(screen.getByRole('button', { name: /识别卡片信息|联网识别|开始识别/ }));
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  fireEvent.click(screen.getByRole('button', { name: /乙银行.*卡B/ }));
  await act(async () => pending.resolve({ issuer: '旧请求甲银行', issuer_website: '', network: 'visa', card_type: 'credit', product: '', currency: 'USD', country_code: '', notice: '' }));
  assert.equal(screen.getByLabelText('发卡机构').value, '乙银行');
  assert.equal(screen.getByLabelText(/末 4 位/).value, '2222');
});

test('请求身份在新请求和卸载后失效，含 StrictMode 重挂载', async () => {
  let scope;
  function Probe() { scope = useAsyncScope(); return null; }
  const view = render(h(React.StrictMode, null, h(Probe)));
  const first = scope.begin();
  assert.equal(first(), true);
  const second = scope.begin();
  assert.equal(first(), false);
  assert.equal(second(), true);
  view.unmount();
  assert.equal(second(), false);
});

test('脱敏下拉 Portal 不输出真实账号文字', async () => {
  render(h(Select, { value: 'a', onValueChange() {}, sensitive: true, options: [{ value: 'a', label: 'private@example.com' }, { value: 'b', label: 'other@example.com' }] }));
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
  const options = await screen.findAllByRole('option');
  assert.equal(options.length, 2);
  assert.ok(options.every((option) => !option.textContent.includes('@example.com')));
});

test('设置弹窗账号使用脱敏输入模式', async () => {
  defaults(); sessionStorage.setItem('subos:veil', '1');
  api.listAccounts = async () => ({ items: [{ id: 'a', label: '测试账户', identifier: 'secret@example.com' }] });
  render(wrapped(h(MethodsPage)));
  fireEvent.click(await screen.findByText('测试账户'));
  assert.equal((await screen.findByLabelText('邮箱或用户名')).type, 'password');
});

test('统一刷新订阅只建立一个分钟时钟，响应跨标签变化并清理', () => {
  const originalSet = window.setInterval, originalClear = window.clearInterval;
  let tick, clears = 0, a = 0, b = 0;
  window.setInterval = (fn, delay) => { assert.equal(delay, 60000); assert.equal(tick, undefined); tick = fn; return 1; };
  window.clearInterval = () => { clears++; };
  try {
    const stopA = subscribeRefresh(() => a++), stopB = subscribeRefresh(() => b++);
    tick();
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'subos:changed', newValue: '1' }));
    assert.deepEqual([a, b], [2, 2]);
    stopA(); assert.equal(clears, 0);
    stopB(); assert.equal(clears, 1);
  } finally { window.setInterval = originalSet; window.clearInterval = originalClear; }
});

test('CLI/其他标签写入后，银行卡列表自动刷新', async () => {
  defaults(); let cards = [card('A', '甲银行', '1111')];
  api.listCards = async () => ({ items: cards });
  render(wrapped(h(CardsPage)));
  await screen.findByText('卡A');
  cards = [card('B', '乙银行', '2222')];
  await act(async () => window.dispatchEvent(new window.StorageEvent('storage', { key: 'subos:changed', newValue: '2' })));
  await screen.findByText('卡B');
  assert.equal(screen.queryByText('卡A'), null);
});

test('卡面异步解析在卸载后不得提交，保存前草稿保持会话边界', async () => {
  const { CardCoverPicker } = require('../src/components/CardCoverPicker.tsx');
  defaults();
  const pending = deferred(), resolved = [];
  api.resolveCardCover = () => pending.promise;
  const view = render(h(CardCoverPicker, {
    issuer: 'Example', product: 'Gold', network: 'visa', issuerWebsite: '', autoSearchVersion: 0,
    coverKey: '', coverSrc: '', coverSourceUrl: 'https://bank.example/card.png', onSourceUrlChange() {},
    onResolved: (cover) => resolved.push(cover), onClear() {}, onError() {}, onBusyChange() {},
  }));
  fireEvent.click(screen.getByText('没有找到？使用官网卡片页或图片地址'));
  fireEvent.click(screen.getByText('读取并缓存'));
  view.unmount();
  await act(async () => pending.resolve({ cover_key: 'a'.repeat(24) + '.png' }));
  assert.equal(resolved.length, 0);
});

test('照片自动生成前校验名称，含完整卡号时不调用 API', async () => {
  const { CardPhotoGenerator } = require('../src/components/CardPhotoGenerator.tsx');
  defaults();
  api.cardAiStatus = async () => ({ available: true });
  const calls = [], errors = [], canvases = [];
  api.generateCardCover = async (body) => { calls.push(body); return {}; };
  const originalBitmap = globalThis.createImageBitmap;
  const originalContext = window.HTMLCanvasElement.prototype.getContext;
  const originalDataUrl = window.HTMLCanvasElement.prototype.toDataURL;
  globalThis.createImageBitmap = async () => ({ width: 640, height: 400, close() {} });
  window.HTMLCanvasElement.prototype.getContext = function () { canvases.push(this); return { drawImage() {} }; };
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,TEST';
  try {
    render(h(CardPhotoGenerator, { issuer: 'Example', product: '4242 4242 4242 4242', network: 'visa', onResolved() {}, onError: (error) => errors.push(error), onBusyChange() {} }));
    await screen.findByText('AI 已就绪');
    const input = document.querySelector('input[type=file]');
    fireEvent.change(input, { target: { files: [new window.File(['image'], 'fixture.png', { type: 'image/png' })] } });
    await waitFor(() => assert.ok(errors.some((error) => error.includes('包含号码'))));
    assert.equal(calls.length, 0);
    assert.deepEqual(canvases.map((canvas) => [canvas.width, canvas.height]), [[32, 20]]);
  } finally {
    globalThis.createImageBitmap = originalBitmap;
    window.HTMLCanvasElement.prototype.getContext = originalContext;
    window.HTMLCanvasElement.prototype.toDataURL = originalDataUrl;
  }
});

test('Router 升级后主要页面与新增 Sheet 可达', async () => {
  const { App } = require('../src/App.tsx');
  defaults();
  for (const [path, title] of [['/cards', '银行卡'], ['/methods', '订阅设置'], ['/stats', '统计'], ['/new', '记下订阅']]) {
    window.history.replaceState({}, '', path);
    const view = render(h(App));
    if (path === '/new') await screen.findByRole('dialog');
    else await screen.findByRole('heading', { name: title, exact: true });
    await act(async () => {});
    view.unmount();
  }
  window.history.replaceState({}, '', '/');
});
