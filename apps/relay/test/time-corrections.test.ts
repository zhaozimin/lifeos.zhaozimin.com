/**
 * [INPUT]: 纠错计划、仓储RPC替身与数据库前后快照。
 * [OUTPUT]: 结构限制、版本提交路径和真实修改回执的证据。
 * [POS]: 微信纠错应用边界验收；不连接数据库或微信。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateParse} from '../src/parser/schema.js';
import {SupabaseStore} from '../src/store/supabase.js';
import {formatReceipt} from '../src/reply.js';
import type {Category,RawInput} from '../src/contracts.js';
const categories:Category[]=[{id:1,code:'work',name:'工作',kind:'time',is_active:true}];
const empty={time_entries:[],transactions:[],clarify:null};
const edit={target:{start_at:'2026-10-28T18:13:00+08:00',end_at:'2026-10-28T18:25:00+08:00'},
  patch:{activity:'写作',category:'work'}};
test('纠错只能选择时段与受限字段，不能生成任意SQL、记录编号或无分类活动',()=>{
  const good={...empty,time_corrections:[edit]};assert.deepEqual(validateParse(good,categories),good);
  for(const value of [
    {...empty,time_corrections:[{...edit,target:{id:'guessed-id'}}]},
    {...empty,time_corrections:[{...edit,patch:{activity:'写作'}}]},
    {...empty,time_corrections:[{...edit,patch:{deleted_at:'now'}}]},
    {...empty,time_corrections:[{...edit,patch:{category:'missing'}}]},
    {...empty,time_corrections:[{...edit,target:{}}]},
    {...good,clarify:'哪条？'},
  ])assert.throws(()=>validateParse(value,categories));
});
test('仓储先读真实候选，再将候选版本与计划一起提交；普通记录仍走原事务',async()=>{
  const owner='11111111-1111-4111-8111-111111111111';
  const store=new SupabaseStore('https://example.invalid','synthetic-key',owner);
  const raw={id:'input',owner_id:owner,lease_token:'lease'} as RawInput;
  const calls:string[]=[];const targets=[{count:1,matches:[{id:'real-id',revision:7}]}];
  store.client.rpc=(async(name:string,args:Record<string,unknown>)=>{
    calls.push(name);
    if(name==='find_time_correction_targets')return {data:targets,error:null};
    if(name==='apply_time_corrections')assert.deepEqual(args.p_expected_targets,targets);
    if(name==='apply_steward')assert.equal(Object.hasOwn(args.p_result as object,'time_corrections'),false);
    return {data:raw,error:null};
  }) as unknown as typeof store.client.rpc;
  await store.apply(raw,{...empty,time_corrections:[edit]});
  await store.apply(raw,{...empty,time_corrections:[]});
  assert.deepEqual(calls,['find_time_correction_targets','apply_time_corrections','apply_steward']);
});
test('回执使用数据库前后快照，包含分类和日期，不使用模型预写成功文本',()=>{
  const before={start_at:edit.target.start_at,end_at:edit.target.end_at,activity:'休息',category:'清醒休息'};
  const text=formatReceipt({time_entries:[],transactions:[]},{_time_corrections:[{before,
    after:{...before,activity:'写作',category:'工作'}}]});
  assert.match(text,/已修改/);assert.match(text,/原：2026-10-28 18:13–18:25 休息/);
  assert.match(text,/现：2026-10-28 18:13–18:25 写作 · 工作/);
  const overnight=formatReceipt({time_entries:[],transactions:[]},{_time_corrections:[{before,
    after:{...before,end_at:'2026-10-29T01:00:00+08:00'}}]});
  assert.match(overnight,/现：2026-10-28 18:13–2026-10-29 01:00/);
});
