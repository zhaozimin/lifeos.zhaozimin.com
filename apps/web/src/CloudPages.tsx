/**
 * [INPUT]: 工作台、云端历史与原话接口、会话退出能力。
 * [OUTPUT]: 历史记录、原话收件箱及 LifeOS 安全与退出入口。
 * [POS]: 云端附加页；保持本机原版页面独立，复用已验证的版本编辑。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { PageHeader } from "./dashboard/components/ui/PageHeader";
import { Button } from "./dashboard/components/ui/Button";
import { logout } from "./dashboard/api/core";
import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import type { Api } from "./Auth";
import { RecordsView } from "./RecordsView";
import { RecordEditor } from "./RecordEditor";
import { InboxView } from "./InboxView";
import type { EditTarget } from "./record-model";
import { today, type DashboardData } from "./model";
import { useRefreshSignal } from "./dashboard/components/Layout";
export function CloudRecords({ api }: { api: Api }) {
  const [editing, setEditing] = useState<EditTarget | null>(null),
    [revision, setRevision] = useState(0),
    [saved, setSaved] = useState("");
  const refresh = useRefreshSignal();
  return (
    <div className="cloud-legacy pb-6">
      <div inert={!!editing}>
        <PageHeader className="mb-6" label="Records · History" title="历史记录" note="微信和本机历史 · 本人可编辑" />
        {saved && (
          <p role="status" className="mb-4 text-[13px] leading-5 text-zzm-ok">
            {saved}
          </p>
        )}
        <RecordsView
          api={api}
          revision={revision + refresh}
          onEdit={(kind, id) => setEditing({ kind, id })}
        />
      </div>
      {editing && (
        <RecordEditor
          target={editing}
          api={api}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setRevision((v) => v + 1);
            setSaved("修改已保存");
          }}
        />
      )}
    </div>
  );
}
export function CloudInbox({ api }: { api: Api }) {
  const [data, setData] = useState<DashboardData | null>(null),
    [error, setError] = useState("");
  const refresh = useRefreshSignal();
  useEffect(() => {
    const c = new AbortController();
    const day = today();
    void api<DashboardData>(
      `/api/dashboard?${new URLSearchParams({ start: day, end: day, day })}`,
      undefined,
      c.signal,
    )
      .then(setData)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [api, refresh]);
  return (
    <div className="cloud-legacy pb-6">
      <PageHeader className="mb-6" label="Records · Inbox" title="原话收件箱" />
      {error ? (
        <p role="alert" className="text-[13px] leading-5 text-zzm-accent-ink">{error}</p>
      ) : data ? (
        <InboxView data={data} />
      ) : (
        <div aria-label="正在读取原话" className="zzm-skel h-64 rounded-xl" />
      )}
    </div>
  );
}
export function CloudSecurity() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signOut = async () => {
    setBusy(true);
    setError("");
    try { await logout(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "退出失败，请重试。"); }
    finally { setBusy(false); }
  };
  return (
    <section className="pb-6">
      <PageHeader className="mb-6" label="System · Security" title="安全设置" />
      <div className="zzm-card max-w-[640px] p-6">
        <p className="text-[13px] leading-6 text-muted-foreground">
          已通过本人密码与6位动态码验证。会话保存在 HttpOnly Cookie
          中，只有本人可以查看和修改账本。
        </p>
        <Button className="mt-6" variant="outline" leading={<LogOut size={15} strokeWidth={1.5} />} loading={busy} onClick={() => void signOut()}>退出登录</Button>
        {error && <p role="alert" className="mt-3 text-sm text-zzm-accent-ink">{error}</p>}
      </div>
    </section>
  );
}
