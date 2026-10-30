/**
 * [INPUT]: LifeOS内部服务请求、限流及固定VPC绑定。
 * [OUTPUT]: 认证限流、SubOS白名单接口及私有图片响应。
 * [POS]: 私有网络边界；只访问VPS回环18787，不接收任意目标。
 * 公开目录仍经内部服务绑定；金额和银行卡路径不公开。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {authLimit,type AuthLimiter} from './auth-limit';
export interface PrivateService {fetch(request:Request):Promise<Response>}
const resource = /^\/v1\/(subscriptions|accounts|payment-methods|cards|categories)(?:\/[a-zA-Z0-9_-]+)?$/;
export function allowedRequest(path:string,method:string):boolean{
  if(path.includes('%')||path.includes('\\')||path.includes('..'))return false;
  if(method==='GET')return resource.test(path)||/^\/v1\/(health|summary|reminders|logo|card-cover\/ai-status)$/.test(path)
    ||['/v1/visitor/catalog','/v1/visitor/catalog-v2'].includes(path)||/^\/v1\/visitor\/logo\/[a-f0-9]{24}$/.test(path)
    ||/^\/icons\/[0-9]+\.jpg$/.test(path)||/^\/card-covers\/[a-f0-9]{24}\.(jpg|png|webp)$/.test(path);
  if(method==='POST')return resource.test(path)||/^\/v1\/subscriptions\/[a-zA-Z0-9_-]+\/(balance|top-up|confirm-renewal|pause|resume)$/.test(path)
    ||/^\/v1\/(reminders\/(claim|release|ack)|card-identify|card-cover\/(search|resolve|ai-generate))$/.test(path);
  return ['PUT','DELETE'].includes(method)&&resource.test(path);
}
export default {
  async fetch(request:Request,env:{SUBOS_ORIGIN:PrivateService;AUTH_LIMITER?:AuthLimiter}):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname==='/internal/auth/limit')return authLimit(request,env.AUTH_LIMITER);
    if(!allowedRequest(url.pathname,request.method))return Response.json({error:'订阅接口不存在或不可在云端执行。'},{status:404});
    const headers=new Headers({Accept:request.headers.get('Accept')||'*/*'});
    if(request.method!=='GET')headers.set('Content-Type','application/json');
    const target=new URL(url.pathname+url.search,'http://127.0.0.1:18787');
    try{
      const result=await env.SUBOS_ORIGIN.fetch(new Request(target,{method:request.method,headers,
        body:request.method==='GET'?undefined:await request.arrayBuffer(),redirect:'manual',signal:AbortSignal.timeout(170000)}));
      const safe=new Headers({'Content-Type':result.headers.get('Content-Type')||'application/octet-stream','Cache-Control':'private, no-store'});
      return new Response(result.body,{status:result.status,headers:safe});
    }catch{return Response.json({error:'订阅服务暂时无法连接，请稍后核对操作结果。'},{status:503});}
  }
};
