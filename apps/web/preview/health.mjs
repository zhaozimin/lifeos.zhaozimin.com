/**
 * [INPUT]: WHOOP合成数据和既有纯分析、建议与计划引擎。
 * [OUTPUT]: 健康预览状态、趋势、计划和本机会话内自述。
 * [POS]: UI演示健康边界；不读取授权文件或刷新设备令牌。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {makeDemo} from '../../whoop/server/demo.mjs';
import {buildSnapshot} from '../../whoop/server/analytics.mjs';
import {buildGuidance,exportSummary} from '../../whoop/server/guidance.mjs';
import {buildInsights} from '../../whoop/server/insights.mjs';
import {buildPlan,planMarkdown} from '../../whoop/server/planner.mjs';
import {reportPreferences,localClock} from '../../whoop/server/calendar.mjs';
export function demoHealth(){
  const {dataset,body}=makeDemo();
  const settings={...reportPreferences(),goal:'提升体能与恢复',experience:'初学 / 重新开始',constraints:'',enabled:false};
  const checkins=[];
  const snapshot=(range=30)=>{
    const full=buildSnapshot(dataset,{range:90,now:new Date(),settings,body,checkins});
    const result={...full,days:full.days.slice(-range),mode:'demo'};
    return {...result,guidance:buildGuidance(result),insights:buildInsights(full,range)};
  };
  const plans=()=>{const data=snapshot(90),plan=buildPlan(data,{targetDate:localClock(new Date(),settings.timeZone).date,settings,now:new Date(),sync:{ok:true,finishedAt:new Date().toISOString()}});
    return {mode:'demo',plans:[{...plan,revision:1,publication:{state:'preview',message:'合成数据演示计划'},markdown:planMarkdown(plan)}]};};
  return (url,method,input)=>{
    const path=url.pathname.replace('/api/health','');
    if(method==='POST'){
      if(path==='/settings'){Object.assign(settings,input);return {ok:true};}
      if(path==='/checkins'){checkins.push(input);return {ok:true};}
      if(path==='/plans/generate')return {plan:plans().plans[0]};
      throw Object.assign(new Error('UI演示不连接WHOOP；同步请在正式站操作。'),{status:422});
    }
    if(path==='/status')return {connected:true,hasData:true,syncing:false,mode:'demo',settings,
      reports:{...settings,today:localClock(new Date(),settings.timeZone).date,preparationTime:'06:00',retryMinutes:5,generating:false,job:null},
      sync:{lastSuccessAt:new Date().toISOString()},ai:{enabled:false,engine:'演示规则'},intervalMinutes:30};
    if(path==='/dashboard')return snapshot(Number(url.searchParams.get('range')||30));
    if(path==='/plans')return plans();
    if(path==='/records')return {kind:url.searchParams.get('kind'),records:dataset[url.searchParams.get('kind')]||[]};
    if(path==='/summary')return exportSummary(snapshot());
    if(path==='/export')return {mode:'demo',records:dataset,daily:snapshot(90).days,body,checkins};
    throw Object.assign(new Error('此健康动作未纳入UI演示。'),{status:422});
  };
}
