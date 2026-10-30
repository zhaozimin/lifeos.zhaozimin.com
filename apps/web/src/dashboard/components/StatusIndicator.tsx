/**
 * [INPUT]: 依赖 TimeOS health API 与浏览器定时器。
 * [OUTPUT]: 对外提供云端连接状态（compact 为一级栏图标），30 秒低频复核且不读取任何用户活动。
 * [POS]: components 的运行状态指示器；只检测服务可达性，不参与记录与统计。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useEffect, useState } from "react";
import { Loader2, Wifi, WifiOff } from "lucide-react";
import { api } from "../api/client";

export function StatusIndicator({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const probe = async () => {
      try {
        await api.health();
        if (active) setStatus("online");
      } catch {
        if (active) setStatus("offline");
      }
      if (active) timer = setTimeout(probe, 30_000);
    };
    void probe();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  const Icon = status === "checking" ? Loader2 : status === "online" ? Wifi : WifiOff;
  const label = status === "checking" ? "检查中" : status === "online" ? "云端已连接" : "云端未连接";
  const tone = status === "checking" ? "animate-spin" : status === "online" ? "text-zzm-ok" : "text-zzm-accent-ink";
  // 状态不可点，所以不长成键：一级栏里只是一枚带名称签的图标，连通时不抢眼
  if (compact) {
    return (
      <span role="status" tabIndex={0} className="rail-item" data-tip={label} aria-label={label}>
        <Icon size={16} strokeWidth={1.5} className={tone} />
      </span>
    );
  }
  return (
    <span className="inline-flex h-9 items-center gap-2 px-2 text-[12px] leading-4 text-zzm-muted">
      <Icon size={14} strokeWidth={1.5} className={tone} />
      {label}
    </span>
  );
}
