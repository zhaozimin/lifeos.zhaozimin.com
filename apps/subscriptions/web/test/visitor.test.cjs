/**
 * [INPUT]: JSDOM、原版订阅API与卡片、含敏感金丝雀的替身。
 * [OUTPUT]: 访客仍用原版卡片，金额账号不可在DOM取消遮罩，写入不发请求。
 * [POS]: 完整只读展示回归，不连接真实账本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
require('./setup.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {renderToString}=require('react-dom/server');
const {MemoryRouter}=require('react-router-dom');
const {api}=require('../src/api.ts');
const {SubRow}=require('../src/components/SubRow.tsx');
const {PrivacyProvider}=require('../src/components/Veil.tsx');
test('完整卡片保留Logo，价格账号强制符号化，访客写入不触网',async()=>{
 const previous=globalThis.fetch;const calls=[];
 document.documentElement.dataset.access='visitor';
 globalThis.fetch=async(path,options)=>{calls.push({path,options});assert.equal(path,'/api/visitor/subscriptions');return Response.json({items:[{id:'a'.repeat(24),name:'Demo Service',category:'AI',cycle:'monthly',status:'active',renewalDate:'2026-11-01',logoSrc:'/api/visitor/subscriptions/logo/'+'a'.repeat(24)}]});};
 try{
  const list=await api.listSubscriptions();assert.equal(list.items[0].amount_yuan,'••••');
  const item={...list.items[0],amount_yuan:'987654321.99',account_identifier:'PRIVATE-ACCOUNT@example.com'};
  const html=renderToString(React.createElement(MemoryRouter,null,React.createElement(PrivacyProvider,null,React.createElement('ul',null,React.createElement(SubRow,{item})))));
  assert.ok(html.includes('sub-card'));assert.ok(html.includes('/api/visitor/subscriptions/logo/'));assert.ok(html.includes('••••'));
  assert.ok(!html.includes('987654321'));assert.ok(!html.includes('PRIVATE-ACCOUNT'));
  const before=calls.length;await assert.rejects(api.updateSubscription(item.id,{name:'changed'}),/不能修改/);assert.equal(calls.length,before);
  assert.equal(calls[0].options.credentials,'omit');
 }finally{globalThis.fetch=previous;delete document.documentElement.dataset.access;}
});
