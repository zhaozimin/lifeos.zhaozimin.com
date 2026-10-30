/**
 * [INPUT]: 依赖 React Router 的 Outlet 与 useLocation、ui/PageHeader。
 * [OUTPUT]: 为财务三页提供页头（节标签 + 标题）和滚动出口。
 * [POS]: fin 域路由边界；业务页持有范围与数据，范围控件投放到侧栏。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { Outlet, useLocation } from "react-router";
import { PageHeader } from "../components/ui/PageHeader";
import {useAccess} from '../../access';

const HEADINGS: Record<string, { label: string; title: string }> = {
  "/fin/status": { label: "Finance · Status", title: "财务状况" },
  "/fin/ledger": { label: "Finance · Ledger", title: "资金流水" },
  "/fin/flow": { label: "Finance · Flow", title: "资金流量" },
};

export function FinPageFrame() {
  const {owner}=useAccess();
  const heading = HEADINGS[useLocation().pathname];
  return (
    <div className="pb-6">
      {heading && (
        <PageHeader className="mb-4" label={heading.label} title={heading.title} />
      )}
      {!owner&&<p className="mb-4 rounded-lg border border-border bg-zzm-fill px-4 py-3 text-sm text-muted-foreground">访客只读展示 · 金额、账户和交易说明均已打码。图表仅作结构示意，不代表真实金额、比例或走势。</p>}
      <Outlet />
    </div>
  );
}
