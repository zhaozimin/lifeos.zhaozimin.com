# components/

> L2 | 父级: ../CLAUDE.md

成员清单

TransactionEditSheet.tsx: 交易新增/编辑弹层，MVP 只保存当前一笔明确交易且不提供「另存为周期规则」；同时是报销流程第一、二步（记垫付、收回款）的入口。
TransactionDrawer.tsx: 访客编辑按钮禁用；交易列表抽屉，饼图/看板钻取的通用容器。
FinTimeRangeBar.tsx: 财务三页共用日期面板（周 月 季 年 全 区 + 月历）；经 SidebarSlot 固定在二级栏底部。点日期选中它所在的桶，「区」两次点击选起止；不再有下拉，任意一天都可选。
FinSearchPalette.tsx: 仅在用户主动打开时加载整本账的财务检索命令面板；不参与应用壳的首屏请求。
ReimbursementPieCard.tsx: 报销进度扇形图，消费 lib/reimbursement 的状态语义。
ReimbursementPill.tsx: 报销状态行内原语（是否报销双按钮 ReimbursementActions/展示 Tag/核销入口），状态→图标/文案的唯一事实源；rejected 统一叫「已驳回」（非终态，可二次报销仍计入待回款）；遵守 StatusPill 对比度铁律。
ReimbursementSettleSheet.tsx: 回款核销对账抽屉，报销流程第三步——勾选一笔回款覆盖的垫付并批量核销/撤销。
AdjustmentHistoryDrawer.tsx: 余额调整全历史抽屉；不传 limit，确保早期对账证据可追溯。
AttachmentLightbox.tsx: 附件预览与删除灯箱。
AuthedImage.tsx: 本人会话下载附件；图片卸载时释放私有对象URL。
GlobalSearchPalette.tsx: 迁入财务域的通用搜索命令面板原型；新统一入口由 FinSearchPalette 承担。
DashboardCustomizer.tsx: 看板 widget 显隐与排序定制。
BudgetProgressCard.tsx / SavingsGoalCard.tsx / CashflowForecastCard.tsx / SubscriptionsCard.tsx: 看板业务卡片（预算/储蓄目标/现金流预测/订阅）。
InvoiceWorkbench.tsx: 发票工作台，dual 模式的开票追踪。
ProjectPLDrawer.tsx: 项目损益抽屉；不传 limit 读取项目全历史，避免早期成本/收入从图表消失。
charts/: EChart 命令式适配器、主题语义桥与桑基/旭日/柱/线/环形阈值等视图；局部地图见 `charts/CLAUDE.md`。
ui/: 财务域仅存的分叉原语 AlertDialog；其余原语已并入共享 `src/components/ui/`，本目录不再是 UI 基础层的入口。

法则: 业务组件消费 lib 的领域判定，不得私造状态语义；UI 原语默认从共享 `src/components/ui/` 导入，只有 ui/ 列出的分叉件例外；弹层统一走 Modal（z-80），确认/通知一律用 ui/AlertDialog（z-95），全站禁用原生 confirm/alert；滚动锁只走 useBodyScrollLock，禁止裸操 body.style。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
