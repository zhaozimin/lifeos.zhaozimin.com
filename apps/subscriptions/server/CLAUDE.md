# server/
> L2 | 父级: ../CLAUDE.md

成员清单
visitor.py: SQLite只读公开目录；不选择价格、账号或支付字段。
visitor_icons.py: 固定品牌图来源与安全字标；不读取自定义卡面，不公开原网址。
test_visitor.py: 公开目录不泄露敏感字段且不改动数据库字节。
clock.py: 日期与金额纯函数。保留月末锚点，统一提醒与预测；余额式预测以可支付期数为上限。
catalog.py: 演示账号仅使用保留域名；首次空库时写入默认分类。用户删掉后不再种回去。有商店条目则给出 /icons/{trackId}.jpg。词表覆盖本机话费卡和 VPS。
appstore.py: iTunes Lookup + 本地方图缓存。圆角阴影不烤进文件。
schema.py: schema 12 迁移新增订阅方式。旧电话卡保留余额式，其他订阅保留自动扣款式；原余额列和充值编号原样保留。
billing.py: 双模式计费真源。切换保留原支付绑定，未配置正常信用卡时等待配置。余额按周期抵扣，不足暂停；旧列与回包别名兼容，不接入实际付款。
test_phonebalance.py: 临时库验证月末、离线补扣、停订恢复、并发充值、幂等和事务回滚。
test_billing.py: 验证全分类双模式、所有周期、切换保留旧支付绑定、信用卡冻结、编辑冲突和旧迁移。
masters.py: 分类、通用支付方式与账号。支付方式输出卡类型供绑定校验；银行卡不走通用编辑口。
cards.py: 实体卡/虚拟卡 CRUD、本机封面引用与订阅占用数。拒绝完整卡号、CVV/CVC、PIN、卡密与验证码。
cardidentify.py: 严格只接收 8 位 IIN/BIN；本地判定卡组织，显式请求时从固定 BINLIST 端点取得发卡行、官网、卡种、产品和国家候选。不上库，远端失败降级。
cardartsearch.py: 不落库的卡面候选发现边界。有密钥走 Brave Images API，无密钥走 DuckDuckGo Images 兼容回退；按官网域名、标准卡片比例与产品词排序，拒绝卡号和非 HTTPS 候选。
cardcovers.py: 官方卡片页/图片的 HTTPS 读取、OG 提取、图片魔数白名单与内容寻址缓存。每跳只连接已验证公网 IP，TLS 仍核对原域名，不使用环境代理；拒绝 SVG 与超大文件。
aicardart.py: AI 卡面适配器。浏览器原图不入服务端；只接收 32×20 RGB/RGBA PNG，校验压缩流、去除元数据；出站文本拒绝卡号/BIN 与安全码，调用 GPT Image 生成无文字底图并复用内容寻址缓存。Key 只读环境变量或 macOS 钥匙串。
store.py: 订阅写路径与汇总。组合 billing、reminders、masters 与 cards；切换方式保留余额和状态，读取时结算已配置的周期。
runtimeops.py: SQLite 一致快照与被引用图片组成原子备份组；迁移先停写、拒绝覆盖已有目标并保留来源；只停止入口已核验的进程。
reminders.py: 待提醒列表、五分钟独占领取、凭据回执与失败释放；未回执租约超时可重试，打印不等于送达。
test_cli.py: Skill 文案不提前回执、领取凭据防覆盖、投递成功确认与取消不冻结的 HTTP 契约回归。
test_regressions.py: 临时库跨边界回归：事务回滚、交错写入、长跨度日期、备份恢复与迁移冲突、卡片隐私、DNS 绑定和投递租约。
subos_server.py: 标准库 HTTP 与双模式分钟结算。所有订阅复用余额和充值动作口。仅监听回环，校验 Host、Origin 与 JSON Content-Type；开发来源须显式配置。
test_clock.py: 周期进位、月折合、紧急度、7/3/1 波次与恢复日还天数的回归。
test_store.py: 续费确认、暂停冻结与恢复归还、外键占用拒绝、汇总口径、提醒回执只响一次、删分类后再开库。
test_cards.py: 卡片形态、本机封面引用、通用支付联动、敏感字段拒绝、重复卡和订阅占用回归。
test_cardidentify.py: 8 位边界、卡组织号段、BIN 候选形状、响应不回显 IIN 与断网降级回归。
test_cardartsearch.py: 卡号拒绝、HTTPS 白名单、官网优先、标准比例评分与可注入搜索提供方的回归。
test_cardcovers.py: OG 卡面提取、公网 HTTPS 校验、内网拒绝、JPG/PNG/WebP 白名单和缓存编号回归。
test_appstore.py: 方图地址升级与域名到 trackId。
test_catalog.py: 广电 / Tello / 搬瓦工等本机词表。
test_server.py: 本机 HTTP 契约回归。覆盖全订阅双模式切换、幂等充值、两种后台续期、银行卡、卡面与来源校验。
test_aicardart.py: 脱敏参考尺寸门、提示词隐私约束、multipart 请求、Keychain 不回显与 AI 结果缓存的全离线回归。
runtime/: 部署时软链到/var/lib/lifeos-subscriptions；含SQLite与私有卡面，Git忽略。
web/: 预构建前端，由 web/ 源码 build 写入。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
