# apps/orca-sync/
> L2 | 父级: ../CLAUDE.md

Node.js 22 内置 `node:sqlite` + 零外部依赖 ESM。
以只读方式采集本机 Orca 四引擎（Claude / Codex / Antigravity / Grok）轮次与人类触点，本地完成脱敏与审批死时间剔除，经 VPS SSH 无密钥通道或直连 Supabase 幂等写入独立 AI 遥测表（默认不改写人类时间账本）。

成员清单

package.json: 运行与测试入口；要求 Node.js >= 22.13，不引入第三方包。
.env.example: 配置契约；真实值仅存本机 `.private/orca-sync.env` 或 VPS `/etc/lifeos/orca.env`。
src/extractor.mjs: 只读 SQLite 采集与脱敏引擎；剔除审批等待死时间、区分本机/手机触点、汇总每日并发与杠杆。
src/transport.mjs: 双通道传输层；支持 `vps-ssh`（Mac 零管理员密钥经 SSH 标准输入推送）与 `supabase` 直连，默认仅调用 `publish_orca_ai`。
src/vps-ingest.mjs: VPS 无端口接收入口；部署于 `/opt/lifeos-orca/ingest.mjs`，复用 `/etc/lifeos/{orca,whoop,relay}.env` 的 Supabase 凭据（兼容 `OWNER_AUTH_ID` 与 `LIFEOS_OWNER_ID`）。
src/cli.mjs: Mac 本机 CLI 与定时任务入口；提供 `--dry-run` 与 `--push`。
tests/orca-sync.test.mjs: 合成 SQLite 夹具与桩传输测试；验证脱敏边界、死时间剔除与幂等发布。

边界：
- 仅只读打开 Orca 数据库，绝不写入或锁定 Orca 主库。
- 所有 Prompt 正文、代码内容与完整本地路径在 Mac 本机彻底剥离。
- 生产凭据与真实主机名不得进入 Git。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
