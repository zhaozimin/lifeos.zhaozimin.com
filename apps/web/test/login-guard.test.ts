/**
 * [INPUT]: 可信来源头、内部限流服务和受控认证工厂。
 * [OUTPUT]: 限流先于认证、伪造来源无效和故障拒绝验收。
 * [POS]: 登录保护回归；不对生产账户尝试密码。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker/index';
import {guardLogin} from '../worker/login-guard';
import {authLimit} from '../../subscriptions/edge/auth-limit';
import type {Env,ClientFactory} from '../worker/auth';
const env:Env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',OWNER_AUTH_ID:'owner',OWNER_EMAIL:'owner@example.com',ASSETS:{fetch:async()=>new Response('static')}};
const request=(path='/api/auth/login',forward='198.51.100.1')=>new Request('https://lifeos.example'+path,{method:'POST',headers:{Origin:'https://lifeos.example','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1','X-Forwarded-For':forward},body:'{"password":"not-a-password"}'});
test('限流在认证客户端创建前拦截并提供重试时间',async()=>{
 let made=0;
 const worker=createWorker((()=>{made++;throw new Error('不应恢复会话');}) as ClientFactory);
 for(const path of ['/api/auth/login','/api/auth/verify','/api/auth/password','/api/auth/enroll']){
  const response=await worker.fetch(request(path),{...env,SUBSCRIPTIONS:{fetch:async()=>new Response(null,{status:429})}});
  assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'60');
 }
 assert.equal(made,0);
});
test('改变伪造转发IP不能改变限流身份；密码不传给限流器',async()=>{
 const keys:string[]=[];
 const service={fetch:async(r:Request)=>{const text=await r.text();assert.ok(!text.includes('not-a-password'));keys.push(JSON.parse(text).key);return new Response(null,{status:204});}};
 await guardLogin(request(),{...env,SUBSCRIPTIONS:service});
 await guardLogin(request('/api/auth/verify','203.0.113.99'),{...env,SUBSCRIPTIONS:service});
 assert.equal(keys[0],keys[1]);assert.match(keys[0],/^[a-f0-9]{64}$/);
});
test('缺失绑定、缺失可信来源、内部服务错误均拒绝放行',async()=>{
 await assert.rejects(guardLogin(request(),env),{status:503});
 const noPeer=request();noPeer.headers.delete('CF-Connecting-IP');
 await assert.rejects(guardLogin(noPeer,{...env,SUBSCRIPTIONS:{fetch:async()=>new Response(null,{status:204})}}),{status:503});
 for(const service of [{fetch:async()=>new Response(null,{status:500})},{fetch:async()=>{throw new Error('unavailable');}}])await assert.rejects(guardLogin(request(),{...env,SUBSCRIPTIONS:service}),{status:503});
});
test('认证尝试共用原生限流窗口，失败或缺失绑定均不放行',async()=>{
 let calls=0;
 const limiter={limit:async()=>({success:++calls<=6})};
 const make=()=>new Request('https://internal/internal/auth/limit',{method:'POST',body:JSON.stringify({key:'a'.repeat(64)})});
 for(let i=0;i<6;i++)assert.equal((await authLimit(make(),limiter)).status,204);
 const denied=await authLimit(make(),limiter);assert.equal(denied.status,429);
 assert.equal((await authLimit(make())).status,503);
 assert.equal((await authLimit(make(),{limit:async()=>{throw new Error('failure');}})).status,503);
});
test('公网HTTP先转到HTTPS，不恢复会话；HTTPS响应带HSTS',async()=>{
 const worker=createWorker((()=>{throw new Error('不应创建认证客户端');}) as ClientFactory);
 const redirected=await worker.fetch(new Request('http://lifeos.example/dashboard/login'),env);
 assert.equal(redirected.status,308);assert.equal(redirected.headers.get('Location'),'https://lifeos.example/dashboard/login');
 const secure=await worker.fetch(new Request('https://lifeos.example/dashboard/time/day'),env);
 assert.equal(secure.headers.get('Strict-Transport-Security'),'max-age=31536000');
});
