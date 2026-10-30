# supabase/
> L2 | 父级: ../CLAUDE.md

成员清单

migrations/: 数据库真源；账本、历史来源、修改版本、RLS 与事务 RPC。
test/: PostgreSQL 集成测试；验证权限、原话不可变与重试幂等。
package.json: SQL 测试入口；PGlite 只用于本地临时数据库。
package-lock.json: 测试依赖完整性清单。
config.toml: CLI 项目标识与本地认证约定，生产关闭公开注册。

边界：生产账本只存 Supabase。测试数据库不保存用户数据。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
