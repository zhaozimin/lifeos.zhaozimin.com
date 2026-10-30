/**
 * [INPUT]: 原版健康资源、云端适配器、共用侧栏与纸墨朱的源码字节。
 * [OUTPUT]: 导出健康资源内容版本，供宿主与构建器共用。
 * [POS]: 健康静态资源缓存边界；更新代码后不继续执行旧模块。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
export function healthRevision(){
  const source=new URL('../whoop/public/',import.meta.url),hash=createHash('sha256');
  for(const name of readdirSync(source).filter(n=>/\.(js|css|html|svg)$/.test(n)).sort())hash.update(readFileSync(new URL(name,source)));
  for(const name of ['health-ui.mjs','health-bridge.js','health-settings.js','src/HealthPage.tsx','src/dashboard/components/shell/sidebar.css','../../design/zzm/zzm.css'])hash.update(readFileSync(new URL(name,import.meta.url)));
  return hash.digest('hex').slice(0,12);
}
