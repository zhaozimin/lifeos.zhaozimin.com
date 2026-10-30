/**
 * [INPUT]: 同源健康API、后台任务编号和父页面的认证事件。
 * [OUTPUT]: 原版控制台请求适配；异步写入只提交一次并轮询结果；把宿主下发的亮暗模式写成 data-theme；滚动中的元素打 data-scrolling 标记。
 * [POS]: 健康控制台浏览器边界；不保存令牌，不连接VPS地址。
 * 访客请求独立公开路径，在浏览器及服务端同时拒绝写入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const hostOrigin=new URL(document.baseURI).origin;
// 访客保留页面与表单结构；DOM禁用仅改善交互，服务端仍拒绝写入。
if(document.documentElement.dataset.access==='visitor'){
  const lock=()=>{
    for(const el of document.querySelectorAll('form input,form textarea,form select,form button,[data-action="sync"],[data-action="record"],[data-action="generate-plan"]')){
      el.disabled=true;
      if(el.matches('input,textarea')){el.value='';el.placeholder='••••';}
      if(el.matches('select')){
        if(!el.querySelector('[data-visitor-mask]')){const option=document.createElement('option');option.dataset.visitorMask='';option.value='';option.textContent='••••';el.prepend(option);}
        el.value='';
      }
    }
    for(const el of document.querySelectorAll('a[download]')){el.setAttribute('aria-disabled','true');el.tabIndex=-1;el.style.pointerEvents='none';el.style.opacity='.45';}
  };
  new MutationObserver(lock).observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('DOMContentLoaded',lock);lock();
}
async function request(path,options={}){
  const response=await fetch(path,{...options,credentials:'same-origin',cache:'no-store'});
  const data=await response.json();
  if(response.status===401)window.parent.postMessage({type:'health-session-expired'},hostOrigin);
  if(!response.ok)throw new Error(data.error||'健康服务暂时不可用，请刷新查看。');
  return data;
}
const writes=new Map();
export function cloudRequest(path,body){
  const url=path.startsWith('/api/health/')?path:path.replace('/api/','/api/health/');
  if(body===undefined)return execute(url,body);
  const key=url+JSON.stringify(body);
  if(writes.has(key))return writes.get(key);
  const buttons=url.startsWith('/api/health/whoop/sync')?[...document.querySelectorAll('[data-action="sync"]')].map(b=>[b,b.innerHTML,b.disabled]):[];
  for(const [b] of buttons){b.disabled=true;b.textContent='正在同步…';b.setAttribute('aria-busy','true');}
  const pending=execute(url,body).finally(()=>{
    writes.delete(key);
    for(const [b,html,disabled] of buttons)if(b.isConnected){b.disabled=disabled;b.innerHTML=html;b.removeAttribute('aria-busy');}
  });
  writes.set(key,pending);return pending;
}
async function execute(url,body){
  if(document.documentElement.dataset.access==='visitor'){
    if(body!==undefined)throw new Error('访客只有只读权限。');
    url=url.replace('/api/health/','/api/visitor/health/');
  }
  const result=await request(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...body,request_id:crypto.randomUUID()})});
  if(!result.job_id)return result;
  for(let i=0;i<90;i++){
    await new Promise(resolve=>setTimeout(resolve,1000));
    const job=await request(`/api/health/jobs/${result.job_id}`);
    if(job.status==='succeeded')return job.result;
    if(job.status==='failed')throw new Error(job.error||'操作未完成，请刷新核对。');
  }
  throw new Error('后台仍在处理，请稍后刷新查看结果；不要重复提交。');
}
window.addEventListener('message',event=>{
  if(event.origin!==hostOrigin||event.source!==window.parent||event.data?.type!=='health-theme')return;
  // 只接收模式；颜色由 iframe 内的 zzm.css 令牌按 data-theme 决定
  const theme=event.data.theme==='dark'?'dark':'light';
  document.documentElement.dataset.theme=theme;
  document.documentElement.classList.toggle('dark',theme==='dark');
});

// 滚动时才显示滚动条：与面板 lib/scrollbars 同一规则，停 900ms 后隐去
{
  const timers=new WeakMap();
  document.addEventListener('scroll',event=>{
    const target=event.target===document?document.documentElement:event.target;
    if(!(target instanceof Element))return;
    target.setAttribute('data-scrolling','');
    clearTimeout(timers.get(target));
    timers.set(target,setTimeout(()=>target.removeAttribute('data-scrolling'),900));
  },{capture:true,passive:true});
}
