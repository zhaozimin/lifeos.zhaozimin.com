/**
 * [INPUT]: 依赖主题 store 与 theme 的 META_THEME_COLOR。
 * [OUTPUT]: 对外提供 ThemeProvider，把亮暗偏好写成根节点的 data-theme 与 .dark。
 * [POS]: components 的主题运行时。zzm.css 读 data-theme，Tailwind dark: 变体读 .dark；
 *        颜色值全部来自 CSS，本组件不写任何令牌。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect } from "react";
import { useThemeStore } from "../store/theme";
import { META_THEME_COLOR, type ThemeMode } from "../theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = useThemeStore((s) => s.preference);
  const setResolved = useThemeStore((s) => s.setResolved);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved: ThemeMode = preference === "system" ? (mql.matches ? "dark" : "light") : preference;
      const root = document.documentElement;
      root.dataset.theme = resolved;
      root.classList.toggle("dark", resolved === "dark");
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META_THEME_COLOR[resolved]);
      setResolved(resolved);
    };
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, [preference, setResolved]);

  return <>{children}</>;
}
