/**
 * [INPUT]: 仅内部服务可达的来源散列与Cloudflare限流绑定。
 * [OUTPUT]: 共享认证窗口的204或429；不转发到VPS。
 * [POS]: 内部服务的认证保护能力；不读取密码、动态码或账户。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export interface AuthLimiter {limit(input:{key:string}):Promise<{success:boolean}>}
export async function authLimit(request:Request,limiter?:AuthLimiter):Promise<Response>{
 const headers={'Cache-Control':'private, no-store','Retry-After':'60'};
 if(request.method!=='POST')return new Response(null,{status:405,headers});
 if(!limiter)return new Response(null,{status:503,headers});
 if(Number(request.headers.get('Content-Length'))>256)return new Response(null,{status:413,headers});
 try{
  const body=await request.text();
  if(body.length>256)return new Response(null,{status:413,headers});
  const value=JSON.parse(body);
  if(!value||typeof value!=='object'||Object.keys(value).length!==1||typeof value.key!=='string'||!/^[a-f0-9]{64}$/.test(value.key))return new Response(null,{status:400,headers});
  const {success}=await limiter.limit({key:'auth:'+value.key});
  return new Response(null,{status:success?204:429,headers});
 }catch{return new Response(null,{status:503,headers});}
}
