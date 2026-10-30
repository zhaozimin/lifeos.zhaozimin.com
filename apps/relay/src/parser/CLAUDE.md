# apps/relay/src/parser/
> L2 | 父级: ../CLAUDE.md

成员清单

schema.ts: 工具与对话边界；限定时间纠错选择器和字段补丁，追问不得混入写入或回答。
antigravity.ts: 官方agy适配器；将最近对话和云记忆标为数据，账目仍使用冻结时钟与当前事实。
response.ts: CLI 信封解码；区分空响应，仅接受裸 JSON 或完整 JSON 代码块。
runner.ts: CLI 进程边界；schema 放入提示，本地强校验；无 shell 传参、超时取消与密钥隔离。
rules.ts: 常驻规则装载器；读取提示词真源，启动时核对 VPS 的 AGENTS.md 副本。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
