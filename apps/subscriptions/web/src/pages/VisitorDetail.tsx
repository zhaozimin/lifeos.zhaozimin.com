/**
 * [INPUT]: 公开订阅适配器和路由编号。
 * [OUTPUT]: 与原版详情Sheet同壳的只读完整字段。
 * [POS]: 访客详情；金额、账号、网址及支付字段均为固定占位。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useEffect,useState} from 'react';
import {api} from '../api';
import type {Subscription} from '../types';
import {BrandMark} from '../components/BrandMark';
import {cycleLabel} from '../lib/format';
export function VisitorDetail({id}:{id?:string}){
 const [item,setItem]=useState<Subscription|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;if(id)api.getSubscription(id).then(value=>{if(active)setItem(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id]);
 if(!id)return <VisitorPrivate title="新增订阅"/>;
 if(!item)return <p className="p-6 quiet">{error||'正在读取公开订阅…'}</p>;
 return <section className="p-6"><div className="flex items-center gap-4"><BrandMark name={item.name} website="" logoSrc={item.logo_src} size={56}/><h2 className="page-title">{item.name}</h2></div>
 <p className="quiet mt-4">访客只读 · 价格和私人账号已打码</p>
 <div className="mt-6 grid gap-4">{[['分类',item.category_name||'未分类'],['价格','••••'],['周期',cycleLabel(item.cycle,item.cycle_days)],['续订日期',item.next_renewal_on],['状态',item.status==='paused'?'已暂停':item.status==='active'?'使用中':'已结束'],['账号','••••'],['支付方式','••••'],['余额','••••'],['备注','••••']].map(([label,value])=><label key={label} className="grid gap-2 text-sm"><span>{label}</span><input className="field" disabled value={value}/></label>)}</div>
 <button className="btn btn-zhu mt-6" disabled>保存修改（仅本人）</button></section>;
}
export function VisitorPrivate({title}:{title:string}){
 return <section><h1 className="page-title">{title}</h1><p className="quiet mt-4">可以了解此模块，私人数据与修改功能仅本人可用。</p><div className="mt-6 grid gap-4">{['名称','账号','支付信息','备注'].map(label=><label key={label} className="grid gap-2"><span>{label}</span><input className="field" disabled value="••••"/></label>)}</div><button disabled className="btn mt-6">保存（仅本人）</button></section>;
}
