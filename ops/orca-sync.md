<!--
[INPUT]: Mac 本机 Orca 数据库、VPS SSH 通道与 Supabase 0035 迁移。
[OUTPUT]: Mac→VPS→Supabase 零暴露端口推送、launchd 定时与回滚核验说明。
[POS]: ops 的 Orca AI 同步运维入口；真实主机名与凭据仅存本机 .private/。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
-->
# Orca AI 工作时长同步运维

## 架构与凭据边界

推荐采用 **VPS SSH 通道（`vps-ssh`）**：
1. Mac 本机每 5 分钟只读提取 Orca `agent-session-domain.db`，本地剥离全部 Prompt、代码与绝对路径。
2. Mac 通过既有 SSH 密钥把脱敏 JSON 经标准输入管道送至 VPS `/opt/lifeos-orca/ingest.mjs`。
3. VPS 复用已有 `/etc/lifeos/` 中的 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`LIFEOS_OWNER_ID`，幂等调用 `publish_orca_ai` 写入独立 AI 遥测表（不改写人类时间账本）。
4. **安全优势**：Mac 不持有 Supabase 管理员密钥；VPS 不新增任何公网监听端口。

## 上线步骤（正式发布时执行）

1. 先对 Supabase 应用迁移 `supabase/migrations/0035_orca_ai_alignment.sql` 与 `0036_visitor_orca_ai.sql`。
2. 在 VPS 上执行 `bash ops/deploy-orca-ingest.sh` 安装 `/opt/lifeos-orca/ingest.mjs`。
3. 在 Mac 本机复制 `apps/orca-sync/.env.example` 为 `.private/orca-sync.env`，填写 `ORCA_VPS_SSH_TARGET` 与本地随机 `ORCA_HASH_SALT`。
4. 先执行只读演练验证数据：
   ```bash
   node apps/orca-sync/src/cli.mjs --dry-run --days 14
   ```
5. 演练确认后执行首次推送：
   ```bash
   node apps/orca-sync/src/cli.mjs --push --days 14
   ```
6. 复制 `ops/com.lifeos.orca-sync.plist.example` 到 `~/Library/LaunchAgents/com.lifeos.orca-sync.plist`，修正 Node 与仓库路径后启用：
   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.lifeos.orca-sync.plist
   ```

## 故障与冲突处理

- 离线或 Mac 休眠错过周期无须补救：每次默认回看 14 天并幂等去重，联网后自动追平。
- 人类时间账与 AI 遥测轨道完全独立：本机采集与 VPS 同步默认仅写入 `ai_work_turns` / `ai_touchpoints`，绝不自动拆分或修改休息与消遣时段。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
