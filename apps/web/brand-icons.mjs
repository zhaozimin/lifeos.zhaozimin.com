/**
 * [INPUT]: 依赖 src/dashboard/components/brand/lifeos-mark.svg 母版与 sharp 的 SVG 栅格化。
 * [OUTPUT]: 生成 public/ 下的 lifeos-icon.svg、lifeos-icon-maskable.svg、apple-touch-icon.png、icon-192/512(-maskable).png，
 *   以及 apps/whoop/public/favicon.svg。
 * [POS]: 品牌图标的唯一生成器；改标识后运行 npm run icons，不手工编辑 public/ 里的图标。
 *   母版里的 currentColor 与令牌变量在这里落成纸墨朱浅色实值：静态图标没有亮暗环境。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const INK = '#161616';
const PAPER = '#F6F6F4';
const ACCENT = '#A6402F';

const master = await readFile(new URL('./src/dashboard/components/brand/lifeos-mark.svg', import.meta.url), 'utf8');
// 取出母版图形（去掉外层 svg 与注释），换成实色
const glyph = master
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replaceAll('currentColor', INK)
  .replaceAll('var(--zzm-paper, #F6F6F4)', PAPER)
  .replaceAll('var(--zzm-accent, #A6402F)', ACCENT)
  .trim();

// 图形占画布的比例：普通图标 72%；安全区图标留足 80% 圆内的余量，取 56%
function icon({ rounded, scale }) {
  const n = (value) => Number(value.toFixed(2));
  const box = n(24 / scale);
  const offset = n((box - 24) / 2);
  const radius = rounded ? n(box * 0.22) : 0;
  return `<!-- [INPUT]: 由 apps/web/brand-icons.mjs 从 lifeos-mark.svg 母版生成。[OUTPUT]: LifeOS 朱砂根图标。
[POS]: 静态品牌资源，勿手改；改标识请改母版后运行 npm run icons。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-offset} ${-offset} ${box} ${box}" role="img" aria-label="LifeOS">
  <rect x="${-offset}" y="${-offset}" width="${box}" height="${box}" rx="${radius}" fill="${PAPER}"/>
  ${glyph}
</svg>
`;
}

const out = (name) => new URL(`./public/${name}`, import.meta.url);
const standard = icon({ rounded: true, scale: 0.72 });
const maskable = icon({ rounded: false, scale: 0.56 });
// 苹果桌面图标由系统裁圆角，画布铺满纸色
const touch = icon({ rounded: false, scale: 0.7 });

await writeFile(out('lifeos-icon.svg'), standard);
await writeFile(out('lifeos-icon-maskable.svg'), maskable);
// WHOOP 独立控制台与健康页 iframe 共用同一枚收藏夹图标
await writeFile(new URL('../whoop/public/favicon.svg', import.meta.url), standard);
const png = (svg, size, name) => sharp(Buffer.from(svg), { density: 1200 }).resize(size, size).png().toFile(fileURLToPath(out(name)));
await Promise.all([
  png(touch, 180, 'apple-touch-icon.png'),
  png(standard, 192, 'icon-192.png'),
  png(standard, 512, 'icon-512.png'),
  png(maskable, 192, 'icon-192-maskable.png'),
  png(maskable, 512, 'icon-512-maskable.png'),
]);
console.log('品牌图标已生成');
