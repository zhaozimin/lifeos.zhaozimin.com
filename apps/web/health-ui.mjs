/**
 * [INPUT]: 原版健康控制台、云端适配、纸墨朱 zzm.css 与共用 sidebar.css 的 --lifeos-content-max。
 * [OUTPUT]: dist/health-console，保留原图表与操作；附带锁版本的纸墨朱样式，亮暗由宿主 data-theme 决定。
 *   导航与日期范围由宿主二级栏驱动：iframe 隐藏原版侧栏，接收 health-view / health-range，回报 health-state。
 * [POS]: 构建适配器；原版为唯一界面真源，不维护第二套健康图表。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { cp,readFile,writeFile,rm,readdir } from 'node:fs/promises';
import {healthRevision} from './health-version.mjs';
export async function buildHealthUi(target=new URL('./dist/health-console/',import.meta.url)){
  const version=healthRevision();
  // 内容区最大宽度只在共用侧栏样式里定义一次，这里读出后写进嵌入样式
  const sidebarCss=await readFile(new URL('./src/dashboard/components/shell/sidebar.css',import.meta.url),'utf8');
  const contentMax=sidebarCss.match(/--lifeos-content-max:\s*([^;]+);/)?.[1].trim();
  if(!contentMax)throw new Error('HEALTH_UI_CONTENT_MAX_MISSING');
  await rm(target,{recursive:true,force:true});
  await cp(new URL('../whoop/public/',import.meta.url),target,{recursive:true});
  await rm(new URL('CLAUDE.md',target),{force:true});
  for(const name of ['health-bridge.js','health-settings.js'])await cp(new URL(name,import.meta.url),new URL(name,target));
  // 设计系统唯一源头在 design/zzm；构建时复制，不在 whoop/public 存第二份
  await cp(new URL('../../design/zzm/zzm.css',import.meta.url),new URL('zzm.css',target));
  let app=await readFile(new URL('app.js',target),'utf8');
  const a=app.indexOf('async function api('),b=app.indexOf('function toast(',a);
  if(a<0||b<0)throw new Error('HEALTH_UI_API_SOURCE_CHANGED');
  app=app.slice(0,a)+'const api = cloudRequest;\n'+app.slice(b);
  const s=app.indexOf('function settingsView()'),e=app.indexOf('function footer()',s);
  if(s<0||e<0)throw new Error('HEALTH_UI_SETTINGS_SOURCE_CHANGED');
  app=app.slice(0,s)+'function settingsView(){ return cloudSettings(state,{esc,icon,reportSettings}); }\n'+app.slice(e);
  app='import {cloudRequest} from "./health-bridge.js";\nimport {cloudSettings} from "./health-settings.js";\n'+app;
  const historyStart=app.indexOf('history.replaceState('),historyEnd=app.indexOf(');',historyStart);
  if(historyStart<0||historyEnd<0)throw new Error('HEALTH_UI_HISTORY_SOURCE_CHANGED');
  app=app.slice(0,historyStart)+'try{'+app.slice(historyStart,historyEnd+2)+'}catch{/* 宿主骨架保持统一健康入口。 */}'+app.slice(historyEnd+2);
  app=app.replaceAll('/api/','/api/health/').replaceAll('src="/favicon.svg"','src="/health-console/favicon.svg"')
    .replaceAll('接入设置','健康设置')
    .replaceAll('数据保存在本机','健康数据汇入私密云端').replaceAll('本机保存','私密云端').replaceAll('本机运行','私密空间')
    .replaceAll('本机规则','恢复规则').replaceAll('已开始同步 WHOOP 数据。','WHOOP 数据已同步。')
    .replaceAll('.toLocaleString("zh-CN")','.toLocaleString("zh-CN", {timeZone:state.status?.settings?.timeZone || "Asia/Shanghai"})');
  app+='\nwindow.addEventListener("message",e=>{if(e.source===parent&&e.origin===new URL(document.baseURI).origin&&e.data?.type==="health-refresh"&&!document.querySelector("dialog[open],form [data-dirty]"))void refresh().catch(()=>{});});\n'
    +'document.addEventListener("input",e=>{if(e.target.closest("form"))e.target.dataset.dirty="true";});\n'
    // 宿主二级栏切视图、切范围；每次渲染后回报当前视图与范围，宿主据此同步地址与面板
    +'window.addEventListener("message",e=>{if(e.source!==parent||e.origin!==new URL(document.baseURI).origin)return;'
    +'if(e.data?.type==="health-view"&&views[e.data.view]&&e.data.view!==state.view)setView(e.data.view);'
    +'if(e.data?.type==="health-range"&&[7,30,90].includes(e.data.days)&&e.data.days!==state.range){state.range=e.data.days;void refresh().catch(()=>{});}});\n'
    +'{const paint=render;render=function(){paint();parent.postMessage({type:"health-state",view:state.view,range:state.range},new URL(document.baseURI).origin);};}\n';
  await writeFile(new URL('app.js',target),app);
  const plans=await readFile(new URL('plans.js',target),'utf8');
  await writeFile(new URL('plans.js',target),plans.replaceAll('/api/','/api/health/')
    .replaceAll('电脑休眠时暂停，唤醒后补当天安排。','服务器持续运行，电脑关机后仍会同步和生成。')
    .replaceAll('esc(plan.engine)','esc(plan.engine.replace("本机规则","恢复规则"))'));
  let html=await readFile(new URL('index.html',target),'utf8');
  html=html.replaceAll('href="/','href="/health-console/').replaceAll('src="/','src="/health-console/')
    .replace('<html lang="zh-CN">','<html lang="zh-CN" class="zzm-v4">')
    .replace('<head>','<head><link rel="stylesheet" href="/health-console/zzm.css">')
    .replace('</head>','<link rel="stylesheet" href="/health-console/embed.css"></head>');
  await writeFile(new URL('index.html',target),html);
  await writeFile(new URL('embed.css',target),`/* 原版控制台嵌入统一健康页面。 */
    /* 导航与日期由 LifeOS 宿主二级栏承担（同其他领域一个组件）；原版侧栏、顶栏与页内范围键隐藏 */
    .sidebar,.topbar,[data-action="demo"],.segmented:has([data-range]){display:none!important}
    .page-heading{margin-top:0!important}
    /* 内容区与宿主其他领域同一规则：自适应铺满，最宽 ${contentMax} 后居中，上 24、左右 40 */
    .shell{display:block!important}
    .main{margin:0 auto!important;max-width:calc(${contentMax} + 80px);padding:24px 40px!important;min-width:0}
/* 滚动条：细条、透明轨道，滚动中才浮现 */
    html{scrollbar-gutter:stable}
    *{scrollbar-width:thin;scrollbar-color:transparent transparent}
    [data-scrolling]{scrollbar-color:var(--zzm-line-hover,rgba(0,0,0,.3)) transparent}
    *::-webkit-scrollbar{width:8px;height:8px;background:transparent}
    *::-webkit-scrollbar-thumb{background:transparent;border:2px solid transparent;border-radius:8px;background-clip:padding-box}
    [data-scrolling]::-webkit-scrollbar-thumb{background-color:var(--zzm-line-hover,rgba(0,0,0,.3))}
    @media(max-width:639px){.main{padding:16px 12px!important}.page-heading .heading-actions{flex-wrap:wrap}}
  `);
  for(const name of await readdir(target)){
    if(!/\.(js|css|html)$/.test(name))continue;
    let text=await readFile(new URL(name,target),'utf8');
    if(name.endsWith('.js'))text=text.replace(/(from\s*["']\.\/[^"']+\.js)(["'])/g,`$1?v=${version}$2`);
    if(name.endsWith('.css'))text=text.replaceAll('url("/','url("/health-console/').replace(/(\.css)(["'])/g,`$1?v=${version}$2`);
    if(name.endsWith('.html'))text=text.replace(/(\/health-console\/[^"']+\.(?:js|css))(["'])/g,`$1?v=${version}$2`);
    await writeFile(new URL(name,target),text);
  }
}
