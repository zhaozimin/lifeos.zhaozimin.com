/**
 * [INPUT]: 依赖 React select 属性、clsx 与 fields.css 的 .field 输入槽。
 * [OUTPUT]: 对外提供原生 Select，支持 label、hint 与 sm/md 两档高度。
 * [POS]: components/ui 的简单选择原语；Autocomplete 在触屏设备降级到它，二者共用同一输入槽几何。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";

interface Props extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label?: string;
  hint?: string;
  size?: "sm" | "md";
  options: Array<{ value: string; label: string; disabled?: boolean }>;
}

export const Select = forwardRef<HTMLSelectElement, Props>(function Select(
  { label, hint, options, size = "md", className, ...rest },
  ref,
) {
  return (
    <label className="block">
      {label && <span className="field-label">{label}</span>}
      <span className={clsx("field relative pr-8", size === "sm" && "field--sm")}>
        <select ref={ref} className={clsx("appearance-none cursor-pointer", className)} {...rest}>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          size={14}
          strokeWidth={1.5}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zzm-muted"
        />
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
});
