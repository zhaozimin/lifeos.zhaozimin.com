/**
 * [INPUT]: 镜像 design/zzm/zzm.css v0.7.0 的纸墨朱令牌实色；不依赖其他模块。
 * [OUTPUT]: 导出 ThemeMode、ZZM_TOKENS（画布用实色）、DATA_SERIES（哑光数据色）与 metaThemeColor。
 * [POS]: dashboard 唯一主题真源。CSS 走 index.css 的 var(--zzm-*) 桥接；
 *        只有 ECharts、Canvas 这类读不到 CSS 变量的画布从这里取实色。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export type ThemeMode = "light" | "dark";

// ============================================================
//  界面实色：逐项抄自 zzm.css，升级设计系统时同步此表
// ============================================================
export interface ZzmTokens {
  paper: string;
  surface: string;
  surface2: string;
  ink: string;
  text4: string;
  muted: string;
  hairline: string;
  fill: string;
  accent: string;
  accentInk: string;
  ok: string;
  warning: string;
  font: string;
  mono: string;
}

const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

export const ZZM_TOKENS: Record<ThemeMode, ZzmTokens> = {
  light: {
    paper: "#F6F6F4",
    surface: "#FFFFFF",
    surface2: "#FFFFFF",
    ink: "#161616",
    text4: "#6E6E6A",
    muted: "#8B8B85",
    hairline: "rgba(0, 0, 0, 0.09)",
    fill: "rgba(0, 0, 0, 0.04)",
    accent: "#A6402F",
    accentInk: "#A6402F",
    ok: "#2E7D4F",
    warning: "#96691F",
    font: FONT,
    mono: MONO,
  },
  dark: {
    paper: "#141413",
    surface: "#1C1C1B",
    surface2: "#242423",
    ink: "#E6E5DF",
    text4: "#A3A29C",
    muted: "#8D8C86",
    hairline: "rgba(255, 255, 255, 0.1)",
    fill: "rgba(255, 255, 255, 0.04)",
    accent: "#A6402F",
    accentInk: "#E27D67",
    ok: "#6FCB8E",
    warning: "#D9A94F",
    font: FONT,
    mono: MONO,
  },
};

// ============================================================
//  哑光数据色：数据属于内容，不属于界面（同设计系统的笔记标注块边界）
//  前四位依次是 nature 的核心、支撑、恢复、消遣，index.css 与之同值
//  刻意避开朱色色相：朱色一屏只标一次「你在这里」
// ============================================================
export const DATA_SERIES: Record<ThemeMode, string[]> = {
  light: ["#5F7391", "#A68A5B", "#6E8C74", "#8B7393", "#4F8682", "#A07163", "#7E8A55", "#6C76A3", "#9A8F84", "#556066"],
  dark: ["#8FA2C0", "#C8AD7F", "#94B39A", "#B39BBA", "#7DB1AC", "#C49A8B", "#A8B47D", "#98A1CB", "#BDB3A8", "#8E9AA1"],
};

export const META_THEME_COLOR: Record<ThemeMode, string> = {
  light: ZZM_TOKENS.light.paper,
  dark: ZZM_TOKENS.dark.paper,
};
