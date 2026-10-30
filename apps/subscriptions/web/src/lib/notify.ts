/**
 * [INPUT]: 依赖浏览器Notification、上海日期和既有提醒接口
 * [OUTPUT]: 对外提供权限申请、7/3/1 领取、逐条投递、成功回执与失败释放、页签角标
 * [POS]: web/lib 的浏览器提醒通道；VPS微信七天提醒使用独立投递队列。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { api } from "../api";
import type { ReminderPack } from "../types";

const KEY = "subos:notified";

function todayKey(): string {
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}

function loadNotified(): Set<string> {
  try {
    const raw = localStorage.getItem(`${KEY}:${todayKey()}`);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveNotified(ids: Set<string>): void {
  localStorage.setItem(`${KEY}:${todayKey()}`, JSON.stringify([...ids]));
}

export function notificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!notificationSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestNotifyPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationSupported()) return "unsupported";
  return Notification.requestPermission();
}

export function waveLabel(wave: 7 | 3 | 1): string {
  if (wave === 7) return "还有 7 天";
  if (wave === 3) return "还有 3 天";
  return "还有 1 天";
}

export function pushReminders(pack: ReminderPack): ReminderPack["due"] {
  if (!notificationSupported() || Notification.permission !== "granted") {
    return [];
  }
  const seen = loadNotified();
  const delivered: ReminderPack["due"] = [];
  for (const item of pack.due) {
    const key = `${item.id}:${item.wave}:${item.next_renewal_on}`;
    if (seen.has(key)) { delivered.push(item); continue; }
    try {
    const note = new Notification(`${item.name} · ${waveLabel(item.wave)}`, {
      body: `¥${item.amount_yuan} · ${item.next_renewal_on}`,
      tag: `subos-${key}`,
    });
    note.onclick = () => {
      window.focus();
      if(window.parent!==window)window.dispatchEvent(new CustomEvent("subos:navigate",{detail:{path:`/s/${item.id}`}}));
      else window.location.href = `${window.location.pathname.startsWith("/subscriptions-console")?"/subscriptions-console":""}/s/${item.id}`;
    };
    seen.add(key);
    delivered.push(item);
    } catch { /* 此条失败，保留待投递状态，继续其他条目 */ }
  }
  try { saveNotified(seen); } catch { /* 存储受限不影响已送达回执 */ }
  return delivered;
}

export function applyTitleBadge(count: number): void {
  const base = "SubOS";
  document.title = count > 0 ? `(${count}) ${base}` : base;
}

export async function deliverDueReminders(): Promise<void> {
  const watch = await api.reminders();
  applyTitleBadge(watch.items.length);
  if (notificationPermission() !== "granted") return;
  const pack = await api.claimReminders();
  const delivered = pushReminders(pack);
  const failed = pack.due.filter((item) => !delivered.includes(item));
  try {
    if (delivered.length) await api.ackReminders(delivered);
  } finally {
    if (failed.length) await api.releaseReminders(failed);
  }
}
