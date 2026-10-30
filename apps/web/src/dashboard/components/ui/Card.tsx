/**
 * [INPUT]: 依赖 React div 属性、clsx 与 zzm.css 的 .zzm-card。
 * [OUTPUT]: 对外提供统一表面、细线、圆角和可选标题区的 Card、CardHeader、CardTitle。
 * [POS]: components/ui 的页面容器原语；时间与财务全部页面共享同一卡片语法。
 *   default＝浮在纸上的白卡（16 圆角 + 浮起光影）；muted＝卡内嵌套的浅灰面（12 圆角，无光影）；
 *   filled＝墨面，只给全屏最重的一块；ghost＝无面。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

type Variant = "default" | "muted" | "filled" | "ghost";

interface Props extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  padding?: "lg" | "md" | "sm" | "none";
  children: ReactNode;
}

const variantClass: Record<Variant, string> = {
  default: "zzm-card text-card-foreground",
  muted: "rounded-lg border border-border bg-zzm-fill text-foreground",
  filled: "rounded-xl bg-primary text-primary-foreground",
  ghost: "rounded-xl bg-transparent text-foreground",
};

const paddingClass = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

export function Card({ variant = "default", padding = "lg", className, children, ...rest }: Props) {
  return (
    <div className={clsx(variantClass[variant], paddingClass[padding], className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("mb-4 flex items-start justify-between gap-3", className)}>
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  description,
}: {
  children: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div>
      <h3 className="text-title-lg text-foreground">{children}</h3>
      {description && <p className="text-caption mt-1">{description}</p>}
    </div>
  );
}
