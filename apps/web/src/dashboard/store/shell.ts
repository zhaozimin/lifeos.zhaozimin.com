/**
 * [INPUT]: 依赖 zustand persist。
 * [OUTPUT]: 对外提供 useShellStore：二级栏收起状态与切换动作。
 * [POS]: 工作台外壳的浏览器偏好；一级栏的收起键读写它，Layout 据此决定是否渲染二级栏。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ShellState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }),
    { name: "lifeos-shell", partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }) },
  ),
);
