/**
 * [INPUT]: 依赖 theme 的 ThemeMode；大类名称由本人确定。
 * [OUTPUT]: 对外提供 timeGroupColor(name, mode)：大类在统计图与日周分布中的稳定哑光色。
 * [POS]: 大类视觉映射；旧 nature 保留兼容，不充当新的分类口径。
 *   数据属于内容：色相区分大类，饱和度压低与纸面同温；避开朱色色相，朱色只标「你在这里」。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ThemeMode } from "../theme";

// 浅色值与 theme/index.ts 的 DATA_SERIES 同族；深色值整体提亮一档，保证暗纸上可读
const COLORS: Record<string, Record<ThemeMode, string>> = {
  工作: { light: "#5F7391", dark: "#8FA2C0" },
  学习成长: { light: "#7A6E9C", dark: "#A99DC8" },
  生活自理: { light: "#4F8682", dark: "#7DB1AC" },
  饮食: { light: "#A68A5B", dark: "#C8AD7F" },
  清醒休息: { light: "#8FA584", dark: "#B5C6AA" },
  睡眠: { light: "#6E8C74", dark: "#94B39A" },
  运动: { light: "#A07163", dark: "#C49A8B" },
  娱乐: { light: "#8B7393", dark: "#B39BBA" },
  私人社交: { light: "#A3809A", dark: "#C9A6BF" },
  出行: { light: "#7E8A55", dark: "#A8B47D" },
  待确认: { light: "#9A8F84", dark: "#BDB3A8" },
};

export function timeGroupColor(name: string, mode: ThemeMode): string {
  return (COLORS[name] ?? COLORS.待确认)[mode];
}
