/**
 * [INPUT]: 云端只读契约与共享视觉元素。
 * [OUTPUT]: 不可改写原话的状态与待澄清列表。
 * [POS]: 可视化面板的单一职责视图；不提供账目写入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useState } from "react";
import { MessageSquareText, Clock3, ChevronDown } from "lucide-react";
import { Empty } from "./ui";
import { datetime, type DashboardData } from "./model";
const statuses: Record<string, string> = {
  pending: "等待解析",
  awaiting_clarification: "等待补充",
  parsed: "已记录",
  failed: "解析失败",
  ignored: "已忽略",
};
export function InboxView({ data }: { data: DashboardData }) {
  const [filter, setFilter] = useState("all");
  const rows = data.inbox.filter(
    (r) =>
      filter === "all" ||
      (filter === "attention" &&
        ["failed", "awaiting_clarification"].includes(r.status)) ||
      r.status === filter,
  );
  return (
    <>
      <div className="inbox-intro">
        <MessageSquareText size={16} strokeWidth={1.5} />
        <p>
          原话会一直保留。需要补充信息时，回到微信回复；要撤销上一条记录，发送「撤销」。
        </p>
      </div>
      <div className="inbox-toolbar">
        <div className="inbox-filters" role="group" aria-label="原话筛选">
          <button
            type="button"
            className={`zzm-btn zzm-btn--sm ${filter === "all" ? "zzm-btn--accent" : ""}`}
            onClick={() => setFilter("all")}
          >
            全部原话
          </button>
          <button
            type="button"
            className={`zzm-btn zzm-btn--sm ${filter === "attention" ? "zzm-btn--accent" : ""}`}
            onClick={() => setFilter("attention")}
          >
            待补充 / 失败
          </button>
          <button
            type="button"
            className={`zzm-btn zzm-btn--sm ${filter === "pending" ? "zzm-btn--accent" : ""}`}
            onClick={() => setFilter("pending")}
          >
            待解析
          </button>
        </div>
        <span className="muted">
          {data.inboxMore ? "最近 100 条" : `${data.inbox.length} 条原话`}
        </span>
      </div>
      {!rows.length ? (
        <section className="card">
          <Empty
            title={filter === "all" ? "还没有收到原话" : "这里暂时没有待办"}
          />
        </section>
      ) : (
        <div className="inbox-list">
          {rows.map((r) => (
            <article className="card raw-card" key={r.id}>
              <header>
                <span>
                  <Clock3 size={14} strokeWidth={1.5} />
                  {datetime(r.received_at)}
                </span>
                <div>
                  {r.revoked_at && <span className="tag">已撤销</span>}
                  <span className={`status ${r.status}`}>
                    {r.input_kind === "command" && r.status === "parsed"
                      ? "已执行"
                      : (statuses[r.status] ?? r.status)}
                  </span>
                </div>
              </header>
              <p className="raw-text">{r.text}</p>
              {r.clarification_prompt && (
                <div className="clarify">
                  <MessageSquareText size={14} strokeWidth={1.5} />
                  <span>{r.clarification_prompt}</span>
                </div>
              )}
              <footer>
                <span>
                  {r.input_kind === "command" ? "微信指令" : "微信原话"}
                </span>
                <details>
                  <summary>
                    记录编号
                    <ChevronDown size={12} />
                  </summary>
                  <code>{r.id}</code>
                </details>
              </footer>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
