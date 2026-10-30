# memory/
> L2 | 父级: ../CLAUDE.md

成员清单

cloud.ts: MemOS专用HTTP边界；固定官方地址，限制召回预算，区分可重试与结果不明写入。
worker.ts: 持久化任务执行器；先保存task_id再轮询，失败不阻塞微信收发。

记忆只作为模型上下文，不作为账目执行依据。
凭据仅在HTTP边界使用，不传给agy子进程。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
