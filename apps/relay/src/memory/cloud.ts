/**
 * [INPUT]: VPS私有MemOS凭据、稳定身份与持久化消息任务。
 * [OUTPUT]: 限量记忆召回、异步写入任务与安全错误分类。
 * [POS]: 唯一MemOS HTTP边界；不打印正文、认证头或上游错误响应。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { MemoryBackend, MemoryHit, MemoryJob } from '../contracts.js';
import { RelayError } from '../errors.js';

export class MemoryError extends RelayError {
  constructor(code: string, public readonly retryable: boolean, public readonly ambiguous = false) { super(code); }
}
type Options={key:string;userId:string;agentId:string;baseUrl?:string;recallTimeoutMs?:number};
const official='https://memos.memtensor.cn/api/openmem/v1';
const clip=(value:string,n:number)=>Array.from(value).slice(0,n).join('');
export class MemOSCloud implements MemoryBackend {
  private readonly baseUrl:string;
  constructor(private readonly options:Options,private readonly fetcher:typeof fetch=fetch){
    this.baseUrl=(options.baseUrl??official).replace(/\/$/,'');
    if(this.baseUrl!==official||!options.key||!options.userId||!options.agentId)throw new MemoryError('MEMOS_CONFIG_INVALID',false);
  }
  private async post(route:string,body:unknown,timeout:number,writing=false):Promise<Record<string,unknown>>{
    let response:Response;
    try{
      response=await this.fetcher(this.baseUrl+route,{method:'POST',headers:{'Content-Type':'application/json',
        Authorization:`Token ${this.options.key}`},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
    }catch{throw new MemoryError('MEMOS_NETWORK_FAILED',true,writing);}
    if(!response.ok)throw new MemoryError(`MEMOS_HTTP_${response.status}`,
      response.status===429||response.status>=500,writing&&response.status>=500);
    let data:Record<string,unknown>;
    try{data=await response.json() as Record<string,unknown>;}catch{throw new MemoryError('MEMOS_JSON_INVALID',true,writing);}
    if(!data||typeof data!=='object'||Array.isArray(data)||data.code!==0){
      const code=typeof data?.code==='number'?String(data.code):'INVALID';
      throw new MemoryError(`MEMOS_API_${code}`,false,writing&&code==='INVALID');
    }
    if(!data.data||typeof data.data!=='object'||Array.isArray(data.data))throw new MemoryError('MEMOS_RESPONSE_INVALID',true,writing);
    return data.data as Record<string,unknown>;
  }
  async search(query:string):Promise<MemoryHit[]>{
    if(!query.trim())return [];
    const data=await this.post('/search/memory',{user_id:this.options.userId,query:clip(query,1000),
      filter:{and:[{agent_id:this.options.agentId}]},include_memory_view:['detail_factual','preference','profile','event'],
      memory_limit_number:5},this.options.recallTimeoutMs??3000);
    const hits:MemoryHit[]=[];const ids=new Set<string>();let budget=6000;
    for(const [field,kind] of [['memory_detail_list','fact'],['preference_detail_list','preference'],
      ['profile_detail_list','profile'],['event_detail_list','event']] as const){
      const rows=data[field];if(!Array.isArray(rows))continue;
      for(const row of rows){
        if(!row||typeof row!=='object'||typeof row.id!=='string'||ids.has(row.id))continue;
        const value=[row.memory_value,row.preference,row.memory,row.event_value].find(x=>typeof x==='string'&&x.trim());
        if(typeof value!=='string')continue;
        const content=clip(value,Math.min(1200,budget));if(!content)continue;
        hits.push({id:row.id,kind,content,...(typeof row.conversation_id==='string'?{conversation_id:row.conversation_id}:{})});
        budget-=Array.from(content).length;ids.add(row.id);
        if(hits.length===5||budget===0)return hits;
      }
    }
    return hits;
  }
  async submit(job:MemoryJob):Promise<{task_id:string;status:string}>{
    if(!job.content.trim()||Buffer.byteLength(job.content,'utf8')>100_000)throw new MemoryError('MEMOS_MESSAGE_SIZE_INVALID',false);
    const date=new Date(job.happened_at);
    if(!Number.isFinite(date.getTime()))throw new MemoryError('MEMOS_MESSAGE_TIME_INVALID',false);
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',
      day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
    const data=await this.post('/add/message',{user_id:this.options.userId,agent_id:this.options.agentId,
      conversation_id:job.conversation_id,allow_public:false,async_mode:true,
      allow_memory_view:['detail_factual','preference','profile','event'],
      messages:[{role:job.role,content:job.content,chat_time:`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`}],
      info:{source:'lifeos-wechat',source_message_id:job.message_id,source_input_id:job.raw_input_id}},15000,true);
    if(typeof data.task_id!=='string'||!data.task_id)throw new MemoryError('MEMOS_TASK_MISSING',false,true);
    return {task_id:data.task_id,status:typeof data.status==='string'?data.status:'running'};
  }
  async status(taskId:string):Promise<'running'|'completed'|'failed'>{
    const data=await this.post('/get/status',{task_id:taskId},15000);
    if(!['running','completed','failed'].includes(String(data.status)))throw new MemoryError('MEMOS_STATUS_INVALID',true);
    return data.status as 'running'|'completed'|'failed';
  }
}
