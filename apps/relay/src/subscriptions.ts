/**
 * [INPUT]: 私有数据库配置、当前微信绑定与VPS订阅API。
 * [OUTPUT]: 七天扣款提醒入队，或不写数据库的只读预览。
 * [POS]: 独立定时任务入口；复用传话筒投递，不启动微信轮询或模型。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { readConfig } from './config.js';
import { createLogger } from './logger.js';
import { errorCode, RelayError } from './errors.js';
import { SupabaseStore } from './store/supabase.js';
import { readSubscriptions, sevenDayReminders, enqueueSubscriptionReminders } from './subscription-reminders.js';

process.umask(0o077);
const logger = createLogger(process.env.LOG_LEVEL ?? 'info');
try {
  const args = process.argv.slice(2);
  if (args.length>1 || (args.length===1 && args[0]!=='--dry-run')) {
    throw new RelayError('SUBSCRIPTIONS_ARGUMENT_INVALID');
  }
  const reminders = sevenDayReminders(await readSubscriptions());
  if (args[0]==='--dry-run') {
    process.stdout.write(JSON.stringify({due:reminders},null,2)+'\n');
  } else {
    const config = readConfig();
    const binding = z.object({accountId:z.string().min(1),userId:z.string().min(1)}).parse(
      JSON.parse(await readFile(join(config.WECHAT_STATE_DIR,'credentials.json'),'utf8')));
    const store = new SupabaseStore(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,config.OWNER_AUTH_ID);
    const results = await enqueueSubscriptionReminders(store,binding,reminders);
    logger.info({event:'subscription_reminders_schedule',due:reminders.length,
      queued:results.filter(item=>item.queued).length,reasons:results.map(item=>item.reason)});
  }
} catch (error) {
  logger.error({event:'subscription_reminders_failed',code:errorCode(error)});
  process.exitCode=1;
}
