/**
 * [INPUT]: 服务端认证阶段及同源 API。
 * [OUTPUT]: 密码、本人首次设置和验证器绑定界面。
 * [POS]: 只展示服务端允许的阶段；不保存密码、动态码或密钥。
 * 本人验证入口同时提供返回访客面板的链接。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useState, type FormEvent } from "react";
import {Link} from 'react-router';
import {
  ArrowRight,
  ShieldCheck,
  Smartphone,
  LockKeyhole,
  LogOut,
} from "lucide-react";
import type { SessionState } from "./model";
import { ProductLogo } from "./dashboard/components/ProductLogo";
export type Api = <T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
) => Promise<T>;
export default function Auth({
  session,
  api,
  onSession,
}: {
  session: SessionState;
  api: Api;
  onSession: (s: SessionState) => void;
}) {
  const [password, setPasswordValue] = useState(""),
    [confirm, setConfirm] = useState(""),
    [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<{
    factorId: string;
    qr: string;
    secret: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const stage = session.stage,
    bind = stage === "enroll",
    verify = stage === "verify" || !!enrollment;
  const titles = {
    anonymous: "欢迎回来",
    password: "设置你的登录密码",
    enroll: "绑定手机验证器",
    verify: "输入动态验证码",
    ready: "验证完成",
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (stage === "anonymous")
        onSession(await api<SessionState>("/api/auth/login", { password }));
      else if (stage === "password") {
        if (password !== confirm) throw new Error("两次密码不一致");
        onSession(await api<SessionState>("/api/auth/password", { password }));
      } else if (verify)
        onSession(
          await api<SessionState>("/api/auth/verify", {
            factorId: enrollment?.factorId ?? session.factorId,
            code,
          }),
        );
      else setEnrollment(await api("/api/auth/enroll", {}));
      setPasswordValue("");
      setConfirm("");
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "请稍后重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <header className="auth-header">
        <ProductLogo />
        <span className="eyebrow">时间 · 金钱 · 生活</span>
      </header>
      <main className="auth-main">
        <div className="auth-intro">
          <span className="eyebrow">YOUR PERSONAL SPACE</span>
          <h1>
            让日子
            <br />
            留下清晰的<span>轨迹。</span>
          </h1>
          <p>
            微信随手记，回到这里看见生活。
            <br />
            每一段时间，每一笔收支，都有迹可循。
          </p>
          <div className="auth-line" />
          <small>沿用你的 LifeOS，与生活保持同步。</small>
        </div>
        <section className="auth-card" aria-labelledby="auth-title">
          <span className="auth-symbol">
            {verify || bind ? (
              <Smartphone size={23} />
            ) : (
              <LockKeyhole size={23} />
            )}
          </span>
          <div className="auth-step">
            {stage === "anonymous"
              ? "01 / 密码登录"
              : stage === "password"
                ? "首次设置 · 1 / 2"
                : "02 / 验证器"}
          </div>
          <h2 id="auth-title">{titles[stage]}</h2>
          <p className="muted">
            {stage === "anonymous"
              ? "输入你的密码，下一步验证手机动态码。"
              : stage === "password"
                ? "使用至少 20 位的新密码，建议由密码管理器生成并保存。"
                : verify
                  ? "打开手机验证器，输入当前显示的 6 位数字。"
                  : "使用 1Password、Google Authenticator 等验证器扫码。"}
          </p>
          <form onSubmit={submit}>
            {(stage === "anonymous" || stage === "password") && (
              <>
                <label htmlFor="password">
                  {stage === "password" ? "新密码" : "密码"}
                </label>
                <input
                  className="field"
                  id="password"
                  name="password"
                  type="password"
                  autoFocus
                  required
                  minLength={stage === "password" ? 20 : 1}
                  maxLength={256}
                  autoComplete={
                    stage === "password" ? "new-password" : "current-password"
                  }
                  value={password}
                  onChange={(e) => setPasswordValue(e.target.value)}
                />
                {stage === "password" && (
                  <>
                    <label htmlFor="confirm">确认新密码</label>
                    <input
                      className="field"
                      id="confirm"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={20}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </>
                )}
              </>
            )}
            {enrollment && (
              <div className="qr-section">
                <img
                  alt="LifeOS 验证器绑定二维码"
                  width="200"
                  height="200"
                  src={
                    enrollment.qr.startsWith("data:image/svg+xml")
                      ? enrollment.qr
                      : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(enrollment.qr)}`
                  }
                />
                <details>
                  <summary>无法扫码？手动输入密钥</summary>
                  <code>{enrollment.secret}</code>
                  <p>请将密钥保存在密码管理器中，以便更换手机。</p>
                </details>
              </div>
            )}
            {verify && (
              <>
                <label htmlFor="otp">6 位动态码</label>
                <input
                  className="field otp"
                  id="otp"
                  name="otp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </>
            )}
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            <button className={`zzm-btn zzm-btn--accent zzm-btn--lg zzm-btn--block ${busy ? "zzm-btn--busy" : ""}`} disabled={busy}>
              {busy
                ? "正在验证…"
                : bind && !enrollment
                  ? "生成绑定二维码"
                  : stage === "password"
                    ? "保存密码，继续"
                    : verify
                      ? "验证并进入"
                      : "继续"}
              {!busy && <ArrowRight size={16} />}
            </button>
          </form>
          <div className="auth-foot">
            <ShieldCheck size={15} />
            <span>密码 + 6 位动态码 · 仅本人可见</span>
          </div>
          {stage !== "anonymous" && (
            <button
              type="button"
              className="zzm-btn zzm-btn--ghost zzm-btn--sm auth-back"
              onClick={async () => {
                try {
                  onSession(await api("/api/auth/logout", {}));
                  setEnrollment(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <LogOut size={14} />
              退出登录
            </button>
          )}
          <Link className="zzm-btn zzm-btn--ghost mt-4" to="/time/day">以访客身份浏览</Link>
        </section>
      </main>
      <footer className="auth-footer">
        LifeOS · 在时间与金钱里，看见生活的形状。
      </footer>
    </div>
  );
}
