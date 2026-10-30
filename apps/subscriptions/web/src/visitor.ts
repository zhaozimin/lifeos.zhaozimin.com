/**
 * [INPUT]: 仅含公开目录和品牌图地址的访客响应。
 * [OUTPUT]: 原版卡片及统计的只读适配，金额和账号固定为占位。
 * [POS]: 访客传输边界；不请求账号、银行卡或任何写接口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {Subscription,Summary} from './types';
export const isVisitor=()=>typeof document!=='undefined'&&document.documentElement.dataset.access==='visitor';
export type PublicSubscription={id:string;name:string;category:string;cycle:string;status:string;renewalDate:string;logoSrc:string};
let loading:Promise<{items:PublicSubscription[]}>|null=null;
function catalog(){
 if(!loading)loading=fetch('/api/visitor/subscriptions',{credentials:'omit',cache:'no-store'}).then(async r=>{const value=await r.json();if(!r.ok)throw new Error(value.error||'公开订阅暂时不可用');return value;}).finally(()=>{loading=null;});
 return loading;
}
export function publicSubscriptions(rows:PublicSubscription[],today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})):Subscription[]{
 return rows.map((row,i)=>{
  const days=Math.ceil((Date.parse(row.renewalDate+'T00:00:00+08:00')-Date.parse(today+'T00:00:00+08:00'))/864e5);
  const cycleDays=row.cycle==='yearly'?365:row.cycle==='quarterly'?90:30;
  const status=row.status==='ended'?'expired':row.status as Subscription['status'];
  return {id:row.id,name:row.name,website:'',amount_fen:0,amount_yuan:'••••',currency:'CNY',cycle:row.cycle as Subscription['cycle'],cycle_days:null,next_renewal_on:row.renewalDate,
   auto_renew:false,billing_mode:'auto_charge',balance_fen:null,balance_yuan:'••••',balance_stopped:false,balance_low:false,balance_cycles:null,auto_charge_ready:false,
   status,display_status:status,paused_on:'',paused_days_left:null,is_phone:false,phone_balance_fen:null,phone_balance_yuan:null,phone_balance_stopped:false,phone_balance_low:false,phone_balance_months:null,
   payment_method_id:null,payment_method_name:'••••',payment_method_account:'••••',account_id:null,account_label:'••••',account_identifier:'••••',
   category_id:'public-'+row.category,category_name:row.category,category_sort:i,logo_url:'',logo_src:row.logoSrc,remain_ratio:Math.max(0,Math.min(1,days/cycleDays)),remind_days:7,notes:'••••',days_left:days,
   urgency:status!=='active'?'ok':days<0?'overdue':days===0?'today':days<=7?'soon':'ok',monthly_yuan:'••••',yearly_yuan:'••••',spent_count:0,spent_fen:0,spent_yuan:'••••',upcoming_yuan:'••••',sort_order:i};
 });
}
export async function visitorRequest<T>(path:string,init?:RequestInit):Promise<T>{
 if((init?.method||'GET').toUpperCase()!=='GET')throw new Error('访客仅可浏览，不能修改订阅。');
 const {items:rows}=await catalog(),items=publicSubscriptions(rows);
 const categories=[...new Set(rows.map(r=>r.category))].map((name,i)=>({id:'public-'+name,name,sort_order:i,builtin:false}));
 let value:unknown;
 if(path==='/v1/subscriptions')value={items};
 else if(/^\/v1\/subscriptions\/[a-f0-9]{24}$/.test(path)){value=items.find(r=>r.id===path.split('/').at(-1));if(!value)throw new Error('公开订阅不存在。');}
 else if(path==='/v1/categories')value={items:categories};
 else if(path==='/v1/summary'){
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),active=items.filter(r=>r.status==='active');
  const summary:Summary={today,count:items.length,active_count:active.length,paused_count:items.filter(r=>r.status==='paused').length,ended_count:items.filter(r=>r.status==='cancelled'||r.status==='expired').length,
   soon_count:active.filter(r=>r.urgency==='soon'||r.urgency==='today').length,overdue_count:active.filter(r=>r.urgency==='overdue').length,
   monthly_yuan:'••••',yearly_yuan:'••••',projected_yuan:'••••',this_month_yuan:'••••',
   by_category:categories.map(c=>({...c,active_count:active.filter(r=>r.category_id===c.id).length,monthly_yuan:'••••'})),
   // 固定示意曲线；不使用私人价格、余额或实际扣款比例。
   curve:Array.from({length:12},(_,i)=>({month:new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7))-1+i,1)).toISOString().slice(0,7),fen:100+(i%4)*20,yuan:'••••'}))};
  value=summary;
 }else throw new Error('此内容仅本人可见。');
 return value as T;
}
