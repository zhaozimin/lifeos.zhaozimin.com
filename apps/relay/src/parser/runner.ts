/**
 * [INPUT]: 官方 agy 可执行文件、可信提示、JSON Schema 与私有工作区。
 * [OUTPUT]: 有界的 CLI JSON 信封；schema 放入提示，超时终止进程组。
 * [POS]: CLI 进程边界；使用参数数组，不经过 shell，不传递数据库密钥。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { spawn } from 'node:child_process';
import { RelayError } from '../errors.js';

export interface RunnerOptions { binary: string; model: string; workspace: string; timeoutMs?: number }
export function cliEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = new Set(['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL',
    'TZ', 'TMPDIR', 'TERM', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']);
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key)));
}

export async function runAgy(options: RunnerOptions, prompt: string, schema: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // CLI 1.4.7 的复杂 --json-schema 实测返回空结果，使用提示约束与本地强校验。
    const constrainedPrompt = `${prompt}\n\n输出必须符合此 JSON Schema，只输出一个 JSON 对象：\n${JSON.stringify(schema)}`;
    const child = spawn(options.binary, ['-p', constrainedPrompt, '--model', options.model,
      '--output-format', 'json',
      '--disable-slash-commands', '--print-timeout', '60s'], {
      cwd: options.workspace, env: cliEnvironment(process.env), shell: false,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let size = 0;
    let failure: RelayError | undefined;
    let forcedKill: NodeJS.Timeout | undefined;
    const terminate = (code: string) => {
      if (failure) return;
      failure = new RelayError(code);
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch { /* 子进程已退出。 */ }
      };
      kill('SIGTERM');
      forcedKill = setTimeout(() => kill('SIGKILL'), 5_000);
      forcedKill.unref();
    };
    const timeout = setTimeout(() => terminate('PARSER_TIMEOUT'), options.timeoutMs ?? 75_000);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) terminate('PARSER_OUTPUT_TOO_LARGE');
      else stdout += chunk.toString('utf8');
    });
    // 诊断输出可能含用户内容，仅计入上限，不写日志。
    child.stderr.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) terminate('PARSER_OUTPUT_TOO_LARGE');
    });
    child.once('error', () => { failure = new RelayError('PARSER_PROCESS_FAILED'); });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (forcedKill) clearTimeout(forcedKill);
      if (failure) return reject(failure);
      if (code !== 0) return reject(new RelayError('PARSER_REQUEST_FAILED'));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new RelayError('PARSER_JSON_INVALID')); }
    });
  });
}
