# apps/relay/test/
> L2 | 父级: ../CLAUDE.md

成员清单

channel.test.ts: 协议回归；数据库失败时不推进游标，拒绝非本人消息。
parser.test.ts: 管家计划与回复契约；覆盖灵感两层标签与回执、进程超时、补试总预算、503与额度分类和规则漂移。
processor.test.ts: 业务状态机；覆盖最终失败回执恢复、额度分类、脱敏日志和独立投递。
store.test.ts: 仓储转换边界；验证最近对话的Unicode截断与JS长度兼容。
subscriptions.test.ts: 七天提醒边界；验证上海日期、续费状态、金额、API故障和当前绑定入队。
time-corrections.test.ts: 时间纠错边界；验证字段限制、候选版本提交及数据库前后快照回执。
time-command.test.ts: 区间命令链路；验证北京时间、无模型提交、互斥计划、版本快照和替换回执。
memory.test.ts: 云接口与队列边界；验证身份、配额预算、未知写入保护和task_id恢复。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
