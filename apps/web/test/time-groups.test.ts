/**
 * [INPUT]: 大类时段、WHOOP来源和现有区间统计函数。
 * [OUTPUT]: 学习出行不混入工作、实睡扣除不重复、设备来源可辨的证据。
 * [POS]: 大类统计回归；不连接实际数据库或WHOOP。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {timeSummary,toSegment} from '../worker/native-data';
test('大类模式只统计工作，支持性质的学习和出行不混入工作总时间',()=>{
 const categories=[{id:1,name:'工作',nature:'core'},{id:2,name:'学习成长',nature:'support'},{id:3,name:'出行',nature:'support'}];
 const segments=categories.map((c,i)=>toSegment({id:String(i),revision:1,start_at:`2026-10-25T0${i+1}:00:00Z`,
  end_at:`2026-10-25T0${i+2}:00:00Z`,activity:c.name,category_id:c.id,tags:[],raw_inputs:{source:'wechat'}},categories));
 const summary=timeSummary(segments,'2026-10-25','2026-10-25',new Date('2026-10-26T00:00:00Z'),true);
 assert.equal(summary.groupOnly,true);assert.equal(summary.effectiveWorkMinutes,60);assert.equal(summary.grossWorkMinutes,60);
 assert.equal(summary.byCategory.length,3);
});
test('WHOOP的8小时区间扣1小时清醒后为7小时实睡，投影不再次扣减或冒充AI',()=>{
 const segment=toSegment({source:'whoop',data:{id:'sleep',revision:1,start_at:'2026-10-24T16:00:00Z',end_at:'2026-10-25T00:00:00Z',
  activity:'睡眠',category_id:1,deduction_minutes:60,tags:['whoop-sleep']}},[{id:1,name:'睡眠',nature:'recovery'}]);
 assert.equal(segment.source,'device');assert.equal(segment.grossMinutes,480);assert.equal(segment.pureMinutes,420);
 const summary=timeSummary([segment],'2026-10-25','2026-10-25',new Date('2026-10-26T00:00:00Z'),true);
 assert.equal(summary.byCategory[0].pureMinutes,420);assert.equal(summary.deductionMinutes,60);
});
