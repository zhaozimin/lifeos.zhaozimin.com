/**
 * [INPUT]: 私有配置、微信会话、MemOS云、仓储与官方agy规则。
 * [OUTPUT]: 常驻接收器，或不收发消息的部署健康检查。
 * [POS]: 唯一组合入口；记忆网络故障不阻止已通过本机检查的微信服务。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { readConfig } from './config.js';
import { errorCode } from './errors.js';
import { SupabaseStore } from './store/supabase.js';
import { AntigravityParser } from './parser/antigravity.js';
import { FileCheckpoint } from './channel/checkpoint.js';
import { ILinkHttp } from './channel/http.js';
import { WeChatChannel } from './channel/wechat.js';
import { runWorker } from './worker.js';
import { createLogger } from './logger.js';
import { verifyWorkspaceRules } from './parser/rules.js';
import { MemOSCloud } from './memory/cloud.js';

process.umask(0o077);
const logger = createLogger(process.env.LOG_LEVEL ?? 'info');
const stop = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => stop.abort());

try {
  const config = readConfig();
  const credentials = z.object({ token: z.string().min(1), baseUrl: z.url(), accountId: z.string().min(1),
    userId: z.string().min(1) }).parse(JSON.parse(await readFile(join(config.WECHAT_STATE_DIR, 'credentials.json'), 'utf8')));
  const store = new SupabaseStore(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, config.OWNER_AUTH_ID);
  const parser = new AntigravityParser(config.PARSER_ENABLED === 'true', {
    binary: config.AGY_BIN, model: config.AGY_MODEL, workspace: config.AGY_WORKSPACE,
  });
  const memory=config.MEMOS_ENABLED==='true'?new MemOSCloud({key:config.MEMOS_API_KEY!,
    userId:`lifeos:${config.OWNER_AUTH_ID}`,agentId:config.MEMOS_AGENT_ID,baseUrl:config.MEMOS_BASE_URL,
    recallTimeoutMs:config.MEMOS_RECALL_TIMEOUT_MS}):undefined;
  await store.check();
  if (parser.enabled) {
    await access(config.AGY_BIN, constants.X_OK);
    await verifyWorkspaceRules(config.AGY_WORKSPACE);
  }
  const channel = new WeChatChannel(new ILinkHttp(credentials),
    new FileCheckpoint(join(config.WECHAT_STATE_DIR, 'relay-cursor.json'), credentials.accountId), credentials);
  logger.info({ event: 'relay_ready', parser_enabled: parser.enabled, model: config.AGY_MODEL,memory_enabled:Boolean(memory) });
  if (!process.argv.includes('--check')) {
    const worker = runWorker(store, parser, channel, logger, stop.signal,memory?{backend:memory,queue:store}:undefined);
    try {
      await channel.run(async (input) => {
        const id = await store.saveRaw(input, !parser.enabled);
        logger.info({ event: 'raw_saved', input_id: id });
      }, stop.signal);
    } finally {
      stop.abort();
      await worker;
    }
  }
} catch (error) {
  logger.fatal({ event: 'relay_stopped', code: errorCode(error) });
  process.exitCode = 1;
}
