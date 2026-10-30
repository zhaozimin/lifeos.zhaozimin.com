/**
 * [INPUT]: 依赖 zustand persist 与历史记录类型契约。
 * [OUTPUT]: 提供默认记录类型及更新动作。
 * [POS]: 记录板块的本机列表偏好；设置页写入，历史页打开时读取。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RecordKind } from "../../record-model";

type RecordsPreferences = {
  defaultKind: RecordKind;
  setDefaultKind: (kind: RecordKind) => void;
};

export const useRecordsPreferences = create<RecordsPreferences>()(
  persist(
    (set) => ({ defaultKind: "time", setDefaultKind: (defaultKind) => set({ defaultKind }) }),
    { name: "lifeos-records", partialize: (state) => ({ defaultKind: state.defaultKind }) },
  ),
);
