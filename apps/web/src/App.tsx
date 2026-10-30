/**
 * [INPUT]: 本人密码与 TOTP 会话、原版仪表盘路由和云端附加页面。
 * [OUTPUT]: 默认访客面板及密码、TOTP解锁的本人完整页面。
 * [POS]: 云端组合根；认证使用 HttpOnly Cookie，业务页面复用本机源码。
 * 访客默认挂载；本人通过双重验证后重建完整路由树。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import {AccessContext,configureAccess} from './access';
import {VisitorRestricted} from './VisitorPages';
import Auth, { type Api } from "./Auth";
import { SHANGHAI, type SessionState } from "./model";
import { ThemeProvider } from "./dashboard/components/ThemeProvider";
import { ErrorBoundary } from "./dashboard/components/ErrorBoundary";
import { Layout } from "./dashboard/components/Layout";
import { RecordTimeZoneProvider } from "./dashboard/components/RecordTimeZoneProvider";
import { DayPage } from "./dashboard/pages/DayPage";
import { StatsPage } from "./dashboard/pages/StatsPage";
import { FinPageFrame } from "./dashboard/fin/FinPageFrame";
import { OverviewPage } from "./dashboard/fin/pages/OverviewPage";
import { LedgerPage } from "./dashboard/fin/pages/LedgerPage";
import { FlowPage } from "./dashboard/fin/pages/FlowPage";
import { SettingsHub } from "./dashboard/settings/SettingsHub";
import { CloudRecords, CloudInbox, CloudSecurity } from "./CloudPages";
import { HealthPage } from './HealthPage';
import {SubscriptionsPage} from './SubscriptionsPage';
export default function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [error, setError] = useState("");
  const api: Api = useCallback(
    async <T,>(
      path: string,
      body?: unknown,
      signal?: AbortSignal,
    ): Promise<T> => {
      const response = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        headers:
          body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) setSession({ stage: "anonymous" });
        throw new Error(result.error || "请求失败，请稍后重试。");
      }
      return result as T;
    },
    [],
  );
  const load = useCallback(() => {
    setError("");
    void api<SessionState>("/api/session")
      .then(setSession)
      .catch((e) => setError(e.message));
  }, [api]);
  useEffect(() => {
    load();
    window.addEventListener("lifeos-session-expired", load);
    return () => window.removeEventListener("lifeos-session-expired", load);
  }, [load]);
  const owner=session?.stage==='ready';
  configureAccess(owner);
  const privatePage=(page:React.ReactNode)=>owner?page:<VisitorRestricted/>;
  return (
    <ThemeProvider>
      <ErrorBoundary label="LifeOS">
        {!session ? (
          <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
            <section className="text-center">
              <h1 className="text-display-md">LifeOS</h1>
              <p className="my-4 text-sm text-muted-foreground">
                {error || "正在连接你的 LifeOS…"}
              </p>
              {error && (
                <button
                  onClick={load}
                  className="zzm-btn"
                >
                  重新连接
                </button>
              )}
            </section>
          </main>
        ) : (
          <AccessContext.Provider value={{owner}}>
          <RecordTimeZoneProvider onChange={() => undefined}>
            <Routes key={owner?'owner':'visitor'}>
              <Route path="login" element={owner?<Navigate to="/time/day" replace/>:<div className="cloud-legacy"><Auth session={session} api={api} onSession={setSession}/></div>}/>
              <Route element={<Layout />}>
                <Route index element={<Navigate to="/time/day" replace />} />
                <Route
                  path="time/day"
                  element={<DayPage recordTimeZone={SHANGHAI} />}
                />
                <Route
                  path="time/stats"
                  element={<StatsPage recordTimeZone={SHANGHAI} />}
                />
                <Route path="time/settings" element={<Navigate to="/time/settings/catalog" replace />} />
                <Route path="time/settings/:panelId" element={privatePage(<SettingsHub />)} />
                <Route path="fin" element={<FinPageFrame />}>
                  <Route index element={<Navigate to="status" replace />} />
                  <Route path="status" element={<OverviewPage />} />
                  <Route path="ledger" element={<LedgerPage />} />
                  <Route path="flow" element={<FlowPage />} />
                  <Route path="settings" element={<Navigate to="/fin/settings/accounts" replace />} />
                  <Route path="settings/:panelId" element={privatePage(<SettingsHub />)} />
                </Route>
                <Route
                  path="settings"
                  element={<Navigate to="/settings/appearance" replace />}
                />
                <Route path="settings/:panelId" element={privatePage(<SettingsHub />)} />
                {/* 旧设计系统活文档已由 ui.zhaozimin.com 取代 */}
                <Route path="settings/design/*" element={<Navigate to="/settings/developer" replace />} />
                <Route path="records" element={privatePage(<CloudRecords api={api} />)} />
                <Route path="records/settings" element={<Navigate to="/records/settings/list" replace />} />
                <Route path="records/settings/:panelId" element={privatePage(<SettingsHub />)} />
                <Route path="inbox" element={privatePage(<CloudInbox api={api} />)} />
                <Route path="security" element={privatePage(<CloudSecurity />)} />
                <Route path="health" element={<Navigate to="/health/overview" replace />} />
                <Route path="health/:view" element={<HealthPage />} />
                <Route path="subscriptions" element={<SubscriptionsPage />} />
                <Route path="*" element={<Navigate to="/time/day" replace />} />
              </Route>
            </Routes>
          </RecordTimeZoneProvider>
          </AccessContext.Provider>
        )}
      </ErrorBoundary>
    </ThemeProvider>
  );
}
