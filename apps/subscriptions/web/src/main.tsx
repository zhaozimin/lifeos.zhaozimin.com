/**
 * [INPUT]: 依赖react-dom、App、样式入口 index.css（含锁版本 zzm.css）和LifeOS宿主桥接
 * [OUTPUT]: 对外提供看板挂载
 * [POS]: web 的浏览器入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import "./lifeos-bridge";

const root = document.getElementById("root");
if (!root) {
  throw new Error("找不到 #root");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
