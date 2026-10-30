/**
 * [INPUT]: 持久化记忆队列、MemOS接口与统一安全日志。
 * [OUTPUT]: 可恢复的云端同步，已接受任务只轮询，不重复提交。
 * [POS]: 独立后台工作器；不运行agy，也不阻塞微信收发。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { setTimeout as delay } from 'node:timers/promises';
import type { Logger } from 'pino';
import type { MemoryBackend,MemoryQueue,MemoryOutcome } from '../contracts.js';
import { errorCode } from '../errors.js';
import { MemoryError } from './cloud.js';

export async function syncMemoryOnce(queue:MemoryQueue,backend:MemoryBackend,logger:Logger):Promise<boolean>{
  const job=await queue.claimMemory();if(!job)return false;
  let taskId=job.task_id;
  try{
    let state:MemoryOutcome;
    if(!taskId){
      const result=await backend.submit(job);taskId=result.task_id;
      state=result.status==='completed'?'completed':result.status==='failed'?'failed':'processing';
    }else{
      const status=await backend.status(taskId);state=status==='running'?'processing':status;
    }
    await queue.finishMemory(job,state,taskId,state==='failed'?'MEMOS_TASK_FAILED':undefined);
    logger.info({event:'memory_sync',job_id:job.id,state});
  }catch(error){
    const state:MemoryOutcome=taskId?'retry':error instanceof MemoryError
      ?error.ambiguous?'unknown':error.retryable?'retry':'failed':'unknown';
    await queue.finishMemory(job,state,taskId,errorCode(error));
    logger.warn({event:'memory_sync_deferred',job_id:job.id,state,code:errorCode(error)});
  }
  return true;
}
export async function runMemorySync(queue:MemoryQueue,backend:MemoryBackend,logger:Logger,signal:AbortSignal):Promise<void>{
  while(!signal.aborted){
    let work=false;
    try{work=await syncMemoryOnce(queue,backend,logger);}catch(error){logger.warn({event:'memory_queue_deferred',code:errorCode(error)});}
    if(!work)await delay(2000,undefined,{signal}).catch(()=>{});
  }
}
