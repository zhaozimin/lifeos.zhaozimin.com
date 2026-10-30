/**
 * [INPUT]: 依赖 React button 属性、clsx 与 zzm.css 的 .zzm-btn 家族。
 * [OUTPUT]: 对外提供语义变体、尺寸、图标和 loading 状态统一的 Button。
 * [POS]: components/ui 的动作原语；页面只选语义变体，键的质感、光影与禁用态全部来自设计系统。
 *   主配色是朱砂红：primary 与 destructive 都是朱键（主操作、破坏性确认）；
 *   loading 走 --busy（旋转环 + 反光），不用 opacity 淡化。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

type Variant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive"
  | "icon"
  | "text";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "md" | "sm" | "lg";
  leading?: ReactNode;
  trailing?: ReactNode;
  loading?: boolean;
}

// secondary 与 outline 是迁移前的两个名字，在纸墨朱里都是纸键
const variantClass: Record<Variant, string> = {
  primary: "zzm-btn zzm-btn--accent",
  secondary: "zzm-btn",
  outline: "zzm-btn",
  ghost: "zzm-btn zzm-btn--ghost",
  destructive: "zzm-btn zzm-btn--accent",
  icon: "zzm-btn zzm-btn--icon",
  // 文字按钮不是键：灰字，悬停变墨
  text: "inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:text-zzm-muted",
};

const sizeClass = { sm: "zzm-btn--sm", md: "", lg: "zzm-btn--lg" };

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = "primary",
    size = "md",
    leading,
    trailing,
    loading,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        variantClass[variant],
        variant !== "text" && sizeClass[size],
        loading && "zzm-btn--busy",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {leading}
      {children}
      {trailing}
    </button>
  );
});
