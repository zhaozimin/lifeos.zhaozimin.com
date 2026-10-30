/**
 * [INPUT]: 原版工作库、已校验的快照、Supabase发布凭据。
 * [OUTPUT]: 本人及访客健康副本、时间校准与受限操作回执。
 * [POS]: WHOOP唯一云端出口；浏览器写入先排队，本地API复用既有校验。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { exportSummary } from './guidance.mjs';
import { localClock } from './calendar.mjs';
import { planMarkdown } from './planner.mjs';
import {visitorHealth} from './visitor.mjs';

export function publicStatus(app) {
  const s=app.status();
  return {connected:s.connected,syncing:s.syncing,sync:s.sync,authorizationError:s.authorizationError,
    hasData:s.hasData,settings:s.settings,reports:s.reports,intervalMinutes:30,
    ai:{enabled:false,engine:'恢复规则 · v2'},cloud:true};
}
export function publication(app) {
  const status=publicStatus(app),dataset=app.store.dataset();
  const plans=app.store.plans(app.reports.preferences().timeZone);
  const dashboards=Object.fromEntries([7,30,90].map(n=>[`dashboard:${n}`,app.snapshot(false,n)]));
  const full=dashboards['dashboard:90'];
  const histories=app.store.db.prepare('select payload from plans order by target_date,time_zone,revision').all().map(r=>JSON.parse(r.payload));
  return {records:Object.entries(dataset).flatMap(([kind,rows])=>rows.map(payload=>({kind,
    id:String(kind==='recoveries'?payload.cycle_id:payload.id),payload}))),plans:histories,
    values:{status,...dashboards,plans:{mode:'live',plans:plans.map(p=>({...p,markdown:planMarkdown(p)}))},summary:exportSummary(full),
      export:{mode:'live',exportedAt:new Date().toISOString(),dailyRangeDays:90,records:dataset,
        daily:full.days,workouts:full.workouts,checkins:full.checkins,body:full.body,plans}}};
}
export function morningText(plan) {
  if(plan.publication?.state!=='published')throw new Error('PLAN_NOT_PUBLISHED');
  const m=plan.basis.metrics;
  const sleep=typeof m.sleepHours==='number'?`${m.sleepHours.toFixed(1)}小时`:'未就绪';
  return [`${plan.targetDate} 今日运动计划`,
    `恢复 ${m.recovery??'未就绪'}% · 睡眠 ${sleep}`,
    `${plan.exercise.mode}${typeof plan.exercise.minutes==='number'?` · ${plan.exercise.minutes}分钟`:''}`,
    ...plan.exercise.steps.map(s=>`· ${s}`),plan.exercise.adjustment,
    `依据：当天已评分睡眠与恢复，${plan.timeZone}。`,
    '若身体不适，以实际感受和医嘱为先。',
    '完整数据与计划：https://lifeos.zhaozimin.com/dashboard/health'].join('\n').slice(0,3400);
}
export class CloudBridge {
  constructor(app,{url,key,ownerId},fetcher=fetch){
    this.app=app;this.url=url;this.key=key;this.ownerId=ownerId;this.fetcher=fetcher;
  }
  async rpc(name,args){
    const res=await this.fetcher(`${this.url}/rest/v1/rpc/${name}`,{method:'POST',
      headers:{apikey:this.key,Authorization:`Bearer ${this.key}`,'Content-Type':'application/json'},
      body:JSON.stringify(args),signal:AbortSignal.timeout(45000)});
    if(!res.ok)throw new Error('CLOUD_REQUEST_FAILED');
    const text=await res.text();return text?JSON.parse(text):null;
  }
  async publish(){
    const p=publication(this.app);
    await this.rpc('publish_whoop',{p_owner_id:this.ownerId,p_records:p.records,p_publications:p.values,p_plans:p.plans});
    const time=await this.rpc('reconcile_whoop_time',{p_owner_id:this.ownerId});
    await this.rpc('publish_visitor_health',{p_owner_id:this.ownerId,p_values:visitorHealth(this.app)});
    return {records:p.records.length,plans:p.plans.length,time};
  }
  async morning(){
    const prefs=this.app.reports.preferences(),today=localClock(new Date(),prefs.timeZone);
    if(today.time<prefs.reportTime||today.time>='12:00')return;
    const plan=this.app.store.plan(today.date,prefs.timeZone);
    if(plan?.publication?.state!=='published')return;
    return this.rpc('enqueue_whoop_morning',{p_owner_id:this.ownerId,p_date:today.date,
      p_time_zone:prefs.timeZone,p_revision:plan.revision,p_text:morningText(plan)});
  }
  async job(){
    const jobs=await this.rpc('claim_whoop_job',{p_owner_id:this.ownerId});
    if(!jobs?.length)return false;
    const job=jobs[0];let result=null,error=null;
    try{
      if(job.action==='sync'){
        const days=job.payload.days??90;
        if(![14,30,90,180,365].includes(days))throw new Error('同步范围无效。');
        await this.app.whoop.sync(days);result={syncing:false};
      }else if(job.action==='generate')result={plan:await this.app.reports.generate()};
      else {
        const route=job.action==='settings'?'settings':job.action==='checkin'?'checkins':null;
        if(!route)throw new Error('操作不支持。');
        const response=await fetch(`${this.app.config.origin}/api/${route}`,{method:'POST',
          headers:{Origin:this.app.config.origin,'Content-Type':'application/json','X-LifeOS-CSRF':this.app.status().csrf},
          body:JSON.stringify(job.payload),signal:AbortSignal.timeout(25000)});
        const data=await response.json();
        if(!response.ok)throw new Error(data.error||'操作未完成。');
        result=job.action==='settings'?publicStatus(this.app):data;
      }
      await this.publish();
    }catch(e){error=e.message==='CLOUD_REQUEST_FAILED'?'云端结果待核对，请刷新页面查看。':String(e.message).slice(0,250);}
    await this.rpc('finish_whoop_job',{p_id:job.id,p_lease_token:job.lease_token,p_result:result,p_error:error});
    return true;
  }
}
