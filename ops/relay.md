<!--
[INPUT]: relay 工程、数据库迁移与 VPS 已有授权。
[OUTPUT]: 配置、部署、只读检查与故障恢复步骤。
[POS]: 生产传话筒运维入口；扫码见 wechat.md。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
-->
# 微信传话筒

运行账号为 `lifeos`。systemd 只建立出站连接。
`x-ui`、SSH 和防火墙保持现有设置。

1. 按顺序执行 `supabase/migrations` 的 SQL。
2. 创建本人 Auth 用户。初始化两种未分类。
3. 在 VPS 创建 `/etc/lifeos/relay.env`，root 持有，权限 0600。
4. 按 `apps/relay/.env.example` 配置，不填 Google API Key。
5. 将源码同步到 `/opt/lifeos`，排除凭据、缓存和 node_modules。
6. 执行 `bash /opt/lifeos/ops/deploy-relay.sh`。

`systemctl status lifeos-relay --no-pager` 查看服务。
`journalctl -u lifeos-relay -n 30 --no-pager` 查看安全事件。
日志只记录输入 UUID 与错误码，不打印原话或密钥。

`ExecStartPre` 检查数据库、本人用户、未分类、CLI 及规则一致性。
检查本身不接收消息，也不发送消息。
服务只接受扫码凭据中的本人标识。

原话先入库，再保存微信游标。解析任务串行执行。
普通输入先回复“收到，正在处理”。
回执任务独立运行，不等待模型调用完成。
AGY_MODEL指定已验收模型，启动日志记录实际型号。
切换前先用候选模型运行问答、记录、计时和纠错探针。
CLI 不继承微信和数据库密钥。
七条真实样例耗时约 6–12 秒；这不是生产延迟承诺。
CLI 1.4.7 的复杂 `--json-schema` 实测返回空结果。
当前把 schema 写入提示，并以本地 zod 强制校验。
仅接受裸 JSON 或完整 JSON 代码块；不从解释中截取对象。
空响应使用独立错误码；格式纠正仅补试一次，接收时间保持不变。
先检查CLI的finished_reason，再读取响应正文。
print_timeout归为PARSER_TIMEOUT，不立即补试格式。
上游503归为PARSER_UPSTREAM_UNAVAILABLE。
个人额度耗尽归为PARSER_QUOTA_EXHAUSTED。
CLI非零退出仍保留JSON错误信封，禁止接受其中账目。
超时或中断的局部JSON禁止入账。
故障回执区分响应超时与上游不可用。
input_processing_failed只记录输入UUID和错误码。
模型单次默认等待180秒，外层195秒终止进程组。
格式补试共用240秒总预算，不重新获得完整等待时间。
模型记录领取六分钟租约，部署须先应用0028迁移。
服务停止宽限270秒，覆盖模型总预算及进程回收。
解析失败保留原话，十分钟后重试，累计五次停止。
第五次失败刷新回执修订，明确已达到重试上限。
进程重启后恢复最终失败回执，不重新调用模型。
中间失败沿用首次故障回执，避免每次重试重复通知。
额度耗尽提示等待额度恢复；五次上限不承诺自动重试。
账目回执根据已提交快照生成，自然回答读取parse_result.answer。
最近八轮仅用于理解问答；资金账户和时间不从历史补猜。
doctor同时检查最近对话RPC，迁移缺失时不启动。
区间命令上线前应用0029，doctor检查目标查询RPC。
`修改时段 YYYY-MM-DD HH:MM-HH:MM 活动 [分类]`直接执行。
`补录 昨天 HH:MM-HH:MM 活动 [分类]`使用同一事务。
固定格式绕过模型和云记忆，原消息日期保持冻结。
替换自动保留区间外内容；版本变化时要求重发命令。
撤销恢复原段，后续修改不被覆盖；原话与审计保留。
提示词及工作区AGENTS.md必须与新程序一起更新。
投递失败退避重试；回答恢复不再次调用模型。

管家规则真源为 `apps/relay/prompts/parse.md`。
部署脚本将同一内容写入工作区 `AGENTS.md`。
工作区副本与源码不同，doctor 拒绝启动。
每次模型调用同时注入规则、真实账户与进行中活动。
`apply_steward` 校验账户、活动版本与租约后提交。
原话标签覆盖灵感、日记和情绪；不宣称写入 Obsidian。
本机 skill 与云端差异见 `docs/管家元提示词.md`。
上线前先运行本地 relay 和数据库测试。
真实模型探针为 `node ops/probe-steward.mjs`。
问答探针为`node ops/probe-dialogue.mjs`。
先暂停生产服务，探针结束后恢复，避免并发 CLI。
探针只用合成语句，不写用户账本或发送微信。

微信会话失效时，停止服务，再按 `wechat.md` 重新扫码。
重新绑定后启动服务。检查点会按机器人账号判断是否复用。
不要同时运行本机微信入口或第二个轮询器。

回收旧项目之前，执行 `node ops/backup-project.mjs PROJECT_REF`。
需要本机已登录 Supabase CLI 和 libpq 的 pg_dump/pg_restore。
备份与独立密钥保存在本机 `~/Library/Application Support/LifeOS/backups`。
这是回收前备份，不替代每日异地备份和恢复演练。
