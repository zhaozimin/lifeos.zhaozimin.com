/**
 * [INPUT]: 依赖 Vite、React 与 Tailwind 构建插件
 * [OUTPUT]: 云端资源写入cloud-web，使用订阅子路径；开发代理保留回环
 * [POS]: 前端构建与开发服务边界，不参与生产 HTTP 路由
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({mode})=>({
  plugins: [react(), tailwindcss()],
  base: mode==="standalone"?"/":"/subscriptions-console/",
  build: {
    outDir: mode==="standalone"?"../server/web":"../cloud-web",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "/icons": { target: "http://127.0.0.1:18787", changeOrigin: true },
      "/card-covers": { target: "http://127.0.0.1:18787", changeOrigin: true },
      "/v1": {
        target: "http://127.0.0.1:18787",
        changeOrigin: true,
      },
    },
  },
}));
