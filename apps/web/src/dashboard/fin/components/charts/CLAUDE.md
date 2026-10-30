# charts/

> L2 | 父级: ../CLAUDE.md

成员清单

AccountBarChart.tsx: 账户金额横向柱图，只展示排序后前十个；tooltip 中的自由文本必经 HTML 转义。
RoiChart.tsx: 项目成本/收入并列柱图；只消费上游对齐序列。
SankeyChart.tsx: 资金流向桑基图；直接使用结构化 source/target 回传节点/边，禁止将自由名称编码成字符串再分割回解。
SunburstChart.tsx: 支出分类旭日图；消费聚合层构造的 SunburstNode 树并转义 tooltip 路径。
ThresholdRingChart.tsx: 账户阈值同心环；按 low/mid/threshold 派生分区颜色并回传点击账户。
TrendLineChart.tsx: 收入/支出跨月趋势折线图；日期补桶与序列对齐交上游完成。

访客图表统一调用lib/presentation，遮罩轴、数值标签及提示框。

法则: EChart 壳与图表主题统一在 `components/charts/`，本目录只放财务业务图；业务图只产出 option 与语义回调，不各自管 ECharts 实例；用户文本进入 HTML tooltip 前统一走 `fin/lib/format.escapeHtml`。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
