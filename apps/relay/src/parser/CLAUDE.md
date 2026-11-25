# apps/relay/src/parser/
> L2 | 父级: ../CLAUDE.md

成员清单

schema.ts: 工具与对话边界；整段纠错与区间替换互斥，校验灵感原话与两层标签，追问不得混入写入或回答。
antigravity.ts: 官方agy适配器；格式补试共用四分钟预算，最近对话与记忆只作数据。
response.ts: CLI完成状态与信封解码；超时、503和个人额度单独分类，中断结果不得入账。
runner.ts: CLI进程边界；默认等待三分钟，另留十五秒回收，隔离密钥并保留失败信封。
rules.ts: 常驻规则装载器；读取提示词真源，启动时核对 VPS 的 AGENTS.md 副本。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
