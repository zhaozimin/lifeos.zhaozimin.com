/**
 * [INPUT]: 原版api与JSDOM，HTTP使用可观测的合成替身。
 * [OUTPUT]: 云端AAL2封装与本机维护入口的协议保真。
 * [POS]: 双构建传输回归；不发送真实请求或写账本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
require('./setup.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {api}=require('../src/api.ts');
test('本机入口保留原版PUT与图片路径',async()=>{
  const previous=globalThis.fetch;let received;
  globalThis.fetch=async(path,options)=>{received={path,options};return Response.json({logo_src:'/icons/123.jpg'});};
  try{
    const result=await api.updateSubscription('sub_test',{notes:'原话'});
    assert.equal(received.path,'/v1/subscriptions/sub_test');assert.equal(received.options.method,'PUT');
    assert.deepEqual(JSON.parse(received.options.body),{notes:'原话'});assert.equal(result.logo_src,'/icons/123.jpg');
  }finally{globalThis.fetch=previous;}
});
test('云端封装动作并仅改写图片字段，账号正文保持完整',async()=>{
  const previous=globalThis.fetch;let received;
  Object.defineProperty(document,'baseURI',{value:'https://lifeos.example/dashboard/subscriptions',configurable:true});
  globalThis.fetch=async(path,options)=>{received={path,options};return Response.json({logo_src:'/icons/123.jpg',notes:'/icons/原话',account_identifier:'test@example.com'});};
  try{
    const result=await api.updateSubscription('sub_test',{notes:'原话'});
    assert.equal(received.path,'/api/subscriptions/request');assert.equal(received.options.method,'POST');
    assert.deepEqual(JSON.parse(received.options.body),{method:'PUT',path:'/v1/subscriptions/sub_test',body:{notes:'原话'}});
    assert.equal(result.logo_src,'/api/subscriptions/icons/123.jpg');assert.equal(result.notes,'/icons/原话');assert.equal(result.account_identifier,'test@example.com');
  }finally{globalThis.fetch=previous;delete document.baseURI;}
});
