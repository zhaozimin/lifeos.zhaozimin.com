/**
 * [INPUT]: 构建注入的SubOS静态宿主HTML、刷新信号与主题 store 的解析模式。
 * [OUTPUT]: 统一LifeOS订阅页面，保留原版交互。
 * [POS]: 订阅域挂载器；数据接口继续要求本人AAL2。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {useEffect,useRef} from 'react';
declare const __SUBSCRIPTIONS_SHELL__: string;
import {useRefreshSignal} from './dashboard/components/Layout';
import {useThemeStore} from './dashboard/store/theme';
import {useAccess} from './access';
export function SubscriptionsPage(){
  const {owner}=useAccess();
  const frame=useRef<HTMLIFrameElement>(null),refresh=useRefreshSignal();
  // 只下发亮暗模式；SubOS 自带锁版本 zzm.css，颜色由令牌决定
  const resolved=useThemeStore((s)=>s.resolved);
  const theme=()=>{frame.current?.contentWindow?.postMessage({type:'subscriptions-theme',theme:useThemeStore.getState().resolved},location.origin);};
  useEffect(()=>{
    const message=(e:MessageEvent)=>{if(e.origin===location.origin&&e.source===frame.current?.contentWindow&&e.data?.type==='subscriptions-session-expired')window.dispatchEvent(new Event('lifeos-session-expired'));};
    window.addEventListener('message',message);
    return()=>window.removeEventListener('message',message);
  },[]);
  useEffect(theme,[resolved]);
  useEffect(()=>{frame.current?.contentWindow?.postMessage({type:'subscriptions-refresh'},location.origin);},[refresh]);
  const shell=owner?__SUBSCRIPTIONS_SHELL__:__SUBSCRIPTIONS_SHELL__.replace('<html','<html data-access="visitor"');
  return <iframe ref={frame} onLoad={theme} srcDoc={shell} title="订阅：到期、余额、银行卡与统计"
    className="min-h-0 w-full flex-1 border-0 bg-background" />;
}
