/**
 * [INPUT]: 依赖受控 tab 值、标签列表、clsx 与 zzm.css 的 .zzm-btn 家族。
 * [OUTPUT]: 对外提供 CategoryTabs：下划线标签页（segmented）或 sm 按钮组（pills）。
 * [POS]: components/ui 的多面板导航原语；财务账本与设置分组导航的唯一实现，保持无业务状态。
 *   segmented 是设计系统的下划线标签：当前项墨色 600 + 2px 朱线，那条朱线就是这一屏的「你在这里」。
 *   pills：分段用 sm 按钮组，当前项朱键。不做胶囊分段控件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import clsx from "clsx";

interface Props<T extends string> {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel?: string;
  size?: "md" | "sm";
  variant?: "segmented" | "pills";
}

export function CategoryTabs<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  size = "md",
  variant = "segmented",
}: Props<T>) {
  if (variant === "pills") {
    return (
      <div role="tablist" aria-label={ariaLabel} className="inline-flex flex-wrap items-center gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            role="tab"
            aria-selected={opt.value === value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={clsx("zzm-btn zzm-btn--sm", opt.value === value && "zzm-btn--accent")}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={clsx("flex max-w-full items-end overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:none]", size === "sm" ? "gap-4" : "gap-6")}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(opt.value)}
            className={clsx(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-0.5 pt-2 pb-2.5 transition-colors duration-150",
              size === "sm" ? "text-[12.5px] leading-5" : "text-[13px] leading-5",
              active
                ? "border-zzm-accent font-semibold text-foreground"
                : "border-transparent font-[450] text-zzm-muted hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
