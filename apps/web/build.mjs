/**
 * [INPUT]: Worker源码、Vite主站与SubOS嵌入构建。
 * [OUTPUT]: Pages Worker及健康、订阅原版子页面。
 * [POS]: 高级模式构建入口；不打包服务端凭据。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { build } from "esbuild";
import { cp,rm,access } from "node:fs/promises";
import { buildHealthUi } from './health-ui.mjs';
await build({
  entryPoints: ["worker/index.ts"],
  outfile: "dist/_worker.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  minify: true,
});
await rm("dist/CLAUDE.md", { force: true });
await buildHealthUi();

const subscriptionsSource=new URL('../subscriptions/cloud-web/',import.meta.url);
await access(new URL('index.html',subscriptionsSource));
await cp(subscriptionsSource,new URL('./dist/subscriptions-console/',import.meta.url),{recursive:true});
