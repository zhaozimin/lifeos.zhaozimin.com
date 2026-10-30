/**
 * [INPUT]: Supabase仓储、RPC替身与含表情的历史消息。
 * [OUTPUT]: 数据库Unicode字符与JS字符串长度转换的边界证据。
 * [POS]: 仓储接口验收；不连接真实数据库或微信。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseStore } from '../src/store/supabase.js';
import type { RawInput } from '../src/contracts.js';
test('SQL最近对话含1000个表情时，不被UTF16长度误判为越界',async()=>{
 const store=new SupabaseStore('https://example.invalid','synthetic-key','11111111-1111-4111-8111-111111111111');
 const turn={text:'😀'.repeat(1000),reply:'👍'.repeat(1000),received_at:'2026-10-26T00:00:00Z'};
 store.client.rpc=(async(name:string,args:unknown)=>{
  assert.equal(name,'get_recent_dialogue');assert.deepEqual(args,{p_input_id:'synthetic-input'});
  return {data:[turn],error:null};
 }) as unknown as typeof store.client.rpc;
 assert.deepEqual(await store.dialogue({id:'synthetic-input'} as RawInput),[turn]);
});
