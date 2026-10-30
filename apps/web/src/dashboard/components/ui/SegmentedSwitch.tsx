/**
 * [INPUT]: 依赖 clsx 与 zzm.css 的 .zzm-btn 家族；受控组件，value 由调用方持有。
 * [OUTPUT]: 对外提供 SegmentedSwitch：2~4 档的模式开关。
 * [POS]: components/ui 的少档位模式原语；财务记账模式与统计毛/纯共享，本体不承担业务判断。
 *   设计系统不做胶囊分段控件：分段＝一排 sm 纸键，当前档是朱键（主配色朱砂红标「当前」）。
 *   与 Tabs 的边界：前者切换模式状态，后者切换内容面板。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import clsx from "clsx";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function SegmentedSwitch<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange: (next: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={clsx("inline-flex items-center gap-2", className)}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(option.value)}
            className={clsx("zzm-btn zzm-btn--sm", checked && "zzm-btn--accent")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
