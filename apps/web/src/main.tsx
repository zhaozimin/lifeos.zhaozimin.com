/**
 * [INPUT]: React 根节点、BrowserRouter、App 与原版样式。
 * [OUTPUT]: 以 /dashboard 为基路径挂载云端原版界面，并开启「滚动时才显示滚动条」。
 * [POS]: 唯一前端入口；不初始化 Supabase 或保存认证令牌。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createRoot } from "react-dom/client";
import App from "./App";
import { BrowserRouter } from "react-router";
import "./dashboard/index.css";
import "./style.css";
import { revealScrollbarsWhileScrolling } from "./dashboard/lib/scrollbars";

revealScrollbarsWhileScrolling();
createRoot(document.getElementById("root")!).render(<BrowserRouter basename="/dashboard"><App /></BrowserRouter>);
