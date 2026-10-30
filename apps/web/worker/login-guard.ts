/**
 * [INPUT]: Cloudflare可信来源IP与内部服务绑定。
 * [OUTPUT]: 密码和动态码入口的共享限流检查。
 * [POS]: 在恢复会话前拦截重复尝试；故障时拒绝放行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {HttpError,type Env} from './auth';
const protectedPaths=new Set(['/api/auth/login','/api/auth/verify','/api/auth/password','/api/auth/enroll']);
export async function guardLogin(request:Request,env:Env){
 if(request.method!=='POST'||!protectedPaths.has(new URL(request.url).pathname))return;
 // 不接受X-Forwarded-For、请求正文或Cookie提供的限流身份。
 const ip=request.headers.get('CF-Connecting-IP');
 if(!ip||!env.SUBSCRIPTIONS)throw new HttpError(503,'登录保护暂时不可用，请稍后重试');
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('lifeos-auth-v1:'+ip));
 const key=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
 let response:Response;
 try{
  response=await env.SUBSCRIPTIONS.fetch(new Request('https://subos.internal/internal/auth/limit',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key}),signal:AbortSignal.timeout(5000),
  }));
 }catch{throw new HttpError(503,'登录保护暂时不可用，请稍后重试');}
 if(response.status===429)throw new HttpError(429,'尝试过于频繁，请等待一分钟后重试');
 if(response.status!==204)throw new HttpError(503,'登录保护暂时不可用，请稍后重试');
}
