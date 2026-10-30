# supabase/migrations/
> L2 | 父级: ../CLAUDE.md

成员清单

0001_init.sql: 四张业务表；原话与分类归属本人，账目使用稳定序号去重。
0002_security.sql: 权限与不可变约束；本人 AAL2 只读，原话禁止删除或改写。
0003_workflow.sql: 事务状态机；领取租约、提交解析、指令幂等与撤销。
0004_views.sql: 只读汇总与账目快照；时间跨午夜按实际日期拆分。
0005_category_metadata.sql: 分类语义；保留关键词、时间性质与收支方向，拒绝方向错配。
0006_backup_role.sql: 备份只读角色；绕过 RLS 完整导出，不持有 postgres 写入权限。
0007_daily_summary.sql: 小结快照；合并重叠、分币种汇总，夜间每天幂等入队并复用微信上下文。
0008_local_history.sql: 历史保真；进行中、扣减、带符号金额、转账及私有附件，来源档案不可变。
0009_record_editing.sql: 本人 AAL2 限定字段编辑；版本冲突、账户改名传播与不可变修改记录。
0010_history_summary.sql: 小结兼容历史账本；扣减用净时长，进行中按快照裁剪，转账排除收支。
0011_records_view.sql: 历史检索视图；分页查时间、流水、任务和账户，继承本人 AAL2。

0012_dashboard_records.sql: 原版补录、软删除、财务扩展字段和私有附件。
0013_dashboard_configuration.sql: 账户、分类、项目和周起点的原子配置。
0014_dashboard_import.sql: 可重投导入和带版本检查的原子报销核销。

0015_dashboard_invariants.sql: 时间调节约束、账户余额差额和回款删除级联。
0016_steward.sql: 微信管家受限执行器；真实账户、活动原子切换、原话标签和因果撤销。
0017_steward_duplicate_window.sql: 收窄重复判断；不同日期的补录不因接收时间相近而互相阻塞。
0018_whoop.sql: 身体副本、报告修订、AAL2白名单任务和晨间微信幂等入队。
0019_dialogue.sql: 持久化自然回答，复用账目执行器；最近八轮严格按归属、来源和时序读取。
0020_memory_cloud.sql: 微信双向消息档案、回复版本确认与MemOS持久化队列；结果不明写入不重投。
0021_timing_flow.sql: 新时段先闭旧计时；追问按题型收补充，停止和取消独立执行。
0022_time_groups.sql: 安装本人返还的大类规则；新事件精确匹配，手报睡眠等待WHOOP校准。
0023_whoop_time_alignment.sql: WHOOP实睡校准与首尾手机推定；保留原段、来源和并发修改检查点。
0024_visitor.sql: 默认关闭的公开投影；匿名不获私有底表权限，睡眠计算共用内核。
0025_visitor_finance.sql: 公开财务日期、方向和通用分类；不选择金额、账户或原始标题。
0026_subscription_reminders.sql: 订阅七天提醒；按续费日期去重、隔离当前微信绑定，并设置当日回执期限。
0027_wechat_time_corrections.sql: 微信时间纠错；唯一候选、版本检查、混合事务、短答续接和冲突保护撤销。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
