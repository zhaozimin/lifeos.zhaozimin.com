/**
 * [INPUT]: 本机已登录的 Supabase CLI、libpq 工具与指定项目。
 * [OUTPUT]: 本机私有 AES-GCM 加密备份、独立密钥与完整性摘要。
 * [POS]: 回收前保护入口；导出 public/auth/storage，并保存 Storage 实体。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

process.umask(0o077);
const project = process.argv[2];
if (!project || !/^[a-z]{20}$/.test(project)) throw new Error('需要明确的 Supabase 项目 ID');
const pgBin = process.env.LIFEOS_PG_BIN ?? '/opt/homebrew/opt/libpq/bin';
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { env, maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`备份命令失败：${command}；退出码 ${result.status}`);
  return result.stdout;
}
function query(sql) {
  return JSON.parse(run('supabase', ['db', 'query', '--linked', '--output', 'json', sql]).toString()).rows;
}
const linked = (await readFile(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8')).trim();
if (linked !== project) throw new Error('目标项目与 CLI 链接不符');
const plan = run('supabase', ['db', 'dump', '--linked', '--dry-run']).toString();
const pgEnv = { ...process.env, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15' };
for (const line of plan.split('\n')) {
  const match = line.match(/^export (PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)=(.*)$/);
  if (!match) continue;
  const value = match[2];
  // 只解析 CLI 的简单导出，不执行脚本或命令替换。
  if (!value || /[`$\n\r]/.test(value)) throw new Error('CLI 连接格式变化');
  pgEnv[match[1]] = value.startsWith('"') || value.startsWith("'") ? value.slice(1, -1) : value;
}
for (const name of ['PGHOST', 'PGUSER', 'PGPASSWORD']) if (!pgEnv[name]) throw new Error('CLI 未提供连接参数');
const dump = run(join(pgBin, 'pg_dump'), ['--role=postgres', '--format=custom', '--no-owner', '--no-privileges',
  '--schema=public', '--schema=auth', '--schema=storage'], pgEnv);
// pg_restore 在不连接数据库时验证归档可读，并列出目录。
const tableOfContents = spawnSync(join(pgBin, 'pg_restore'), ['--list'], { input: dump, maxBuffer: 8 * 1024 * 1024 });
if (tableOfContents.status !== 0) throw new Error('备份归档校验失败');
const keys = JSON.parse(run('supabase', ['projects', 'api-keys', '--project-ref', project, '--output', 'json']).toString());
const serviceKey = (keys.find((key) => key.name === 'lifeos_relay' && key.type === 'secret')
  ?? keys.find((key) => key.type === 'secret')
  ?? keys.find((key) => key.name === 'service_role'))?.api_key;
if (!serviceKey) throw new Error('服务端备份权限不可用');
const objects = query('select bucket_id,name from storage.objects order by bucket_id,name');
const files = [];
for (const object of objects) {
  const path = [object.bucket_id, ...object.name.split('/')].map(encodeURIComponent).join('/');
  const response = await fetch(`https://${project}.supabase.co/storage/v1/object/authenticated/${path}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Storage 备份失败：HTTP ${response.status}`);
  files.push({ ...object, content_base64: Buffer.from(await response.arrayBuffer()).toString('base64') });
}
const plaintext = Buffer.from(JSON.stringify({ format: 'lifeos-pre-recycle-v1', project,
  created_at: new Date().toISOString(), dump_base64: dump.toString('base64'), storage_files: files }));
const key = randomBytes(32), iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();
const envelope = Buffer.from(JSON.stringify({ algorithm: 'aes-256-gcm', iv: iv.toString('base64'),
  tag: tag.toString('base64'), ciphertext: encrypted.toString('base64') }));
const folder = join(homedir(), 'Library/Application Support/LifeOS/backups', `${project}-${Date.now()}`);
await mkdir(folder, { recursive: true, mode: 0o700 });
await writeFile(join(folder, 'recycle-backup.enc'), envelope, { mode: 0o600 });
await writeFile(join(folder, 'recycle-backup.key'), key, { mode: 0o600 });
// 从落盘文件反解并比较 SHA256，避免只验证内存中的副本。
const saved = JSON.parse(await readFile(join(folder, 'recycle-backup.enc'), 'utf8'));
const decipher = createDecipheriv('aes-256-gcm', await readFile(join(folder, 'recycle-backup.key')), Buffer.from(saved.iv, 'base64'));
decipher.setAuthTag(Buffer.from(saved.tag, 'base64'));
const restored = Buffer.concat([decipher.update(Buffer.from(saved.ciphertext, 'base64')), decipher.final()]);
if (!restored.equals(plaintext)) throw new Error('落盘备份校验失败');
const sha256 = createHash('sha256').update(envelope).digest('hex');
await writeFile(join(folder, 'manifest.json'), JSON.stringify({ project, dump_bytes: dump.length,
  storage_files: files.length, encrypted_sha256: sha256, verified: true }, null, 2), { mode: 0o600 });
process.stdout.write(JSON.stringify({ backup_directory: folder, dump_bytes: dump.length, storage_files: files.length, verified: true }) + '\n');
