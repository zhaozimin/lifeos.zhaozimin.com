/**
 * [INPUT]: 依赖主题 store、lucide 图标与 zzm.css 的 .zzm-btn 家族。
 * [OUTPUT]: 对外提供 ThemeSwitcher：compact 为一级栏单键轮换，完整版为设置页三档按钮组。
 * [POS]: components 的亮暗模式入口；纸墨朱是唯一主题，这里只切模式不切色板。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Monitor, Moon, Sun } from "lucide-react";
import clsx from "clsx";
import { useThemeStore, type ThemePref } from "../store/theme";

const MODES: Array<{ value: ThemePref; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "浅色", Icon: Sun },
  { value: "dark", label: "深色", Icon: Moon },
  { value: "system", label: "跟随系统", Icon: Monitor },
];

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const index = Math.max(0, MODES.findIndex((mode) => mode.value === preference));

  if (compact) {
    const current = MODES[index];
    const next = MODES[(index + 1) % MODES.length];
    return (
      <button
        type="button"
        className="rail-item"
        data-tip={`外观：${current.label}`}
        aria-label={`外观：${current.label}，点按切换为${next.label}`}
        onClick={() => setPreference(next.value)}
      >
        <current.Icon size={18} strokeWidth={1.5} />
      </button>
    );
  }

  return (
    <div role="radiogroup" aria-label="外观" className="inline-flex flex-wrap gap-2">
      {MODES.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          onClick={() => setPreference(value)}
          className={clsx("zzm-btn zzm-btn--sm", preference === value && "zzm-btn--accent")}
        >
          <Icon size={14} strokeWidth={1.5} />
          {label}
        </button>
      ))}
    </div>
  );
}
