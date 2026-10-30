# web/ - LifeOS 云端面板
> L2 | 父级: ../CLAUDE.md

React 19 + React Router 8 + Tailwind 4 + Vite 8 + Supabase JS 2 + Cloudflare Pages。
直接移植本机 LifeOS 的组件和图表交互；视觉统一为赵子民设计系统「纸墨朱」，浅色与深色两种模式。
Worker使用publishable key、本人会话及私有订阅服务绑定。
访客使用独立匿名客户端，只访问公开投影RPC。
登录入口只供手动输入；认证前检查内部Cloudflare限流。
微信与本机迁移提供账目。网页通过本人 AAL2 事务 RPC 编辑。
底表不授予客户端写权限；编辑保留版本并检测冲突。

成员清单

src/: 原版仪表盘、云端登录与附加历史编辑。
preview/: 独立合成数据预览；仅Vite的serve命令和ui模式载入。
worker/: 同源会话、TOTP、本人查询及版本编辑接口。
test/: 会话边界和金额、时间计算验收。
public/: Pages 静态安全头与路由配置。
index.html: 中文应用入口；无私人数据。
package.json: 构建先安装并生成SubOS独立及嵌入页面，再构建主站；含检查、预览、测试与图标生成命令；sharp 为锁版本开发依赖。
package-lock.json: 固定依赖树。
README.md: 网页开发、内部服务前置条件和双重登录验收；全新部署跳转根README。
tsconfig.json: 前后端严格类型检查。
vite.config.ts: React静态构建；ui开发模式动态加载演示插件。
build.mjs: 编译 Pages 高级模式 Worker。
brand-icons.mjs: 从朱砂根母版生成 public/ 收藏夹与桌面图标及 WHOOP 收藏夹图标；npm run icons。
health-ui.mjs: 构建健康控制台；保留图表并替换请求边界；内容区最大宽度读自共用 sidebar.css。
health-bridge.js: 浏览器同源健康请求与任务轮询，不保存任何授权令牌。
health-settings.js: 健康偏好和晨间日程表单，云端不展示OAuth凭据输入。
health-version.mjs: 原版资源、适配器、共用侧栏样式（含内容区最大宽度）与设计系统的内容版本，宿主与构建器共用。
health-version.d.mts: JavaScript内容版本函数的TypeScript声明。
wrangler.toml: Pages CLI 发布与本机预览配置；连接变量使用生产 Secret。
.dev.vars.example: 本机只读连接配置示例。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
