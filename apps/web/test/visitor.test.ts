/**
 * [INPUT]: Worker、受控匿名客户端及含私有字段的服务替身。
 * [OUTPUT]: 公开路由白名单、Cookie隔离及银行卡和写入拒绝验收。
 * [POS]: 访客网络边界回归；不连接生产数据。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker/index';
import type {Env,ClientFactory} from '../worker/auth';
import {configureAccess,nativeEndpoint} from '../src/access';
import {formatCurrency,formatPercent} from '../src/dashboard/fin/lib/format';
import {financialOption} from '../src/dashboard/fin/lib/presentation';
const env:Env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',OWNER_AUTH_ID:'owner',OWNER_EMAIL:'private@example.com',ASSETS:{fetch:async()=>new Response('assets')}};
function fixture(){
 const calls:any[]=[];let authCalls=0;
 const client={auth:{setSession:async()=>{authCalls++;throw new Error('PUBLIC_MUST_NOT_RESTORE_OWNER');}},from:()=>{throw new Error('PUBLIC_MUST_NOT_READ_TABLES');},
  rpc:async(name:string,args:any)=>{calls.push({name,args});return {error:null,data:name==='visitor_policy'?true:name==='visitor_finance'?[{id:'public-event',day:'2026-10-26',kind:'expense',category:'餐饮'}]:name==='visitor_time'?{categories:[{id:1,name:'工作',nature:'core',code:'work',is_active:true}],entries:[{id:'demo',start_at:'2026-10-26T01:00:00Z',end_at:'2026-10-26T02:00:00Z',category_id:1,activity:'工作',deduction_minutes:0,source:'web',note:'PRIVATE-CANARY',project:'PRIVATE-CANARY',tags:['PRIVATE-CANARY']}]}:null};}};
 return {worker:createWorker((()=>client) as unknown as ClientFactory),calls,get authCalls(){return authCalls;}};
}
const req=(path:string,value?:unknown)=>new Request('https://lifeos.example'+path,{method:value?'POST':'GET',headers:{Origin:'https://lifeos.example','Content-Type':'application/json',Cookie:'__Host-lifeos-access=secret; __Host-lifeos-refresh=secret'},body:value?JSON.stringify(value):undefined});
test('公开请求忽略本人Cookie，仅调用固定投影RPC并清除备注项目',async()=>{
 const f=fixture();const r=await f.worker.fetch(req('/api/visitor/native',{method:'GET',path:'/v1/time/segments',params:{from:'2026-10-26T00:00',to:'2026-10-27T00:00',owner:'attacker'}}),env);
 assert.equal(r.status,200);const text=await r.text();assert.ok(!text.includes('PRIVATE-CANARY'));assert.equal(f.authCalls,0);
 assert.deepEqual(Object.keys(f.calls[0].args).sort(),['p_from','p_to']);assert.match(r.headers.get('Cache-Control')||'',/no-store/);
});
test('银行卡、导出、修改和健康后台操作不在公开白名单',async()=>{
 for(const value of [{method:'GET',path:'/v1/fin/accounts'},{method:'POST',path:'/v1/time/segments',body:{}},{method:'GET',path:'/v1/time/audit/events'},{method:'GET',path:'/v1/fin/export/xlsx'}]){
  const f=fixture();assert.equal((await f.worker.fetch(req('/api/visitor/native',value),env)).status,403);assert.equal(f.calls.length,0);
 }
 for(const path of ['/api/visitor/cards','/api/visitor/health/export','/api/visitor/health/records','/api/visitor/health/jobs/test']){
  const f=fixture();assert.equal((await f.worker.fetch(req(path),env)).status,403);assert.equal(f.calls.length,0);
 }
});
test('订阅公开入口固定目标，返回多余敏感字段时失败关闭',async()=>{
 const f=fixture();let url='';const service={fetch:async(r:Request)=>{url=r.url;return Response.json({items:[{id:'a'.repeat(24),logoSrc:'/api/visitor/subscriptions/logo/'+'a'.repeat(24),name:'Demo',category:'AI',cycle:'monthly',status:'active',renewalDate:'2026-11-01'}]});}};
 const ok=await f.worker.fetch(req('/api/visitor/subscriptions'),{...env,SUBSCRIPTIONS:service});assert.equal(ok.status,200);assert.equal(url,'https://subos.internal/v1/visitor/catalog-v2');
 const bad=await f.worker.fetch(req('/api/visitor/subscriptions'),{...env,SUBSCRIPTIONS:{fetch:async()=>Response.json({items:[{name:'Demo',category:'AI',cycle:'monthly',status:'active',renewalDate:'2026-11-01',amount:999,account:'PRIVATE'}]})}});
 assert.equal(bad.status,400);assert.ok(!(await bad.text()).includes('PRIVATE'));
});
test('界面切换只选择API地址，权限继续由服务端校验',()=>{
 configureAccess(false);assert.equal(nativeEndpoint(),'/api/visitor/native');configureAccess(true);assert.equal(nativeEndpoint(),'/api/native');
});
test('完整财务契约没有金额，格式化和图表悬浮统一返回固定符号',async()=>{
 const f=fixture(),response=await f.worker.fetch(req('/api/visitor/native',{method:'GET',path:'/v1/fin/transactions'}),env);
 assert.equal(response.status,200);const rows=await response.json() as any[];assert.equal(rows[0].amount,null);assert.equal(rows[0].amountInBaseCurrency,null);assert.equal(rows[0].accountName,'账户 ••••');assert.equal(rows[0].merchant,'••••');
 configureAccess(false);
 try{
  assert.equal(formatCurrency(987654321),'••••');assert.equal(formatPercent(72.3),'••••');
  const option=financialOption({yAxis:{type:'value'},tooltip:{},series:[{type:'bar',data:[1,2]}]}) as any;
  assert.equal(option.yAxis.axisLabel.formatter(987654321),'••••');assert.ok(!option.tooltip.formatter({name:'餐饮',value:987654321}).includes('987654321'));
 }finally{configureAccess(true);}
});
test('公开Logo固定代理图标，不能转发Cookie或任意目标',async()=>{
 const f=fixture();let seen:Request|undefined;
 const r=await f.worker.fetch(req('/api/visitor/subscriptions/logo/'+'a'.repeat(24)),{...env,SUBSCRIPTIONS:{fetch:async request=>{seen=request;return new Response('png',{headers:{'Content-Type':'image/png','Set-Cookie':'PRIVATE'}});}}});
 assert.equal(r.status,200);assert.equal(seen?.url,'https://subos.internal/v1/visitor/logo/'+'a'.repeat(24));assert.equal(seen?.headers.get('Cookie'),null);assert.equal(r.headers.get('Set-Cookie'),null);
});
