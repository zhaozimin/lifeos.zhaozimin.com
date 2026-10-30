/**
 * [INPUT]: 含敏感金丝雀的合成设备数据、身体测量和自述。
 * [OUTPUT]: 公开指标保真与身份、自由文本隔离验收。
 * [POS]: 健康公开边界回归；不读取真实设备或工作库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo} from '../server/demo.mjs';
import {visitorHealth} from '../server/visitor.mjs';
test('公开健康从白名单重建，新增私有字段也不会向访客传播',()=>{
 const now=new Date('2026-10-26T14:00:00Z'),raw=makeDemo(now);const secret='PRIVATE-CANARY-DO-NOT-PUBLISH';
 for(const rows of Object.values(raw.dataset))for(const row of rows){row.user_id=secret;row.profile={name:secret};row.notes=secret;row.sport_name=secret;}
 const original=JSON.stringify(raw.dataset);
 const app={store:{dataset:()=>raw.dataset,get:()=>({...raw.body,notes:secret,user_id:secret}),checkins:()=>[{notes:secret}]}};
 const value=visitorHealth(app,now),text=JSON.stringify(value);
 assert.ok(!text.includes(secret));assert.ok(!text.includes('demo-sleep-'));assert.ok(!text.includes('10089'));
 assert.equal(value[30].latest.recovery,78);assert.equal(value[30].latest.sleepHours,7.75);
 assert.ok(value[90].insights);assert.deepEqual(value[30].checkins,[]);assert.equal(value[30].constraints,'');
 assert.equal(JSON.stringify(raw.dataset),original);
});

test('公开建议使用白名单同步凭据，旧同步保留等待状态',()=>{
 const now=new Date('2026-10-26T14:00:00Z'),raw=makeDemo(now);
 const app={store:{dataset:()=>raw.dataset,get:key=>key==='body'?raw.body:{startedAt:'2026-10-26T13:59:00Z',finishedAt:'2026-10-26T14:00:00Z',error:null,private:'SYNC-PRIVATE-CANARY'},checkins:()=>[]}};
 const value=visitorHealth(app,now)[30];
 assert.equal(value.publicPlans[0].publication.state,'preview');
 assert.ok(!JSON.stringify(value).includes('SYNC-PRIVATE-CANARY'));
 assert.deepEqual(Object.keys(value.publicSync),['startedAt','finishedAt']);
 assert.equal(visitorHealth(app,new Date('2026-10-26T15:00:00Z'))[30].publicPlans[0].publication.state,'waiting');
});
