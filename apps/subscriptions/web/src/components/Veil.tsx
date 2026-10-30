/**
 * [INPUT]: 依赖 react 的 context，依赖 icons 的眼睛线标
 * [OUTPUT]: 对外提供 PrivacyProvider、useVeil、Veil、VeilToggle（眼睛 + 脱敏滑块）
 * [POS]: components 的分享遮罩；本人可切换，访客固定符号且禁止解锁
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { IconEye, IconEyeOff } from "./icons";
import {isVisitor} from '../visitor';

const KEY = "subos:veil";

type VeilContext = {
  veiled: boolean;
  toggle: () => void;
};

const Ctx = createContext<VeilContext | null>(null);

function readStored(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("veil") === "1") return true;
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [veiled, setVeiled] = useState(readStored);
  const value = useMemo<VeilContext>(
    () => ({
      veiled,
      toggle: () => {
        setVeiled((prev) => {
          const next = !prev;
          try {
            sessionStorage.setItem(KEY, next ? "1" : "0");
          } catch {
            /* 无存储也不挡切换 */
          }
          return next;
        });
      },
    }),
    [veiled],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVeil(): VeilContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useVeil 必须包在 PrivacyProvider 里");
  return ctx;
}

export function Veil({
  children,
  active = true,
  className = "",
}: {
  children: ReactNode;
  active?: boolean;
  className?: string;
}) {
  const { veiled } = useVeil();
  if(isVisitor()&&active)return <span className={className}>••••</span>;
  const on = veiled && active;
  return (
    <span className={["veil", on ? "is-veiled" : "", className].filter(Boolean).join(" ")}>
      <span className="veil-ink">{children}</span>
    </span>
  );
}

export function VeilToggle({ label = "脱敏" }: { label?: string }) {
  const { veiled, toggle } = useVeil();
  if(isVisitor())return <button type="button" className="veil-switch" disabled aria-label="访客隐私保护已锁定"><IconEyeOff className="sidebar-ico"/><span>隐私已锁定</span></button>;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={veiled}
      aria-label={veiled ? "取消脱敏" : "脱敏邮箱和账号"}
      onClick={toggle}
      className="veil-switch"
    >
      {veiled ? (
        <IconEyeOff className="sidebar-ico" />
      ) : (
        <IconEye className="sidebar-ico" />
      )}
      <span className="veil-switch-label">{label}</span>
      <span className="veil-track" aria-hidden="true">
        <span className="veil-thumb" />
      </span>
    </button>
  );
}
