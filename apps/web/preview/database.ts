/**
 * [INPUT]: 正式native投影所需的表形状与本机时钟。
 * [OUTPUT]: 仅在内存中读写的合成账本客户端。
 * [POS]: UI预览数据替身；不模拟数据库权限或生产事务保证。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {today} from '../src/model';
type Row=Record<string,any>;
export function demoDatabase(){
  const tables:Record<string,Row[]>={categories:[],time_entries:[],transactions:[],local_records:[],
    dashboard_preferences:[],record_changes:[],local_archive:[],record_attachments:[],raw_inputs:[]};
  const groups=[['工作','core'],['学习','core'],['生活事务','support'],['饮食','recovery'],
    ['睡眠','recovery'],['运动','recovery'],['休息','recovery'],['娱乐','leisure'],
    ['社交','leisure'],['出行','support'],['待确认','support']];
  groups.forEach(([name,nature],i)=>tables.categories.push({id:i+1,name,nature,kind:'time',is_active:true,keywords:[],code:`demo-${i}`,metadata:{}}));
  [['餐饮','expense'],['交通','expense'],['数码订阅','expense'],['项目收入','income']].forEach(([name,direction],i)=>
    tables.categories.push({id:100+i,name,kind:'money',direction,is_active:true,metadata:{tintHex:['#dc8e62','#7e99bc','#9683bc','#6f9f85'][i],monthlyBudget:1500}}));
  const day=today(),stamp=(d:string,h:number)=>new Date(`${d}T${String(h).padStart(2,'0')}:00:00+08:00`).toISOString();
  for(let offset=20;offset>=0;offset--){
    const d=new Date(Date.parse(`${day}T12:00:00Z`)-offset*864e5).toISOString().slice(0,10);
    for(const [start,end,category_id,activity] of [[0,7,5,'夜间睡眠'],[7,8,4,'早餐与准备'],[8,10,1,'撰写方案'],[10,11,2,'阅读与学习'],[11,12,3,'日常事务'],[12,13,4,'午餐'],[13,15,1,'项目开发'],[15,16,6,'散步与训练'],[16,18,1,'整理项目'],[18,19,4,'晚餐'],[19,21,8,'手机与放松']] as const){
      if(offset===0&&Date.parse(stamp(d,start))>Date.now())continue;
      tables.time_entries.push({id:randomUUID(),revision:1,start_at:stamp(d,start),end_at:stamp(d,end),category_id,activity,
        project:category_id===1?'LifeOS演示项目':null,note:'合成演示记录',tags:[],deduction_minutes:0,created_at:stamp(d,start),updated_at:stamp(d,end),deleted_at:null,raw_inputs:{source:'web'}});
    }
    for(const [title,amount_cents,category_id,direction] of [['演示午餐',3800,100,'expense'],['演示出行',1800,101,'expense'],...(offset%7===0?[['演示项目收入',320000,103,'income']]:[])] as Array<[string,number,number,string]>){
      tables.transactions.push({id:randomUUID(),revision:1,title,amount_cents,category_id,direction,occurred_at:stamp(d,12),currency:'CNY',account:'演示钱包',merchant:'演示商户',note:'合成演示记录',tags:[],details:{},deleted_at:null});
    }
  }
  tables.local_records.push({id:randomUUID(),source_id:'demo-wallet',kind:'account',revision:1,deleted_at:null,
    data:{name:'演示钱包',type:'电子钱包',currency:'CNY',openingBalance:20000,ownership:'personal',classification:'asset'}});
  tables.raw_inputs.push({id:randomUUID(),text:'这是UI演示数据，可以放心修改界面。',received_at:new Date().toISOString(),input_kind:'text',status:'applied',revoked_at:null});
  function source(name:string):Row[]{
    if(name==='v_records')return [...tables.time_entries.map(data=>({id:data.id,kind:'time',event_at:data.start_at,title:data.activity,source:'web',deleted_at:data.deleted_at,search_text:data.activity,data})),
      ...tables.transactions.map(data=>({id:data.id,kind:'money',event_at:data.occurred_at,title:data.title,source:'web',deleted_at:data.deleted_at,search_text:data.title,data})),
      ...tables.local_records.map(data=>({id:data.id,kind:data.kind,event_at:null,title:data.data.name,source:'demo',deleted_at:data.deleted_at,data:data.data}))];
    return tables[name]||[];
  }
  class Query implements PromiseLike<any>{
    filters:Array<(r:Row)=>boolean>=[];orders:Array<[string,boolean]>=[];start=0;end=Infinity;one=false;
    constructor(readonly name:string){}
    select(..._args:any[]){return this;}
    eq(k:string,v:any){this.filters.push(r=>r[k]===v);return this;}
    neq(k:string,v:any){this.filters.push(r=>r[k]!==v);return this;}
    is(k:string,v:any){this.filters.push(r=>v===null?r[k]==null:r[k]===v);return this;}
    in(k:string,v:any[]){this.filters.push(r=>v.includes(r[k]));return this;}
    lt(k:string,v:any){this.filters.push(r=>r[k]<v);return this;}
    lte(k:string,v:any){this.filters.push(r=>r[k]<=v);return this;}
    gt(k:string,v:any){this.filters.push(r=>r[k]>v);return this;}
    gte(k:string,v:any){this.filters.push(r=>r[k]>=v);return this;}
    ilike(k:string,v:string){this.filters.push(r=>String(r[k]||'').toLowerCase().includes(v.replaceAll('%','').toLowerCase()));return this;}
    or(value:string){const clauses=value.split(',');this.filters.push(r=>clauses.some(clause=>{const [k,op,...rest]=clause.split('.');const v=rest.join('.');return op==='is'?r[k]==null:op==='gt'?r[k]>v:false;}));return this;}
    order(k:string,opts?:{ascending?:boolean}){this.orders.push([k,opts?.ascending!==false]);return this;}
    range(start:number,end:number){this.start=start;this.end=end;return this;}
    limit(n:number){this.end=n-1;return this;}
    maybeSingle(){this.one=true;return this;}
    single(){this.one=true;return this;}
    then<T=any,U=never>(resolve?:((v:any)=>T|PromiseLike<T>)|null,reject?:((e:any)=>U|PromiseLike<U>)|null):PromiseLike<T|U>{
      const rows=source(this.name).filter(r=>this.filters.every(f=>f(r))).sort((a,b)=>{
        for(const [k,asc]of this.orders){const c=String(a[k]??'').localeCompare(String(b[k]??''));if(c)return asc?c:-c;}return 0;});
      const sliced=structuredClone(rows.slice(this.start,this.end+1));
      return Promise.resolve({data:this.one?sliced[0]||null:sliced,count:rows.length,error:null}).then(resolve,reject);
    }
  }
  async function rpc(name:string,args:Row){
    let data:any=null;
    if(name==='edit_record')return rpc('dashboard_record',{...args,p_action:'update',p_data:args.p_patch});
    if(name==='dashboard_record'){
      if(!['time','money'].includes(args.p_kind))return {error:{message:'该记录类型未纳入UI演示'},data:null};
      const table=args.p_kind==='time'?tables.time_entries:tables.transactions;
      let row=table.find(r=>r.id===args.p_id);
      if(args.p_action==='create'){row={id:args.p_id||randomUUID(),revision:0,deleted_at:null,created_at:new Date().toISOString()};table.push(row);}
      if(!row)return {error:{code:'P0001',message:'演示记录不存在'},data:null};
      if(args.p_action!=='create'&&args.p_revision!==row.revision)return {error:{code:'40001',message:'演示记录版本已变化'},data:null};
      const before=structuredClone(row);
      Object.assign(row,args.p_data,{revision:row.revision+1,updated_at:new Date().toISOString()});
      if(args.p_action==='delete')row.deleted_at=new Date().toISOString();
      data=structuredClone(row);
      tables.record_changes.push({id:randomUUID(),kind:args.p_kind,record_id:row.id,revision:row.revision,before_data:before,after_data:data,changed_at:row.updated_at,actor:'UI演示'});
    }else if(name==='dashboard_configuration'){
      let pref=tables.dashboard_preferences.find(r=>r.domain===args.p_domain);
      if(!pref){pref={id:randomUUID(),domain:args.p_domain,data:{},revision:1};tables.dashboard_preferences.push(pref);}
      Object.assign(pref.data,args.p_data.settings||{});pref.revision++;data=pref;
    }else return {error:{message:'该动作未纳入UI演示'},data:null};
    return {data,error:null};
  }
  return {client:{from:(name:string)=>new Query(name),rpc} as unknown as SupabaseClient,tables};
}
