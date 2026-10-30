/**
 * [INPUT]: pino 与经校验的日志级别。
 * [OUTPUT]: 传话筒和日历任务共享的安全日志工厂。
 * [POS]: 日志边界；不记录原话、渠道载荷或凭据。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import pino from 'pino';
export function createLogger(level = 'info') {
  return pino({ level,
    redact: { paths: ['token','payload','text','SUPABASE_SERVICE_ROLE_KEY','credentials'], censor: '[隐藏]' },
  });
}
