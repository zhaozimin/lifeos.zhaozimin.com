/**
 * [INPUT]: 无外部图标库。笔形对齐 Nucleo Sharp：24 格、2px 描边、方角
 * [OUTPUT]: 对外提供边栏线标（含银行卡）、FilterIcon 取标、iconTone 选中色
 * [POS]: components 的象形字。只给可点项，分类标题和月费卡不加
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { CSSProperties, ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconHome(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 11 L12 3 L21 11 V21 H15 V14 H9 V21 H3 Z" />
    </Svg>
  );
}

export function IconChart(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 19 H20" />
      <path d="M7 19 V12" />
      <path d="M12 19 V7" />
      <path d="M17 19 V10" />
    </Svg>
  );
}

export function IconCard(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="M3 10 H21" />
      <path d="M7 15 H11" />
    </Svg>
  );
}

export function IconSliders(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7 H20" />
      <path d="M4 12 H20" />
      <path d="M4 17 H20" />
      <rect x="8" y="5" width="4" height="4" fill="currentColor" stroke="none" />
      <rect x="14" y="10" width="4" height="4" fill="currentColor" stroke="none" />
      <rect x="6" y="15" width="4" height="4" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconGrid(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="6" height="6" />
      <rect x="14" y="4" width="6" height="6" />
      <rect x="4" y="14" width="6" height="6" />
      <rect x="14" y="14" width="6" height="6" />
    </Svg>
  );
}

export function IconSpark(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3 L13.6 10.4 L21 12 L13.6 13.6 L12 21 L10.4 13.6 L3 12 L10.4 10.4 Z" />
    </Svg>
  );
}

export function IconPhone(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3 H11 V8 L8.5 11 C8.8 15 12.2 17.2 16 15.5 L19 13 H21 V18 C20.8 20.4 18.2 21.5 14.5 21 C7.8 20.2 3 15.4 3 9 C3 5.8 4.6 3 8 3 Z" />
    </Svg>
  );
}

export function IconGlobe(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <ellipse cx="12" cy="12" rx="3.4" ry="8" />
      <path d="M4 12 H20" />
    </Svg>
  );
}

export function IconCloud(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 18 H18 C20.2 18 22 16.2 22 14 C22 11.9 20.4 10.2 18.4 10 C17.8 7.6 15.6 6 13 6 C10.2 6 8 7.9 7.6 10.6 C5.4 10.9 4 12.8 4 15 C4 16.7 5.3 18 7 18 Z" />
    </Svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="5" width="16" height="14" />
      <path d="M10 9 L16 12 L10 15 Z" />
    </Svg>
  );
}

export function IconBolt(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13 3 L6 13 H12 L11 21 L18 11 H12 Z" />
    </Svg>
  );
}

export function IconTag(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4 H13 L20 12 L12 20 L4 12 Z" />
      <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8 V12.2 L15.5 14.4" />
    </Svg>
  );
}

export function IconCalendarX(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="6" width="16" height="15" />
      <path d="M4 10.5 H20" />
      <path d="M8 3.5 V8" />
      <path d="M16 3.5 V8" />
      <path d="M9.5 14 L14.5 18 M14.5 14 L9.5 18" />
    </Svg>
  );
}

export function IconEye(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12 C6 7.2 8.8 5 12 5 C15.2 5 18 7.2 21 12 C18 16.8 15.2 19 12 19 C8.8 19 6 16.8 3 12 Z" />
      <circle cx="12" cy="12" r="2.4" />
    </Svg>
  );
}

export function IconEyeOff(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12 C6 7.2 8.8 5 12 5 C15.2 5 18 7.2 21 12 C18 16.8 15.2 19 12 19 C8.8 19 6 16.8 3 12 Z" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="M5 19 L19 5" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5 V19 M5 12 H19" />
    </Svg>
  );
}

const BY_ID: Record<string, typeof IconGrid> = {
  all: IconGrid,
  soon: IconClock,
  overdue: IconCalendarX,
  cat_ai: IconSpark,
  cat_phone: IconPhone,
  cat_network: IconGlobe,
  cat_cloud: IconCloud,
  cat_media: IconPlay,
  cat_tools: IconBolt,
  cat_other: IconTag,
};

function byName(name: string): (typeof IconGrid) | null {
  const n = name.trim().toLowerCase();
  if (/ai|智能|模型/.test(n)) return IconSpark;
  if (/话费|手机|通信|电话/.test(n)) return IconPhone;
  if (/网络|宽带|网/.test(n)) return IconGlobe;
  if (/云|存储/.test(n)) return IconCloud;
  if (/娱乐|媒体|视频|音乐/.test(n)) return IconPlay;
  if (/效率|工具|办公/.test(n)) return IconBolt;
  if (/其他/.test(n)) return IconTag;
  return null;
}

export function FilterIcon({
  id,
  name = "",
  ...props
}: IconProps & { id: string; name?: string }) {
  const Cmp = BY_ID[id] || byName(name) || IconTag;
  return <Cmp {...props} />;
}

const TONES: Record<string, string> = {
  home: "var(--ink)",
  stats: "var(--zzm-text-4)",
  cards: "var(--ico-teal)",
  settings: "var(--ico-steel)",
  all: "var(--ink)",
  cat_ai: "var(--ico-plum)",
  cat_phone: "var(--ico-steel)",
  cat_network: "var(--ico-teal)",
  cat_cloud: "var(--ico-steel)",
  cat_tools: "var(--due-mid)",
  cat_media: "var(--ico-slate)",
  cat_other: "var(--ico-slate)",
  soon: "var(--due-mid)",
  overdue: "var(--zhu)",
};

export function iconTone(id: string, name = ""): string {
  if (TONES[id]) return TONES[id];
  const n = name.trim().toLowerCase();
  if (/ai|智能|模型/.test(n)) return "var(--ico-plum)";
  if (/话费|手机|通信|电话/.test(n)) return "var(--ico-steel)";
  if (/网络|宽带|网/.test(n)) return "var(--ico-teal)";
  if (/云|存储/.test(n)) return "var(--ico-steel)";
  if (/娱乐|媒体|视频|音乐/.test(n)) return "var(--ico-slate)";
  if (/效率|工具|办公/.test(n)) return "var(--due-mid)";
  if (/即将|到期/.test(n)) return "var(--due-mid)";
  if (/过期/.test(n)) return "var(--zhu)";
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 33 + id.charCodeAt(i)) >>> 0;
  const fallback = ["var(--ico-plum)", "var(--ico-steel)", "var(--ico-teal)", "var(--due-mid)"];
  return fallback[hash % fallback.length];
}

export function iconToneStyle(id: string, name = ""): CSSProperties {
  return { ["--ico-tone"]: iconTone(id, name) } as CSSProperties;
}
