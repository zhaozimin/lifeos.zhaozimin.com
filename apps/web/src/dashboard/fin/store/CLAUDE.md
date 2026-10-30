# store/

> L2 | 父级: ../CLAUDE.md

成员清单

timeRange.ts: 财务三页共享区间真源；persist 使用 finance-time-range/version 3。setRange 原子写入维度与桶；日期面板点日期即写入它所在的桶，任意一天都可选，空区间显示空。
dashboardLayout.ts: 看板 widget 的显隐与顺序（persist）；DEFAULT_ORDER 是 widget 清单真源，读取时与默认表求并集——旧存档里没有的新 widget 自动补到末尾并可见，已下线的 id 被丢弃，因此加 widget 不需要写迁移。
theme.ts: 向根 store/theme 的兼容再导出，不持有任何状态；存在的唯一理由是挡住迁入页面另起一个 finance-theme 主题源。

法则: 只放跨页面且需要跨会话记忆的状态；单页视图态留在页面里。持久化状态可能与当前账本脱节，读取方必须能把失效值归一，而不是照单全收。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
