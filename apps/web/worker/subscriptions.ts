/**
 * [INPUT]: 已验证本人AAL2的请求、JSON动作及私有订阅服务。
 * [OUTPUT]: 原版SubOS响应；过滤浏览器凭据和任意目标。
 * [POS]: LifeOS订阅网络适配；认证由唯一Worker入口完成。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {z} from 'zod';
import {HttpError} from './auth';
import type {PrivateService} from '../../subscriptions/edge/index';
const input=z.object({method:z.enum(['GET','POST','PUT','DELETE']),path:z.string().max(4096).startsWith('/v1/'),body:z.unknown().optional()}).strict();
export async function subscriptions(service:PrivateService|undefined,url:URL,method:string,payload?:unknown):Promise<Response>{
  if(!service)throw new HttpError(503,'订阅服务尚未连接。');
  let path=url.pathname.slice('/api/subscriptions'.length),verb=method,content:unknown;
  if(method==='POST'&&path==='/request'){
    const data=input.parse(payload);path=data.path;verb=data.method;content=data.body;
  }else if(method!=='GET'||!/^\/(icons|card-covers)\//.test(path))throw new HttpError(404,'订阅接口不存在。');
  if(path.startsWith('//')||path.includes('#'))throw new HttpError(400,'订阅路径无效。');
  return service.fetch(new Request('https://subos.internal'+path,{method:verb,
    headers:content===undefined?{}:{'Content-Type':'application/json'},body:verb==='GET'?undefined:JSON.stringify(content??{})}));
}
