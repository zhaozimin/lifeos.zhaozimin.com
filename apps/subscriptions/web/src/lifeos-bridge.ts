/**
 * [INPUT]: 同源LifeOS宿主的主题与刷新消息。
 * [OUTPUT]: 把宿主的亮暗模式写成 data-theme，转发既有刷新广播；滚动中的元素打 data-scrolling 标记。
 * [POS]: 原版界面的宿主适配，不保存会话或业务数据。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {announceChange} from './lib/refresh';
window.addEventListener('message',event=>{
  if(event.origin!==new URL(document.baseURI).origin||event.source!==parent)return;
  if(event.data?.type==='subscriptions-refresh'){announceChange();return;}
  if(event.data?.type!=='subscriptions-theme')return;
  // 只接收模式；颜色由 zzm.css 令牌按 data-theme 决定
  const theme=event.data.theme==='dark'?'dark':'light';
  document.documentElement.dataset.theme=theme;
});

// 滚动时才显示滚动条：与面板 lib/scrollbars 同一规则，停 900ms 后隐去
{
  const timers=new WeakMap<Element,number>();
  document.addEventListener('scroll',event=>{
    const target=event.target===document?document.documentElement:event.target;
    if(!(target instanceof Element))return;
    target.setAttribute('data-scrolling','');
    window.clearTimeout(timers.get(target));
    timers.set(target,window.setTimeout(()=>target.removeAttribute('data-scrolling'),900));
  },{capture:true,passive:true});
}
