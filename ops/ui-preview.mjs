/**
 * [INPUT]: 本机Node、Python与三个面板的完整源码。
 * [OUTPUT]: 127.0.0.1:5173演示预览；缺少依赖时安装锁定版本。
 * [POS]: 根目录UI启动入口；不读取云端凭据或启动正式服务。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const run=(args)=>new Promise((resolve,reject)=>{
  const child=spawn('npm',args,{cwd:root,stdio:'inherit'});
  child.on('error',reject);
  child.on('exit',code=>code===0?resolve():reject(new Error(`npm退出码：${code}`)));
});
for(const app of ['apps/web','apps/subscriptions/web']){
  if(!existsSync(`${root}${app}/node_modules/.package-lock.json`))await run(['--prefix',app,'ci']);
}
await run(['--prefix','apps/subscriptions/web','run','build']);
await run(['--prefix','apps/web','run','ui']);
