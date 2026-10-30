# apps/relay/src/
> L2 | 父级: ../CLAUDE.md

成员清单

contracts.ts: 领域契约；连接控制指令、时间纠错、受限账目和记忆队列。
config.ts: 启动配置；校验解析和云记忆开关，缺密钥时不启动已启用的记忆配置。
errors.ts: 错误分类；对外只暴露安全错误码。
main.ts: 组合入口；校验连接及 AGENTS.md 一致性后启动串行工作器。
logger.ts: 安全日志工厂；传话筒与日历任务共用脱敏约定。
daily.ts: 日历任务入口；只读预览或小结入队，不启动模型或微信轮询器。
subscriptions.ts: 订阅定时入口；读取当前微信绑定，预览或入队七天扣款提醒。
subscription-reminders.ts: 订阅回环HTTP边界与七天筛选；按上海日期生成金额和扣款日期文案。
processor.ts: 业务状态机；读取有限对话，提交计划后恢复自然回答与账目回执。
reply.ts: 统一回复；呈现已提交账目、纠错前后快照、WHOOP等待状态和控制指令结果。
worker.ts: 常驻工作器；模型、回执和云记忆分别循环，微信接收不等待记忆同步。
memory/: MemOS专用HTTP边界和持久化同步工作器；不向agy暴露密钥。
channel/: 微信协议与游标；不生成账目，不调用模型。
parser/: 模型适配与 schema；不访问数据库或微信凭据。
store/: Supabase 仓储；所有多表变更经事务 RPC 提交。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
