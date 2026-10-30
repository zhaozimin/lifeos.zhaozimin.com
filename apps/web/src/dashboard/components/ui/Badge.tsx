/**
 * [INPUT]: 依赖 React span 属性、clsx 与 index.css 的 --zzm-* / --data-* 令牌。
 * [OUTPUT]: 对外提供紧凑只读标签 Badge。
 * [POS]: components/ui 的只读标记原语；不编码时间领域判断。
 *   形状即信号：徽章不可点，所以是 999 胶囊；可点的东西一律是圆角矩形键。
 *   朱色只给 primary 一档，表示「需要你处理」；其余语气用中性灰或哑光数据色。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

type Tone =
  | "neutral"
  | "outline"
  | "primary"
  | "success"
  | "warning"
  | "destructive"
  | "brand-orange"
  | "brand-blue"
  | "brand-violet";

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  uppercase?: boolean;
  children: ReactNode;
}

// 哑光数据色底取 14% 浓度，字色取数据色本身，深浅两套由令牌切换
const toneClass: Record<Tone, string> = {
  neutral: "bg-zzm-chip text-zzm-muted",
  outline: "border-border text-muted-foreground",
  primary: "bg-zzm-accent-soft text-zzm-accent-ink",
  success: "bg-[color-mix(in_srgb,var(--zzm-ok-ink)_12%,transparent)] text-zzm-ok",
  warning: "bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] text-warning",
  destructive: "bg-zzm-accent-soft text-zzm-accent-ink",
  "brand-orange": "bg-[color-mix(in_srgb,var(--data-6)_14%,transparent)] text-[var(--data-6)]",
  "brand-blue": "bg-[color-mix(in_srgb,var(--data-1)_14%,transparent)] text-[var(--data-1)]",
  "brand-violet": "bg-[color-mix(in_srgb,var(--data-4)_14%,transparent)] text-[var(--data-4)]",
};

export function Badge({ tone = "neutral", uppercase, className, children, ...rest }: Props) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border border-transparent px-2 font-semibold",
        uppercase ? "font-mono text-[10px] leading-4 tracking-[1px] uppercase" : "text-[11.5px] leading-5",
        toneClass[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
