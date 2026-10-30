/**
 * [INPUT]: 本人AAL2客户端、健康发布副本与受限操作请求。
 * [OUTPUT]: 原版健康面板API、导出与异步任务状态。
 * [POS]: 健康网络适配层；只读发布副本，写入通过白名单队列。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './auth';
const actions:Record<string,string>={ '/settings':'settings','/checkins':'checkin','/whoop/sync':'sync','/plans/generate':'generate' };
export async function health(client:SupabaseClient,url:URL,method:string,input?:unknown):Promise<unknown|Response>{
  const path=url.pathname.slice('/api/health'.length);
  const publication=async(key:string)=>{
    const {data,error}=await client.from('whoop_publications').select('value,updated_at').eq('key',key).maybeSingle();
    if(error)throw new HttpError(503,'健康数据暂时无法读取。');
    if(!data)throw new HttpError(503,'健康数据正在首次迁移，请稍后刷新。');
    return data.value;
  };
  const download=(value:string,name:string,type:string)=>new Response(value,{headers:{'Content-Type':`${type}; charset=utf-8`,
    'Content-Disposition':`attachment; filename="${name}"`}});
  if(method==='POST'){
    const action=actions[path];
    if(!action)throw new HttpError(400,'授权凭据请在安全本机入口维护。');
    const parsed=z.object({request_id:z.uuid()}).passthrough().parse(input);
    const {request_id,...payload}=parsed;
    const {data,error}=await client.rpc('enqueue_whoop_job',{p_id:request_id,p_action:action,p_payload:payload});
    if(error)throw new HttpError(409,'操作未入队，请检查设置或稍后重试。');
    return {job_id:data};
  }
  if(path.startsWith('/jobs/')){
    const id=z.uuid().parse(path.slice(6));
    const {data,error}=await client.from('whoop_jobs').select('id,status,result,error').eq('id',id).maybeSingle();
    if(error)throw new HttpError(503,'操作状态暂时无法核对。');
    if(!data)throw new HttpError(404,'操作不存在。');
    return data;
  }
  if(url.searchParams.get('mode')==='demo')throw new HttpError(400,'云端健康页只显示本人的真实数据。');
  if(path==='/status')return publication('status');
  if(path==='/dashboard'){
    const range=Number(url.searchParams.get('range')??30);
    if(![7,30,90].includes(range))throw new HttpError(400,'请选择7、30或90天。');
    return publication(`dashboard:${range}`);
  }
  if(path==='/plans')return publication('plans');
  if(path==='/export')return download(JSON.stringify(await publication('export'),null,2),'lifeos-health.json','application/json');
  if(path==='/summary')return download(JSON.stringify(await publication('summary'),null,2),'lifeos-health-summary.json','application/json');
  if(path==='/plans/export'){
    const data=await publication('plans');
    const plan=data.plans.find((p:Record<string,unknown>)=>p.targetDate===url.searchParams.get('date')&&
      (!url.searchParams.get('timeZone')||p.timeZone===url.searchParams.get('timeZone')));
    if(!plan)throw new HttpError(404,'该日计划尚未生成。');
    return download(plan.markdown,`lifeos-plan-${plan.targetDate}.md`,'text/markdown');
  }
  if(path==='/records'){
    const kind=url.searchParams.get('kind')??'';
    if(!['cycles','recoveries','sleeps','workouts'].includes(kind))throw new HttpError(400,'记录类型无效。');
    const data=await publication('export');return {kind,records:data.records[kind]};
  }
  throw new HttpError(404,'健康接口不存在。');
}
