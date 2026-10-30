# LifeOS 随身管家 - 微信记录与私密面板

技术栈：Node.js 22 + TypeScript + React 19 + Tailwind + Vite + Supabase + Cloudflare Pages / Workers + Python + SQLite。

微信管家复用 Antigravity CLI，不使用独立模型API Key。
时间、财务、健康与订阅共用纸墨朱设计系统。
访客默认只读；本人使用密码加TOTP。
Worker检查身份，数据库RLS再次检查本人AAL2。
认证入口经内部Cloudflare限流；访客不显示登录链接。
财务公开响应不含真实金额，图表仅展示示意结构。
健康公开副本通过白名单重建，私人自述不公开。
WHOOP夜间及午睡校准时间轴；首尾手机归娱乐。
MemOS按配置召回与同步微信记忆，不上传全量账本。
VPS在订阅扣款前七天入队微信提醒，独立于浏览器通知。
微信支持按日期时段纠错，保留原话、修改版本和审计。
本机预览使用合成数据，与正式账本隔离。

<directory>
apps/ - 应用工程（4子目录：relay、web、whoop、subscriptions）。
supabase/ - 数据库迁移与权限测试（2子目录：migrations、test）。
ops/ - 预览、VPS部署、微信授权与加密备份工具。
design/ - 设计系统锁版本（1子目录：zzm）。
docs/ - 施工方案、访问契约与公开宣传素材（1子目录：media）。
.private/ - 本机凭据、原始运维记录和Git备份；Git忽略。
</directory>

<config>
README.md - 中文入口；含Logo、宣传片、实现方法及完整部署。
README.en.md - 英文入口；宣传片与部署步骤和中文保持一致。
LICENSE - 用户选择的MIT源码许可。
.gitignore - 排除生产配置、凭据、数据库和私有归档。
package.json - 本机预览、订阅重建与类型检查命令。
</config>

## 真源与边界

- docs/行动方案.html是唯一施工依据。
- docs/量化自我方案.html定义采集范围与批次。
- docs/实现方案报告.html是历史草案。
- docs/访客访问.md定义公开投影与本人权限。
- docs/仓库发布与脱敏.md定义Git分发边界。
- docs/部署记录.md与docs/安全审计.md只分发脱敏摘要。
- 生产详情和原始Git历史只存本机.private/。
- 解析规则真源在apps/relay/prompts/parse.md。
- VPS的AGENTS.md由同一规则生成，doctor检查漂移。
- 受限事务写入账本，原话禁止改写或删除。
- 时间存timestamptz，显示使用Asia/Shanghai。
- 金额使用整数分。

## 变更约定

- 进入目录前先读CLAUDE.md及文件L3契约。
- 源文件包含INPUT、OUTPUT、POS和固定PROTOCOL。
- 修改后检查L3、L2、L1与行动方案。
- 单个业务源码文件不超过800行。
- 凭据、私人数据和生产资源编号不得进入Git。
- 保留作者品牌、Logo、公开网站和推广链接。
- 订阅内部服务的wrangler.toml仅保留本机。
- 其他部署者从wrangler.example.toml填写自己的编号。

法则：极简·稳定·导航·版本精确。
