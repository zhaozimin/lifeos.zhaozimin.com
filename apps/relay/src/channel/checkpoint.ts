/**
 * [INPUT]: 已确认入库批次的微信游标与机器人账号标识。
 * [OUTPUT]: 私有、原子落盘的传输检查点。
 * [POS]: channel 的恢复边界；不保存原话或账目，换绑账号时重置游标。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { open, readFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface Checkpoint { load(): Promise<string>; commit(cursor: string): Promise<void> }
export class FileCheckpoint implements Checkpoint {
  constructor(private readonly path: string, private readonly accountId: string) {}
  async load(): Promise<string> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as { account_id?: string; cursor?: string };
      return value.account_id === this.accountId && typeof value.cursor === 'string' ? value.cursor : '';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    }
  }
  async commit(cursor: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.tmp`;
    const file = await open(temporary, 'w', 0o600);
    try {
      await file.writeFile(JSON.stringify({ account_id: this.accountId, cursor }));
      await file.sync();
    } finally { await file.close(); }
    await rename(temporary, this.path);
    const directory = await open(dirname(this.path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
}
