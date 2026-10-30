/**
 * [INPUT]: 依赖Router、shell和订阅页面；嵌入使用独立内存导航
 * [OUTPUT]: 在LifeOS订阅子路径提供独立导航与左右壳。左边栏固定，右侧主列居中自适应。换页淡入淡出
 * [POS]: web 的应用壳。提醒循环挂在壳上，换页也投递
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useRef } from "react";
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { EditorSheet } from "./components/EditorSheet";
import { Sidebar } from "./components/Sidebar";
import { PrivacyProvider } from "./components/Veil";
import { ConfirmProvider } from "./components/ui/confirm";
import { useRefresh } from "./lib/refresh";
import { deliverDueReminders } from "./lib/notify";
import { BoardPage } from "./pages/Board";
import { CardsPage } from "./pages/Cards";
import { MethodsPage } from "./pages/Methods";
import { StatsPage } from "./pages/Stats";
import { ShellProvider } from "./shell";
import {isVisitor} from './visitor';
import {VisitorPrivate} from './pages/VisitorDetail';

function ReminderLoop() {
  const inflight = useRef(false);
  useRefresh(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try { await deliverDueReminders(); }
    catch { /* 失败租约过期可重试，不挡页面 */ }
    finally { inflight.current = false; }
  });
  return null;
}

function paneToken(path: string): string {
  if (path === "/new" || path.startsWith("/s/")) return "/";
  return path;
}

function Frame() {
  const location = useLocation();
  const navigate=useNavigate();
  useEffect(()=>{
    const route=(event:Event)=>{
      const path=(event as CustomEvent<{path:string}>).detail?.path;
      if(typeof path==='string'&&/^\/s\/[a-zA-Z0-9_-]+$/.test(path))navigate(path);
    };
    window.addEventListener('subos:navigate',route);
    return()=>window.removeEventListener('subos:navigate',route);
  },[navigate]);
  return (
    <div className="app-frame">
      <Sidebar />
      <main className="app-main">
        <div className="app-main-inner">
          {isVisitor()&&<p className="quiet mb-5">访客只读 · 价格与账号已打码，费用曲线仅作示意。</p>}
          <div key={paneToken(location.pathname)} className="pane-in">
            <Routes>
              <Route path="/cards" element={isVisitor()?<VisitorPrivate title="银行卡 · 私人信息不公开"/>:<CardsPage />} />
              <Route path="/methods" element={isVisitor()?<VisitorPrivate title="订阅设置"/>:<MethodsPage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="*" element={<BoardPage />} />
            </Routes>
          </div>
        </div>
      </main>
      <EditorSheet />
    </div>
  );
}

export function App() {
  const content=(
    <PrivacyProvider>
      <ConfirmProvider>
        <ShellProvider>
          {!isVisitor()&&<ReminderLoop />}
          <Frame />
        </ShellProvider>
      </ConfirmProvider>
    </PrivacyProvider>
  );
  if(window.parent!==window){
    return <MemoryRouter basename="/subscriptions-console" initialEntries={["/subscriptions-console/"]}>{content}</MemoryRouter>;
  }
  return <BrowserRouter basename={window.location.pathname.startsWith("/subscriptions-console")?"/subscriptions-console":undefined}>{content}</BrowserRouter>;
}
