/**
 * [INPUT]: 匿名Supabase客户端、限定投影RPC与订阅公开目录。
 * [OUTPUT]: 访客时间、健康、财务结构和订阅只读响应；不返回私人金额。
 * [POS]: 公共API白名单；独立客户端不继承本人Cookie或JWT。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {HttpError,type Env} from './auth';
import {toSegment,timeSummary} from './native-data';
import {today,bounds,validDay,daysBetween} from '../src/model';
import {visitorFinance} from './visitor-finance';
const nativeInput=z.object({method:z.literal('GET'),path:z.enum(['/v1/health','/v1/time/configuration','/v1/time/segments','/v1/time/summary/range','/v1/fin/configuration','/v1/fin/transactions','/v1/fin/budget/status']),params:z.record(z.string(),z.unknown()).default({})}).strict();
const catalog=z.object({items:z.array(z.object({id:z.string().regex(/^[a-f0-9]{24}$/),logoSrc:z.string().regex(/^\/api\/visitor\/subscriptions\/logo\/[a-f0-9]{24}$/),name:z.string().max(100),category:z.string().max(100),cycle:z.string().max(30),status:z.enum(['active','paused','ended','cancelled','expired']),renewalDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).strict()).max(500)}).strict();
async function rpc(client:SupabaseClient,name:string,args:Record<string,unknown>){
 const {data,error}=await client.rpc(name,args);
 if(error)throw new HttpError(error.code==='42501'?403:503,'访客数据暂时不可用。');
 return data;
}
export async function visitor(client:SupabaseClient,env:Env,url:URL,method:string,input?:unknown){
 const path=url.pathname.slice('/api/visitor'.length);
 if(/^\/subscriptions\/logo\/[a-f0-9]{24}$/.test(path)&&method==='GET'){
  if(!await rpc(client,'visitor_policy',{}))throw new HttpError(403,'访客访问尚未开启。');
  if(!env.SUBSCRIPTIONS)throw new HttpError(503,'订阅服务暂时不可用。');
  const response=await env.SUBSCRIPTIONS.fetch(new Request('https://subos.internal/v1/visitor/logo/'+path.split('/').at(-1)));
  if(!response.ok)throw new HttpError(404,'公开图标不存在。');
  if(!response.headers.get('Content-Type')?.startsWith('image/'))throw new HttpError(503,'图标格式无效。');
  return response;
 }
 if(path==='/subscriptions'&&method==='GET'){
  if(!await rpc(client,'visitor_policy',{}))throw new HttpError(403,'访客访问尚未开启。');
  if(!env.SUBSCRIPTIONS)throw new HttpError(503,'订阅服务暂时不可用。');
  const response=await env.SUBSCRIPTIONS.fetch(new Request('https://subos.internal/v1/visitor/catalog-v2'));
  if(!response.ok)throw new HttpError(503,'订阅目录暂时不可用。');
  return catalog.parse(await response.json());
 }
 if(path.startsWith('/health/')&&method==='GET'){
  const part=path.slice('/health'.length);
  if(!['/status','/dashboard','/plans'].includes(part))throw new HttpError(403,'此健康内容仅本人可见。');
  const range=z.coerce.number().refine(n=>[7,30,90].includes(n)).parse(url.searchParams.get('range')||30);
  const data=await rpc(client,'visitor_health',{p_range:range});
  if(part==='/dashboard')return data;
  if(part==='/plans')return {plans:data.publicPlans||[]};
  const day=today();return {visitor:true,connected:true,hasData:data.coverage.totalCycles>0,syncing:false,sync:data.publicSync,cloud:true,
   ai:{enabled:false,engine:'公开健康指标'},settings:{goal:'提升体能与恢复',experience:'',constraints:'',timeZone:'Asia/Shanghai',reportTime:'07:00',wakeTime:'06:30',diet:'不限',foodRestrictions:'',age:null},
   reports:{today:day,reportTime:'07:00',timeZone:'Asia/Shanghai',preparationTime:'06:00',timing:'访客只读；根据公开健康指标展示建议。',generating:false,job:null}};
 }
 if(path!=='/native'||method!=='POST')throw new HttpError(403,'访客只有只读权限。');
 const value=nativeInput.safeParse(input);if(!value.success)throw new HttpError(403,'访客不能读取或修改此内容。');
 const {path:route,params}=value.data;
 if(route.startsWith('/v1/fin/'))return visitorFinance(client,route,params);
 if(route==='/v1/health')return {status:'ok',version:'LifeOS 访客',timezone:'Asia/Shanghai',resolvedTimezone:'Asia/Shanghai',timezoneSource:'config'};
 const day=today();let from:string,to:string;
 if(route==='/v1/time/summary/range'){
  const a=String(params.from||''),b=String(params.to||'');
  if(!validDay(a)||!validDay(b)||b<a||daysBetween(a,b)>366)throw new HttpError(400,'请选择一年以内的有效日期。');
  [from,to]=[new Date(bounds(a)[0]).toISOString(),new Date(bounds(b)[1]).toISOString()];
 }else{
  const timestamp=(v:unknown,fallback:number)=>{
   const s=String(v||'');const n=s?Date.parse(/(?:Z|[+-]\d\d:\d\d)$/i.test(s)?s:s+'+08:00'):fallback;
   if(!Number.isFinite(n))throw new HttpError(400,'日期无效。');return new Date(n).toISOString();
  };
  from=timestamp(params.from,bounds(day)[0]-30*864e5);to=timestamp(params.to,bounds(day)[1]);
 }
 const data=await rpc(client,'visitor_time',{p_from:from,p_to:to});
 if(route==='/v1/time/configuration')return {categories:data.categories.map((c:any)=>({...c,keywords:[],builtin:false,protected:true})),
  projects:[],natures:['core','support','recovery','leisure'],settings:{weekStart:'monday'},timezone:'Asia/Shanghai',resolvedTimezone:'Asia/Shanghai',timezoneSource:'config',currentSystemTimezone:null,overlongSegmentMinutes:480,revision:1};
 const segments=data.entries.map((row:any)=>toSegment({source:row.source,data:{...row,revision:1,tags:[],note:null,project:null}},data.categories));
 if(route==='/v1/time/segments'){
  const selected=segments.filter((s:any)=>!params.source||s.source===params.source);
  const offset=z.coerce.number().int().min(0).max(10000).parse(params.offset||0),limit=z.coerce.number().int().min(1).max(10000).parse(params.limit||10000);
  return {segments:selected.slice(offset,offset+limit),total:selected.length};
 }
 const summary=timeSummary(segments,String(params.from),String(params.to),new Date(),true);
 summary.sleepAuthority=await rpc(client,'visitor_sleep_summary',{p_from:params.from,p_to:params.to});
 return summary;
}
