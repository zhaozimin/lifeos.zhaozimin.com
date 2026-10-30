# api/

> L2 | 父级: ../CLAUDE.md

成员清单

client.ts: 原版财务兼容层；映射到 `../../api/fin`，复用本人Cookie及原版领域前缀。

法则: 页面不得直接拼接 HTTP 请求；端点与认证真源只在 `src/api/fin.ts`、`src/api/core.ts`，删除状态必须通过统一契约读取。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
