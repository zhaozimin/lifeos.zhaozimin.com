/**
 * [INPUT]: Vite、合成账本、健康与订阅资源及共用侧栏样式。
 * [OUTPUT]: 免登录的演示面板与会话内编辑；停止后回收临时订阅库；订阅子页重建后自动重载配置。
 * [POS]: 仅ui开发模式挂载；不改变生产Worker与认证代码。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {Plugin} from 'vite';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {request as httpRequest} from 'node:http';
import {spawn} from 'node:child_process';
import {existsSync,watchFile,unwatchFile,type Stats} from 'node:fs';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {demoDatabase} from './database';
import {native} from '../worker/native';
import {records,recordDetail,editRecord} from '../worker/records';
import {dashboard} from '../worker/data';
// @ts-expect-error 原版JavaScript构建模块没有声明文件。
import {buildHealthUi} from '../health-ui.mjs';
// @ts-expect-error 演示健康模块复用原版JavaScript领域引擎。
import {demoHealth} from './health.mjs';
const subsRoot=fileURLToPath(new URL('../../subscriptions/cloud-web/',import.meta.url));
const sidebarCss=fileURLToPath(new URL('../src/dashboard/components/shell/sidebar.css',import.meta.url));
const mime:Record<string,string>={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.html':'text/html'};
async function body(req:IncomingMessage){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2e6)throw Object.assign(new Error('演示请求过大'),{status:413});}return raw?JSON.parse(raw):{};}
function json(res:ServerResponse,data:unknown,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
export function uiPreview():Plugin{
  const {client}=demoDatabase(),health=demoHealth();
  return {name:'lifeos-ui-preview',apply:'serve',
    transformIndexHtml(html){const label=existsSync(fileURLToPath(new URL('../.private/subos-preview.sqlite3',import.meta.url)))?'合成数据 · 订阅为本机快照':'合成数据';return html.replace('</body>',`<div style="position:fixed;bottom:6px;right:12px;z-index:99999;background:#172b20;color:white;border-radius:8px;padding:5px 10px;font:12px system-ui;pointer-events:none">本地UI演示 · ${label}</div></body>`);},
    async configureServer(server){
      const temporary=await mkdtemp(path.join(tmpdir(),'lifeos-ui-'));
      const healthRoot=path.join(temporary,'health');
      await buildHealthUi(new URL(`file://${healthRoot}/`));
      const child=spawn('python3',[fileURLToPath(new URL('./subscriptions.py',import.meta.url)),temporary],{stdio:['ignore','pipe','inherit']});
      let port:number;
      try{port=await new Promise<number>((resolve,reject)=>{
        const timer=setTimeout(()=>{child.kill();reject(new Error('演示订阅服务启动超时'));},15000);
        child.once('error',error=>{clearTimeout(timer);reject(error);});
        child.once('exit',code=>{clearTimeout(timer);reject(new Error(`演示订阅服务退出：${code}`));});
        child.stdout.once('data',chunk=>{clearTimeout(timer);const value=Number(String(chunk).trim());if(!Number.isInteger(value))reject(new Error('演示端口无效'));else resolve(value);});
      });}catch(error){child.kill();await rm(temporary,{recursive:true,force:true});throw error;}
      let cleaned=false;
      const cleanup=async()=>{if(cleaned)return;cleaned=true;
        if(child.exitCode===null&&child.signalCode===null)await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill();});
        await rm(temporary,{recursive:true,force:true});};
      server.httpServer?.once('close',()=>void cleanup());
      server.watcher.add([fileURLToPath(new URL('../../whoop/public/',import.meta.url)),subsRoot,sidebarCss]);
      let rebuilding=Promise.resolve();
      server.watcher.on('change',file=>{
        if(file.includes('/whoop/public/')||file.includes('/web/health-')||file===sidebarCss){
          rebuilding=rebuilding.then(()=>buildHealthUi(new URL(`file://${healthRoot}/`))).then(()=>{server.ws.send({type:'full-reload'});}).catch(error=>server.config.logger.error(String(error)));
        }
      });
      // 订阅外壳在配置期经 define 固化；重建后旧资源名失效，必须重载配置而不是只刷新页面。
      // 重建会先清空输出目录再写入，外接磁盘上的文件事件不可靠，所以对这一个文件改用定时比对修改时间。
      const subsShell=path.join(subsRoot,'index.html');
      const onShell=(current:Stats,previous:Stats)=>{
        if(current.mtimeMs&&current.mtimeMs!==previous.mtimeMs)void server.restart().catch(error=>server.config.logger.error(String(error)));
      };
      watchFile(subsShell,{interval:500},onShell);
      server.httpServer?.once('close',()=>unwatchFile(subsShell,onShell));
      server.middlewares.use(async(req,res,next)=>{
        const url=new URL(req.url||'/','http://127.0.0.1:5173');
        const host=req.headers.host||'';
        if(!['127.0.0.1:5173','localhost:5173'].includes(host)){json(res,{message:'预览仅接受本机地址'},403);return;}
        if(req.headers.origin&&!['http://127.0.0.1:5173','http://localhost:5173'].includes(req.headers.origin)){json(res,{message:'预览拒绝其他页面来源'},403);return;}
        try{
          if(/(?:^|\/)(?:\.private|\.wrangler|\.dev\.vars[^/]*)(?:\/|$)/.test(decodeURIComponent(url.pathname))){json(res,{message:'私有文件不属于UI预览'},403);return;}
          const asset=url.pathname.startsWith('/health-console/')?[healthRoot,url.pathname.slice(16)]:
            url.pathname.startsWith('/subscriptions-console/')?[subsRoot,url.pathname.slice(23)]:null;
          if(asset){const file=path.resolve(asset[0],decodeURIComponent(asset[1]));
            if(!file.startsWith(path.resolve(asset[0])+path.sep)||(await stat(file)).isDirectory()){json(res,{message:'资源不存在'},404);return;}
            res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(await readFile(file));return;}
          if(/^\/(?:v1|icons|card-covers)\//.test(url.pathname)){
            if(url.pathname.startsWith('/icons/')){res.writeHead(404);res.end();return;}
            if(/^\/v1\/(?:card-identify|card-cover|logo)/.test(url.pathname)){json(res,{error:'UI演示不调用外部识别或图片服务'},422);return;}
            const upstream=httpRequest({hostname:'127.0.0.1',port,path:url.pathname+url.search,method:req.method,
              headers:{'Content-Type':'application/json','Host':`127.0.0.1:${port}`}},response=>{res.writeHead(response.statusCode||502,response.headers);response.pipe(res);});
            upstream.on('error',()=>json(res,{error:'演示订阅服务未连接'},502));req.pipe(upstream);return;
          }
          if(!url.pathname.startsWith('/api/')){next();return;}
          const input=req.method==='POST'?await body(req):{};
          if(url.pathname==='/api/session'){json(res,{stage:'ready'});return;}
          if(url.pathname==='/api/auth/logout'){json(res,{ok:true});return;}
          if(url.pathname==='/api/native'){json(res,await native(client,input));return;}
          if(url.pathname.startsWith('/api/health/')){json(res,health(url,req.method,input));return;}
          if(url.pathname==='/api/dashboard'){json(res,await dashboard(client,url));return;}
          if(url.pathname==='/api/records'){json(res,await records(client,url));return;}
          if(url.pathname==='/api/record'){json(res,await recordDetail(client,url));return;}
          if(url.pathname==='/api/records/edit'){json(res,await editRecord(client,input));return;}
          json(res,{message:'该动作未纳入UI演示，请使用正式站。'},422);
        }catch(error){const e=error as {status?:number;message?:string;code?:string};json(res,{message:e.code==='ENOENT'?'资源不存在':e.message||'演示请求失败'},e.code==='ENOENT'?404:e.status||422);}
      });
    },
  };
}
