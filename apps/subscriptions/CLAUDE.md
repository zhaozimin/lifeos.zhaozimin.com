# subscriptions/ - SubOS订阅与支付工具
> L2 | 父级: ../CLAUDE.md

Python标准库 + SQLite schema 12 + React + Cloudflare私有VPC服务。
VPS工作库是唯一在线真源，LifeOS通过本人AAL2访问。
复用本机SubOS源码和页面，不生成实际付款或财务流水。

成员清单
server/: 原版订阅、双模式结算、支付工具、提醒与隔离测试。
web/: 原版界面的LifeOS嵌入构建，使用同源受限接口。
skill/: 原版HTTP操作CLI及其兼容测试文案；不自动接入微信。
edge/: 私有Worker，固定代理VPS回环18787端口。
PRODUCT.md: 原版产品定义和记账边界。
DESIGN.md: 订阅域对纸墨朱设计系统的语义映射与本地约定；真源在 ui.zhaozimin.com。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
