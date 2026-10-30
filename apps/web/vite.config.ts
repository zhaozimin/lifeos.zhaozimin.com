/**
 * [INPUT]: React、Vite与SubOS静态宿主；ui模式加载演示插件。
 * [OUTPUT]: 生产静态页面或独立的本机演示服务器。
 * [POS]: 前端构建边界；生产Worker仍由build.mjs编译。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {healthRevision} from './health-version.mjs';
import {readFileSync} from 'node:fs';
export default defineConfig(async({mode,command})=>({
  plugins: [react(), tailwindcss(),...(command==='serve'&&mode==='ui'?[(await import('./preview/plugin')).uiPreview()]:[])],
  define:{__HEALTH_REVISION__:JSON.stringify(healthRevision()),__SUBSCRIPTIONS_SHELL__:JSON.stringify(readFileSync(new URL('../subscriptions/cloud-web/index.html',import.meta.url),'utf8'))},
  build: { sourcemap: false },
  server:{host:'127.0.0.1',port:5173,strictPort:true,fs:{deny:[
    '.env','.env.*','*.{crt,pem,key,p12,pfx,cer,der}','.npmrc','.yarnrc.yml','**/.git/**',
    '**/.dev.vars*','**/.private/**','**/.wrangler/**','**/*.sqlite*','**/*.db',
  ]}},
}));
