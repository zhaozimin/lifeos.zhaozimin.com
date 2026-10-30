/**
 * [INPUT]: 订阅网络边界与受控私有服务替身。
 * [OUTPUT]: 固定目标、方法、头与敏感字段保真的回归。
 * [POS]: 订阅集成测试，不连接真实账本或产生付款。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import edge,{allowedRequest} from '../../subscriptions/edge/index';
import {subscriptions} from '../worker/subscriptions';
test('订阅私有代理固定回环地址，不向源站转发Cookie或Origin',async()=>{
  let captured:Request|undefined;
  const response=await edge.fetch(new Request('https://private/v1/subscriptions/sub_test',{method:'PUT',headers:{Cookie:'secret',Origin:'https://lifeos.example'},body:JSON.stringify({note:'保留原话'})}),{SUBOS_ORIGIN:{fetch:async request=>{
    captured=request;return Response.json({note:'保留原话'});
  }}});
  assert.equal(response.status,200);assert.equal(captured?.url,'http://127.0.0.1:18787/v1/subscriptions/sub_test');
  assert.equal(captured?.headers.get('Cookie'),null);assert.equal(captured?.headers.get('Origin'),null);
  assert.deepEqual(await captured?.json(),{note:'保留原话'});assert.equal(response.headers.get('Cache-Control'),'private, no-store');
});
test('订阅白名单拒绝任意目标、凭据配置、文件与非法方法',()=>{
  for(const path of ['/etc/passwd','/v1/card-cover/ai-key','/v1/../../etc','/icons/%2fsecret','/card-covers/../secret'])assert.equal(allowedRequest(path,'POST'),false,path);
  assert.equal(allowedRequest('/v1/subscriptions/sub_a/top-up','POST'),true);
  assert.equal(allowedRequest('/v1/cards/card_a','DELETE'),true);
  assert.equal(allowedRequest('/v1/subscriptions','PATCH'),false);
});
test('同源动作封装保留方法和正文，图片路径不经过任意URL代理',async()=>{
  let request:Request|undefined;
  const service={fetch:async (r:Request)=>{request=r;return Response.json({ok:true});}};
  await subscriptions(service,new URL('https://lifeos.example/api/subscriptions/request'),'POST',{method:'POST',path:'/v1/subscriptions/sub_a/top-up',body:{request_id:'stable',amount_yuan:'10'}});
  assert.equal(request?.method,'POST');assert.equal(new URL(request!.url).pathname,'/v1/subscriptions/sub_a/top-up');
  assert.deepEqual(await request?.json(),{request_id:'stable',amount_yuan:'10'});
  await assert.rejects(()=>subscriptions(service,new URL('https://lifeos.example/api/subscriptions/request'),'POST',{method:'GET',path:'https://outside.example'}));
});
