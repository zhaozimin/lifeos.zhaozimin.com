/**
 * [INPUT]: prompts/parse.md 真源与 VPS 工作区 AGENTS.md。
 * [OUTPUT]: 常驻管家规则读取与部署一致性检查。
 * [POS]: 提示词唯一装载器；拒绝线上规则副本与源码漂移。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RelayError } from '../errors.js';

export async function readStewardRules(): Promise<string> {
  return readFile(new URL('../../../prompts/parse.md', import.meta.url), 'utf8');
}
export async function verifyWorkspaceRules(workspace: string): Promise<void> {
  const expected = await readStewardRules();
  let actual: string;
  try { actual = await readFile(join(workspace, 'AGENTS.md'), 'utf8'); }
  catch { throw new RelayError('STEWARD_RULES_MISSING'); }
  if (actual !== expected) throw new RelayError('STEWARD_RULES_MISMATCH');
}
