# api/
> L2 | 父级: ../CLAUDE.md

成员清单
client.ts: 时间域迁移兼容层；把历史 `api` 名称映射到 time.ts，不持有端点或认证状态。
core.ts: 本人Cookie或访客公开投影传输；不保存令牌。
time.ts: `/v1/time/*` 时间 API 门面；覆盖配置、时段、统计、主数据与不可覆盖修改版本查询。
fin.ts: 访客将null金额转为示意单位；`/v1/fin/*` 财务 API 门面；覆盖账目、配置、报销、附件、导入导出与不可覆盖修改版本查询。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
