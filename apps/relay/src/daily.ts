/**
 * [INPUT]: 私有 Supabase 配置、每日日历与确定性回执渲染器。
 * [OUTPUT]: 幂等小结入队，或不发送消息的只读预览。
 * [POS]: 日历任务组合入口；复用现有 outbox，不读取微信或模型凭据。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { z } from 'zod';
import { readConfig } from './config.js';
import { createLogger } from './logger.js';
import { errorCode, RelayError } from './errors.js';
import { SupabaseStore } from './store/supabase.js';
import { formatDaily } from './reply.js';

process.umask(0o077);
const logger = createLogger(process.env.LOG_LEVEL ?? 'info');
try {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const atIndex = args.indexOf('--at');
  const parsedAt = atIndex>=0 ? z.iso.datetime({offset:true}).safeParse(args[atIndex+1]) : undefined;
  if (parsedAt && !parsedAt.success) throw new RelayError('DAILY_ARGUMENT_INVALID');
  const at = parsedAt?.data;
  if (at && !dryRun) throw new RelayError('DAILY_PREVIEW_ONLY');
  if (args.some((arg,index)=>arg!=='--dry-run' && arg!=='--at' && (atIndex<0 || index!==atIndex+1))) throw new RelayError('DAILY_ARGUMENT_INVALID');
  const config = readConfig();
  const store = new SupabaseStore(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,config.OWNER_AUTH_ID);
  await store.check();
  if (dryRun) process.stdout.write(formatDaily(await store.dailySummary(at))+'\n');
  else logger.info({event:'daily_summary_schedule',...await store.enqueueDailySummary()});
} catch (error) {
  logger.error({event:'daily_summary_failed',code:errorCode(error)});
  process.exitCode=1;
}
