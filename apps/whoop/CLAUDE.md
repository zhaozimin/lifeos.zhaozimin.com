# LifeOS WHOOP - 身体数据与晨间计划
> L2 | 父级: ../../CLAUDE.md

Node.js 22 + 原生SQLite + HTML/CSS/SVG。
复用本机WHOOP v0.4.0，增加VPS发布边界。
独立用户只监听回环地址，不启动微信接收器。
工作库保存OAuth；发布副本排除凭据。

成员清单

server/: WHOOP同步、趋势、恢复规则与云端队列。
public/: 原版六页界面；网页构建器生成同源健康资源。
tests/: 同步、报告、权限边界和无凭据发布验收。
package.json: start运行VPS组合根，dev运行本机HTTP入口。
.env.example: 私有运行环境字段；不含实际凭据。

运行位置为`/opt/lifeos-whoop`。
工作库为`/var/lib/lifeos-whoop/lifeos.sqlite`。
每30分钟同步，串行循环每10秒检查操作队列。
晨间调度沿用原版评分门槛和5分钟重试。
云端入口和迁移边界见`../../docs/健康接入.md`。
原本机同步服务已停用；localhost入口改走SSH隧道。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
