/**
 * [INPUT]: 已修正扫码等待的微信 SDK；qrcode 的 PNG 渲染；私有状态目录。
 * [OUTPUT]: 登录二维码、脱敏状态 JSON 与 SDK 持久化会话。
 * [POS]: ops 的一次性授权入口；只登录，不调用消息接收或发送接口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { WeChatBot } from '@wechatbot/wechatbot';
import QRCode from 'qrcode';
import { mkdir, chmod, writeFile, rename, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { isAbsolute, join } from 'node:path';

process.umask(0o077);

// ============================================================
// 凭据与短期二维码共用私有目录，状态文件仅包含安全字段。
// ============================================================
const stateDir = process.env.LIFEOS_WECHAT_DIR ?? '/var/lib/lifeos/wechat';
if (!isAbsolute(stateDir)) throw new Error('微信状态目录必须使用绝对路径。');
const qrPath = join(stateDir, 'login-qr.png');
const statusPath = join(stateDir, 'login-status.json');
const LOGIN_TIMEOUT_MS = 12 * 60 * 1000;
let writes = Promise.resolve();
let qrCount = 0;

async function report(event, details = {}) {
  const state = { event, updatedAt: new Date().toISOString(), ...details };
  const text = `${JSON.stringify(state)}\n`;
  const pendingPath = `${statusPath}.tmp`;
  await writeFile(pendingPath, text, { mode: 0o600 });
  await rename(pendingPath, statusPath);
  process.stdout.write(text);
}

function enqueue(operation) {
  writes = writes.then(operation);
  void writes.catch(() => process.exit(1));
}

await mkdir(stateDir, { recursive: true, mode: 0o700 });
await chmod(stateDir, 0o700);

const timeout = setTimeout(() => {
  void report('timeout').finally(() => process.exit(1));
}, LOGIN_TIMEOUT_MS);
timeout.unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void report('cancelled').finally(() => process.exit(130));
  });
}

// ============================================================
// SDK 负责官方 iLink 登录；关闭其默认日志，避免输出身份与凭据。
// ============================================================
const bot = new WeChatBot({
  storageDir: stateDir,
  logLevel: 'silent',
  botAgent: 'LifeOS/0.1 (login-only)',
});

try {
  await report('starting');
  const credentials = await bot.login({
    force: process.argv.includes('--force'),
    callbacks: {
      onQrUrl(url) {
        qrCount += 1;
        const revision = qrCount;
        enqueue(async () => {
          const png = await QRCode.toBuffer(url, {
            type: 'png', width: 560, margin: 4, errorCorrectionLevel: 'M',
          });
          await writeFile(qrPath, png, { mode: 0o600 });
          await report('qr_ready', { qrPath, revision });
        });
      },
      onScanned() {
        enqueue(() => report('scanned'));
      },
      onExpired() {
        enqueue(async () => {
          await rm(qrPath, { force: true });
          await report('expired');
        });
      },
      async onVerifyCode(isRetry) {
        await writes;
        await report('verify_code_required', { retry: isRetry });
        const input = createInterface({ input: process.stdin, output: process.stderr });
        try {
          const code = (await input.question('请输入微信手机页面显示的配对码：')).trim();
          if (!/^\d{4,12}$/.test(code)) throw new Error('配对码格式不正确。');
          return code;
        } finally {
          input.close();
        }
      },
    },
  });
  await writes;
  if (!credentials.token || !credentials.accountId || !credentials.userId) {
    throw new Error('登录结果缺少必要凭据。');
  }
  await rm(qrPath, { force: true });
  await report('bound', { credentialsSaved: true, receiverStarted: false });
} catch (error) {
  await writes.catch(() => {});
  await report('failed', {
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorCode: error?.code ?? error?.cause?.code ?? null,
  });
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
