/**
 * [INPUT]: 合成订阅、时区边界和本机API替身。
 * [OUTPUT]: 七天筛选、准确金额及网络故障不产生提醒的证据。
 * [POS]: 订阅桥的业务验收；不访问真实账本或微信。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSubscriptions, sevenDayReminders, type Subscription } from '../src/subscription-reminders.js';
import { SupabaseStore } from '../src/store/supabase.js';

const subscription: Subscription = {id:'sub-test',name:'测试订阅',status:'active',auto_renew:1,
  next_renewal_on:'2027-01-07',amount_fen:12345,currency:'CNY'};

test('七天以北京时间跨年计算，不依赖API旧days_left或宿主时区',()=>{
  const before = new Date('2026-12-30T15:59:59Z');
  const after = new Date('2026-12-30T16:00:00Z');
  assert.equal(sevenDayReminders([subscription],before).length,0);
  const [reminder] = sevenDayReminders([subscription],after);
  assert.equal(reminder?.renewal_on,'2027-01-07');
  assert.match(reminder!.text,/¥123\.45/);
  assert.match(reminder!.text,/预计扣款/);
});

test('暂停、取消续费、零元和非七天日期不发扣款提醒',()=>{
  const items: Subscription[] = [subscription,
    {...subscription,id:'paused',status:'paused'}, {...subscription,id:'cancelled',status:'cancelled'},
    {...subscription,id:'manual',auto_renew:0}, {...subscription,id:'free',amount_fen:0},
    {...subscription,id:'six',next_renewal_on:'2027-01-06'},
    {...subscription,id:'eight',next_renewal_on:'2027-01-08'}];
  assert.deepEqual(sevenDayReminders(items,new Date('2026-12-31T02:00:00Z')).map(x=>x.subscription_id),['sub-test']);
});

test('闰年月末按实际日期加七天，金额保留币种与分',()=>{
  const [reminder] = sevenDayReminders([{...subscription,next_renewal_on:'2028-03-01',currency:'USD',amount_fen:1}],
    new Date('2028-02-23T01:00:00Z'));
  assert.match(reminder!.text,/\$0\.01/);
});

test('只请求固定回环API；不接受重定向、HTTP失败和坏数据',async()=>{
  const fake = (async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:18787/v1/subscriptions');
    assert.equal(options?.redirect,'error');
    return Response.json({items:[subscription]});
  }) as typeof fetch;
  assert.deepEqual(await readSubscriptions(fake),[subscription]);
  await assert.rejects(readSubscriptions((async()=>{throw new Error('private URL');}) as typeof fetch),
    {code:'SUBSCRIPTIONS_NETWORK_FAILED'});
  await assert.rejects(readSubscriptions((async()=>new Response('',{status:503})) as typeof fetch),
    {code:'SUBSCRIPTIONS_HTTP_503'});
  await assert.rejects(readSubscriptions((async()=>Response.json({items:[{...subscription,amount_fen:1.2}]})) as typeof fetch),
    {code:'SUBSCRIPTIONS_RESULT_INVALID'});
});

test('入队固定本人、当前微信绑定和续费日期；不接触浏览器领取凭据',async()=>{
  const owner='11111111-1111-4111-8111-111111111111';
  const store=new SupabaseStore('https://example.invalid','synthetic-key',owner);
  store.client.rpc=(async(name:string,args:unknown)=>{
    assert.equal(name,'enqueue_subscription_reminder');
    assert.deepEqual(args,{p_owner_id:owner,p_subscription_id:'sub-test',p_renewal_on:'2027-01-07',
      p_text:'提醒',p_wechat_account_id:'bot-new',p_wechat_user_id:'self'});
    return {data:{queued:true,reason:'queued'},error:null};
  }) as unknown as typeof store.client.rpc;
  assert.equal((await store.enqueueSubscriptionReminder({subscription_id:'sub-test',renewal_on:'2027-01-07',text:'提醒'},
    {accountId:'bot-new',userId:'self'})).queued,true);
});

test('回执查询排除已过期提醒，普通回执的空期限仍可投递',async()=>{
  const store=new SupabaseStore('https://example.invalid','synthetic-key','11111111-1111-4111-8111-111111111111');
  let filter='';
  const builder: Record<string,unknown> = {};
  for (const method of ['select','eq','is','not','lt','lte','order']) builder[method]=()=>builder;
  builder.or=(value:string)=>{filter=value;return builder;};
  builder.limit=async()=>({data:[],error:null});
  store.client.from=(()=>builder) as unknown as typeof store.client.from;
  assert.deepEqual(await store.pendingReceipts(),[]);
  assert.match(filter,/^reply_expires_at\.is\.null,reply_expires_at\.gt\.\d{4}-/);
});
