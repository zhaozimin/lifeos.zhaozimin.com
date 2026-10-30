/**
 * [INPUT]: 依赖 zustand persist 与 theme 的 ThemeMode。
 * [OUTPUT]: 对外提供亮暗偏好、解析后模式及其更新动作。
 * [POS]: 主题状态真源；ThemeProvider 写入根节点，EChart 按 resolved 重建画布。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ThemeMode } from "../theme";

export type ThemePref = ThemeMode | "system";

interface ThemeState {
  preference: ThemePref;
  resolved: ThemeMode;
  setPreference: (pref: ThemePref) => void;
  setResolved: (resolved: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: "system",
      resolved: "light",
      setPreference: (pref) => set({ preference: pref }),
      setResolved: (resolved) => set({ resolved }),
    }),
    {
      name: "lifeos-theme",
      // v1 删除 71 套色板，只保留亮暗偏好
      version: 1,
      migrate: (persisted) => {
        const preference = (persisted as { preference?: unknown } | null)?.preference;
        return { preference: preference === "light" || preference === "dark" ? preference : "system" };
      },
      partialize: (state) => ({ preference: state.preference }),
    },
  ),
);
