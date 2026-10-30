<!--
[INPUT]: 主站构建、同源认证和内部服务绑定契约。
[OUTPUT]: 网页开发、部署前置条件与登录验收。
[POS]: web 模块入口；全新实例部署以根 README 为准。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
-->
# LifeOS 云端面板

直接移植本机 LifeOS 的组件、样式和交互。
原版组件位于 src/dashboard；云端适配位于 worker/native*。
正式时间页为 /dashboard/time/day，旧入口自动跳转。
微信记录、本机历史和网页人工编辑共用 Supabase。

## 本机预览

UI美化请在项目根目录运行`npm run ui`。
它在5173端口使用合成数据，无需密码或动态码。
源码导航见[UI美化交接](../../docs/UI美化交接.md)。
下面的8788流程连接正式数据，默认只读公开投影。
查看私人账本和修改数据仍需本人双重登录。
正式网站同样默认访客，不展示登录链接。
本人手动输入`/dashboard/login`；限流与审计见[安全审计](../../docs/安全审计.md)。
权限边界见[访客访问](../../docs/访客访问.md)。

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run build
npm run dev
```

填写 LifeOS 项目的 publishable key 与本人账号标识。
不填写 relay secret key 或 service_role。
本机监听 `127.0.0.1:8788`。

## Cloudflare Pages

全新实例请按[根 README 的完整部署流程](../../README.md#完整部署流程)执行。
数据库迁移、Auth 用户和默认分类必须先初始化。
主站需要内部 Worker 的 `SUBSCRIPTIONS` 服务绑定。
该 Worker 同时提供登录限流，不能随订阅功能一起省略。
内部 Worker 的 VPC Service 指向自己的 VPS 回环服务。

在本模块安装依赖，登录 Wrangler，并修改 `wrangler.toml` 的项目名。
Pages 四项生产 Secret 使用自己项目的值：

- `SUPABASE_URL`：自己的 Supabase 项目地址。
- `SUPABASE_PUBLISHABLE_KEY`：网站公开连接键。
- `OWNER_AUTH_ID`：自己创建的 Auth 用户 UUID。
- `OWNER_EMAIL`：该用户的登录邮箱。

不要使用数据库服务端密钥，也不要复制作者生产配置。
依次执行根 README 中的 Secret、构建和发布命令。
Wrangler 配置包含服务绑定，不能只上传静态 ZIP。
配置变化后重新部署；缺少认证配置或限流服务时返回 503。
配置规则见 [Cloudflare 官方说明](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)。

## 登录与验收

新实例先在 Supabase Auth 创建本人账号。
手动打开 `/dashboard/login`，完成首次密码设置和验证器绑定。
同一数据库已有验证器时，使用原密码与动态码登录。
登录会话按域名隔离；本机 Cookie 不迁移至云端。
令牌只保存在 HttpOnly Cookie，浏览器不保存 Supabase 令牌。
生产 Cookie 使用 Secure、SameSite=Strict 和 Host 前缀。
数据接口与 RLS 都要求本人 AAL2 会话。

`npm test` 覆盖身份边界、同源请求、分页和统计契约。
`npm run build` 同时完成严格类型检查。
部署后验证未登录 API 为 401，密码会话为 403。
本人完成 TOTP 后，核对真实金额、原话和时间范围。

## 数据边界

统计时区固定为 Asia/Shanghai。
今日创作时长与覆盖率使用同一个服务端快照时间。
返回前台时刷新。连接状态每30秒复核。
含今天的时间摘要逐分钟更新。
未来时段不提前计入当前已发生时长。
金额以整数分计算，不合并不同币种。
收支净额不代表账户余额。
原版财务页面读取完整流水，分区间筛选。
原话最多100条；附加历史页按50条分页。
历史页按50条分页，可以查询和编辑全部有效历史。
本机三库已一次性导入；本机与云端尚未建立双向同步。
进行中时段保留空结束时间；扣减计入净时长。
转账保留两端账户，不计入收入或支出。
历史负数金额作为冲减，零金额保持为零。
已删除记录保留原有标记，不计入统计。
原版资金流水以删除线展示旧记录，附加历史页只显示有效记录。

## 人工编辑

登录后打开“历史记录”，选择时间、流水、任务或账户。
可以搜索标题、活动、账户和备注，或按开始日期筛选。
点击“编辑”，修改字段后点击“保存修改”。
时间块双击打开原版编辑表单，支持补录、软删除与拖拽调时。
原版资金流水使用交易编辑抽屉。
账户余额由期初余额和有效流水推导；修改当前余额生成差额记录。
对话框底部“修改记录”显示修改前后的字段值。
版本冲突时重新载入，避免覆盖其他窗口的新修改。
附件使用本人会话下载，不提供公开链接。
微信原话和导入的原始来源不被人工编辑覆盖。

原版时区迁移入口不能切换云端记录时区；云端固定北京时间。
本机与云端各自保存浏览器外观和仪表盘布局偏好。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md


订阅域随主站一起构建。`npm run build`先安装并构建
`../subscriptions/web`，再将其静态资源打包到订阅子目录。
VPS订阅数据不进入静态资源。部署契约见`../../docs/订阅接入.md`。
