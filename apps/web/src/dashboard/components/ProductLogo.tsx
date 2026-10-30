/**
 * [INPUT]: 依赖 brand/lifeos-mark.svg 母版（Vite ?raw 内联）与纸墨朱令牌；不依赖任何图标库。
 * [OUTPUT]: 对外提供 ProductLogo：朱砂根标识，compact 只显示图形，完整版附「LifeOS」字标。
 * [POS]: shell 的品牌原语；一级栏与登录页共享。图形与 public/ 下的收藏夹、桌面图标同出一份母版。
 *   内联而不用 <img>：枝叶用 currentColor，随亮暗模式变色；果实固定朱砂红。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import mark from "./brand/lifeos-mark.svg?raw";

export function ProductLogo({ compact = false, size = 28 }: { compact?: boolean; size?: number }) {
  return (
    <div className="flex items-center gap-2 text-foreground">
      <span
        aria-hidden={!compact}
        className="inline-flex shrink-0 [&>svg]:h-full [&>svg]:w-full"
        style={{ width: size, height: size }}
        dangerouslySetInnerHTML={{ __html: mark }}
      />
      {!compact && <span className="text-[15px] font-bold leading-6">LifeOS</span>}
    </div>
  );
}
