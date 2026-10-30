/**
 * [INPUT]: VPS 环境变量与固定部署目录。
 * [OUTPUT]: 经校验的微信、agy及可选MemOS私有配置。
 * [POS]: 启动边界；云记忆默认关闭，启用时要求独立凭据。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { z } from 'zod';

const Env = z.object({
  SUPABASE_URL: z.url().refine((value) => value.startsWith('https://')),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  OWNER_AUTH_ID: z.uuid(),
  WECHAT_STATE_DIR: z.string().default('/var/lib/lifeos/wechat'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PARSER_ENABLED: z.enum(['true', 'false']).default('true'),
  AGY_BIN: z.string().default('/home/lifeos/.local/bin/agy'),
  AGY_MODEL: z.string().default('gemini-3.8-flash-low'),
  AGY_WORKSPACE: z.string().default('/var/lib/lifeos/parser-workspace'),
  MEMOS_ENABLED:z.enum(['true','false']).default('false'),
  MEMOS_API_KEY:z.string().optional(),
  MEMOS_BASE_URL:z.literal('https://memos.memtensor.cn/api/openmem/v1').default('https://memos.memtensor.cn/api/openmem/v1'),
  MEMOS_AGENT_ID:z.string().min(1).max(100).default('lifeos-butler'),
  MEMOS_RECALL_TIMEOUT_MS:z.coerce.number().int().min(1000).max(8000).default(3000),
}).refine(x=>x.MEMOS_ENABLED!=='true'||Boolean(x.MEMOS_API_KEY?.trim()),{path:['MEMOS_API_KEY'],message:'enabled memory requires private credentials'});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = Env.safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path[0]))];
    throw new Error(`配置缺失或格式错误：${names.join(', ')}`);
  }
  return result.data;
}
export type Config = ReturnType<typeof readConfig>;
