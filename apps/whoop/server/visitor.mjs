/**
 * [INPUT]: WHOOP工作库的设备记录、测量与同步时间。
 * [OUTPUT]: 重建后的公开指标；不包含原始ID、自述、偏好或授权。
 * [POS]: 访客健康投影；白名单输入复用正式分析与图表引擎。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {buildSnapshot} from './analytics.mjs';
import {buildGuidance} from './guidance.mjs';
import {buildInsights} from './insights.mjs';
import {buildPlan,planMarkdown} from './planner.mjs';
import {localClock,reportPreferences} from './calendar.mjs';
const numeric=(value,keys)=>Object.fromEntries(keys.filter(k=>Number.isFinite(value?.[k])).map(k=>[k,value[k]]));
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const scoreKeys={cycles:['strain','kilojoule','average_heart_rate','max_heart_rate'],
 recoveries:['recovery_score','resting_heart_rate','hrv_rmssd_milli','spo2_percentage','skin_temp_celsius'],
 sleeps:['sleep_performance_percentage','sleep_consistency_percentage','sleep_efficiency_percentage','respiratory_rate'],
 workouts:['strain','average_heart_rate','max_heart_rate','kilojoule','percent_recorded','distance_meter','altitude_gain_meter']};
export function visitorHealth(app,now=new Date()){
 const raw=app.store.dataset();
 const cycles=new Map(raw.cycles.map((r,i)=>[String(r.id),i+1]));
 const sleeps=new Map(raw.sleeps.map((r,i)=>[String(r.id),`sleep-${i+1}`]));
 const dataset=Object.fromEntries(Object.entries(raw).filter(([k])=>k in scoreKeys).map(([kind,rows])=>[kind,rows.map((r,i)=>{
  const score=numeric(r.score,scoreKeys[kind]);
  if(kind==='recoveries')score.user_calibrating=r.score?.user_calibrating===true;
  if(kind==='sleeps'){
   score.stage_summary=numeric(r.score?.stage_summary,['total_in_bed_time_milli','total_awake_time_milli','total_no_data_time_milli','total_light_sleep_time_milli','total_slow_wave_sleep_time_milli','total_rem_sleep_time_milli','sleep_cycle_count','disturbance_count']);
   score.sleep_needed=numeric(r.score?.sleep_needed,['baseline_milli','need_from_sleep_debt_milli','need_from_recent_strain_milli','need_from_recent_nap_milli']);
  }
  if(kind==='workouts')score.zone_durations=numeric(r.score?.zone_durations,['zone_zero_milli','zone_one_milli','zone_two_milli','zone_three_milli','zone_four_milli','zone_five_milli']);
  return {id:kind==='sleeps'?sleeps.get(String(r.id)):kind==='cycles'?cycles.get(String(r.id)):i+1,
   cycle_id:cycles.get(String(r.cycle_id)),sleep_id:sleeps.get(String(r.sleep_id)),start:date(r.start),end:date(r.end),
   timezone_offset:'+08:00',
   score_state:['SCORED','PENDING_SCORE','UNSCORABLE'].includes(r.score_state)?r.score_state:null,
   nap:r.nap===true,sport_id:Number.isInteger(r.sport_id)?r.sport_id:0,
   step_count:Number.isFinite(r.step_count)?r.step_count:null,score};
 })]));
 const body=numeric(app.store.get('body'),['height_meter','weight_kilogram','max_heart_rate']);
 const full=buildSnapshot(dataset,{range:90,now,body,settings:{},checkins:[]});
 const safeCheckins=app.store.checkins().filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)).map(r=>({date:r.date,energy:null,soreness:null,weight:null,nutrition:'••••',notes:'••••',symptoms:[]}));
 const rawSync=app.store.get('sync')||{};
 const sync={startedAt:date(rawSync.startedAt),finishedAt:date(rawSync.finishedAt)};
 const recent=sync.finishedAt&&now-Date.parse(sync.finishedAt)>=0&&now-Date.parse(sync.finishedAt)<=35*60000;
 const refresh={...sync,succeeded:Boolean(recent&&!rawSync.error),reason:recent&&!rawSync.error?null:'sync-required'};
 const plan=buildPlan(full,{targetDate:localClock(now,'Asia/Shanghai').date,now,settings:reportPreferences(),sync,refresh,trigger:'preview'});
 const publicPlan={...plan,revision:1,publication:{...plan.publication,message:'根据公开健康指标生成；私人偏好与自述未公开。'}};
 const plans=[{...publicPlan,markdown:planMarkdown(publicPlan)}];
 return Object.fromEntries([7,30,90].map(range=>{
  const data={...full,days:full.days.slice(-range),mode:'live',visitor:true,publicSync:sync,checkins:safeCheckins,checkin:null,publicPlans:plans};
  return [range,{...data,guidance:buildGuidance(data),insights:buildInsights(full,range)}];
 }));
}
