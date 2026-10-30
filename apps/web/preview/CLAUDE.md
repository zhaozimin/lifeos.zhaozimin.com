# preview/
> L2 | 父级: ../CLAUDE.md

Vite的ui模式独占此模块。生产构建不载入它。
演示账本不连接Supabase、VPS或MemOS。

成员清单
plugin.ts: 本机演示 API 与子页静态资源；健康源码和共用侧栏变更后重建健康页；定时比对订阅外壳修改时间，重建后自动重载配置（外接磁盘文件事件不可靠）。
database.ts: 合成时间及财务样本；复用正式投影接口。
health.mjs: WHOOP合成数据；复用正式分析与计划引擎。
subscriptions.py: 临时SQLite演示服务；复用SubOS领域接口。存在 .private/subos-preview.sqlite3 时用它的副本，否则用合成样本；修改不回写。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
