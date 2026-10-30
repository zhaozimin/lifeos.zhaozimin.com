/**
 * [INPUT]: 仅含公开日期、方向和通用分类的财务事件。
 * [OUTPUT]: 原版财务页面的脱敏契约，金额为null。
 * [POS]: 财务访客适配；示意账户和预算均为固定占位。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {SupabaseClient} from '@supabase/supabase-js';
import {HttpError} from './auth';
const names=['收入','转账','餐饮','交通','软件与工具','生活消费','学习','健康','其他支出'];
const colors=['#6f9183','#8582a3','#b18f77','#8b9dab','#a294b1','#b09a78','#929f89','#86a6a1','#96918a'];
export async function visitorFinance(client:SupabaseClient,path:string,params:Record<string,unknown>){
 const {data,error}=await client.rpc('visitor_finance');
 if(error)throw new HttpError(error.code==='42501'?403:503,'公开财务展示暂时不可用。');
 const categories=names.map((name,i)=>({id:`public-${i}`,name,direction:i===0?'收入':'支出',tintHex:colors[i],monthlyBudget:null}));
 if(path==='/v1/fin/configuration')return {revision:1,privacy:'masked',categories,
  accounts:[{id:'display-wallet',name:'账户 ••••',type:'展示账户',currency:'CNY',openingBalance:null,currentBalance:null,threshold:null,ownership:'personal',classification:'asset'}],
  settings:{bookMode:'personal',ledgerMode:'personal',defaultCurrency:'CNY',baseUnit:'元',timezone:'Asia/Shanghai',allowManualEntry:false,projects:[{id:'display-project',name:'项目 ••••',direction:'支出',group:'展示项目',trackingEnabled:true,expectedCost:null,expectedRevenue:null}]}};
 if(path==='/v1/fin/budget/status')return {privacy:'masked',month:params.month||'',items:categories.slice(2,5).map(c=>({categoryId:c.id,name:c.name,budget:null,spent:null,remaining:null,percentUsed:null,color:c.tintHex})),totalBudget:null,totalSpent:null,totalRemaining:null};
 if(path==='/v1/fin/transactions')return (data as Array<{id:string;day:string;kind:string;category:string}>).map((r)=>({
  id:r.id,revision:1,title:`${r.category}记录`,amount:null,kind:r.kind,occurredAt:r.day+'T12:00',
  category:categories.find(c=>c.name===r.category),tags:[],accountName:'账户 ••••',fromAccountName:r.kind==='transfer'?'账户 ••••':null,toAccountName:r.kind==='transfer'?'账户 ••••':null,
  merchant:'••••',projectName:'项目 ••••',note:'••••',reimbursementStatus:'notApplicable',source:'visitor',currency:'CNY',amountInBaseCurrency:null,attachments:[],deletedAt:null,
 })).filter(t=>(!params.kind||t.kind===params.kind)&&(!params.categoryId||t.category?.id===params.categoryId)&&(!params.month||t.occurredAt.startsWith(String(params.month)))&&(!params.q||t.title.includes(String(params.q))));
 throw new HttpError(403,'访客不能访问此财务接口。');
}
