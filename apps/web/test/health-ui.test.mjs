/**
 * [INPUT]: 原版健康资源与正式构建适配器。
 * [OUTPUT]: CSS和模块依赖完整性、版本一致性及安全宿主证据。
 * [POS]: 健康部署资源回归；避免子目录下静态依赖指向错误根路径。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildHealthUi} from '../health-ui.mjs';
import {healthRevision} from '../health-version.mjs';
test('健康构建资源在子目录内闭合，依赖携带同一内容版本',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'health-assets-')),target=pathToFileURL(folder+'/');
 try{
  await buildHealthUi(target);
  const html=await readFile(new URL('index.html',target),'utf8');
  for(const match of html.matchAll(/href="(\/health-console\/[^\"]+\.css\?v=[^\"]+)"/g)){
   assert.ok(match[1].endsWith('?v='+healthRevision()));
   await access(new URL(match[1].split('/health-console/')[1].split('?')[0],target));
  }
  const css=await readFile(new URL('styles.css',target),'utf8');
  for(const match of css.matchAll(/url\("([^"]+)"\)/g)){
   assert.ok(match[1].startsWith('/health-console/'));
   assert.ok(match[1].endsWith('?v='+healthRevision()));
   await access(new URL(match[1].split('/health-console/')[1].split('?')[0],target));
  }
  const app=await readFile(new URL('app.js',target),'utf8');
  for(const match of app.matchAll(/from\s*"(\.\/[^\"]+)"/g)){
   assert.ok(match[1].endsWith('?v='+healthRevision()));
   await access(new URL(match[1].split('?')[0],target));
  }
 }finally{await rm(folder,{recursive:true,force:true});}
});
