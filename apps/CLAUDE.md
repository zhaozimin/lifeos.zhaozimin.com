# apps/
> L2 | 父级: ../CLAUDE.md

成员清单

web/: Cloudflare 私密面板；本人会话查询历史，通过版本 RPC 人工编辑。
relay/: 常驻微信传话筒；原话入库、模型解析与回执分开执行。
subscriptions/: VPS订阅账本、原版界面和私有网络适配。
whoop/: 原版WHOOP工作库与恢复规则；VPS同步后向Supabase发布健康副本。
orca-sync/: 零外部依赖 Mac Orca 遥测采集与双通道推送器（VPS SSH 零密钥管道 / Supabase 直推），脱敏上报并触发均衡模式自动校对。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
