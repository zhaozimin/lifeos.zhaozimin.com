# ops/
> L2 | 父级: ../CLAUDE.md

成员清单
check-public-repo.py: 候选文件、暂存版本与历史分发守卫；识别生产样本，只输出路径。
check_public_repo_test.py: 临时Git仓库验收；覆盖未跟踪、暂存残留与已删除历史。
ui-preview.mjs: 根目录UI启动；补齐依赖并构建订阅，不读取云端凭据。

install-antigravity.sh: root 安装入口；创建专用用户、私有登录目录及独立运行目录，校验官方安装脚本，以 lifeos 身份安装 CLI；不改现有服务与网络规则。
antigravity.md: 运维入口；说明安装、SSH 授权、Gemini 3.8 验收及资格错误的恢复步骤，凭据只留在 VPS。
install-node.sh: Node.js 22 安装入口；校验官方发布包，安装至 lifeos 主目录，不修改系统级命令。
backup-project.mjs: 回收前备份；用本机 CLI 临时权限导出 public/auth/storage，下载 Storage 实体，私有加密落盘并反解校验。
import-categories.py: 分类导入入口；只读本机活跃分类，输出仅新增的私有 SQL，不读取交易与余额。
export-time-review.py: 人工分类交付；按来源编号合并私有快照，生成包含全部记录的离线HTML。
import-time-groups.py: 返还分类的只读核对；忽略细类空白，生成带当前版本的私有大类应用计划。
time-review.html: 无私人数据的整理模板；同名批量、逐条覆盖、类别映射和HTML/JSON返还。
history_source.py: 三库一致性快照与保真投影；保留负数、进行中、扣减和原始行。
history_sql.py: 私有迁移 SQL；稳定编号去重，来源变化拒绝覆盖，重导保留人工编辑。
import-history.py: 历史迁移入口；生成快照、事务和核对清单，不自行连接生产库。
verify-history.py: 独立迁移验收；源快照逐行逐字段对照云端导出，并核对附件字节。
install-backup-tools.sh: 备份依赖入口；安装 PostgreSQL 17 客户端、age 与 AWS CLI，创建独立用户，不安装数据库服务。
aws-cli-team.asc: AWS 官方文档发布的公开签名密钥；固定指纹，校验官方 CLI 安装包。
backup.py: 每日备份；含访客开关及健康公开副本，age加密并校验R2对象。
subscriptions-backup.py: 订阅SQLite与卡面一致快照，加密到独立R2前缀并保留30天。
verify-subscriptions-backup.py: 解密订阅归档，隔离核对完整性、逐表数据和卡面字节。
lifeos-subscriptions-backup.service: root短时快照；R2配置不交给订阅应用。
lifeos-subscriptions-backup.timer: 北京时间每日02:10备份，不依赖电脑。
verify-backup.py: 本机恢复验收；私有Unix socket核对全部副本，验证本人AAL2、实睡净分钟和设备行保护。
lifeos-backup.service: 独立备份用户入口；只读数据库、私有配置、只写备份目录。
lifeos-backup.timer: 北京时间每日 02:00 调度；离线错过时补跑。
deploy-backup.sh: 备份上线入口；首次执行通过后启用定时器，失败不影响 relay。
backup_tools_test.py: 运维行为验收；验证分类筛选、SQL 转义与保留期清理边界。
backup.md: 数据恢复入口；定义调度、只读账号、限桶凭据、异地副本校验与隔离恢复边界。
lifeos-relay.service: systemd常驻入口；装载独立MemOS凭据，保持单实例、出站网络和进程组回收。
lifeos-daily.service: 小结入队任务；使用既有数据库配置，不启动额外微信接收器。
lifeos-daily.timer: 北京时间 23:30 调度；错过不在晨间补发。
lifeos-subscription-reminders.service: 订阅七天提醒入队；读取回环API及当前绑定，复用relay投递。
lifeos-subscription-reminders.timer: 北京时间09至21点整点检查；重启补查，同笔续费按日期去重。
subscription-reminders.md: 七天扣款提醒的安装、预览、失败重试和微信上下文边界。
lifeos-subscriptions.service: 独立订阅用户；只监听回环18787，沿用原版分钟结算。
lifeos-subscriptions-tunnel.service: 独立出站连接器；VPC只路由订阅端口，不创建公开域名。
lifeos-whoop.service: 独立WHOOP用户；每30分钟同步，发布健康副本与晨间计划。
deploy-daily.sh: 小结上线入口；默认仅安装，明确 --enable 才激活新定时器。
daily.md: 小结运维入口；定义上下文、幂等、只读预览与主动推送的启用边界。
deploy-relay.sh: VPS 部署入口；构建依赖并同步管家 AGENTS.md，通过一致性检查后接收消息。
probe-steward.mjs: 官方模型语义探针；合成语句验证活动、收支与存档，不连接微信或数据库。
probe-dialogue.mjs: 官方模型对话探针；合成问答和记账边界，可按名称复验失败场景，不发送微信。
probe-memory.mjs: 云记忆端到端探针；隔离合成身份，验证无最近对话时agy使用跨会话云记忆。
probe-timing.mjs: 计时语义探针；验证连续边界、单次切换和直接执行，不发送微信。
probe-time-corrections.mjs: 纠错语义探针；合成时段验证修改、混合切换、日期和普通补录，不读真实账本。
probe-time-groups.mjs: 大类语义探针；验证工作、如厕与本人休息措辞差异，不写业务库。
relay.md: 常驻收发说明；定义私有配置、运行检查与失效会话恢复。
memory.md: 云记忆运维；说明身份、同步状态、未知写入核查、启停和备份边界。
wechat-login.mjs: 微信授权入口；SDK 申请二维码，生成私有 PNG，确认后保存凭据并退出，不接收业务消息。
patch-wechat-sdk.mjs: 固定 SDK 的兼容补丁；校验源码摘要，将扫码长轮询延长为 35 秒，超时返回等待，保留同一二维码。
wechat-sdk-patch.test.mjs: 补丁边界测试；验证超时恢复、等待时长与真实错误传播。
wechat.md: 微信绑定说明；定义扫码、配对码、凭据位置与当前接通边界。
package.json: 扫码工具依赖；锁定独立 SDK 与二维码渲染器，运行时要求 Node.js 22。
package-lock.json: npm 完整性清单；固定扫码依赖树，由 npm 生成。

选型：腾讯官方插件依赖完整 OpenClaw。独立 SDK 直接提供登录接口，当前选用 @wechatbot/wechatbot 2.2.0。其扫码长轮询超时偏短，安装后应用校验补丁。扫码与业务消息轮询分开执行。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
