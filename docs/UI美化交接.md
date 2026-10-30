# LifeOS UI美化交接

当前项目已保存完整源码。
主面板使用React、Tailwind和Vite。
健康页复用WHOOP原版HTML、CSS和JavaScript。
订阅页复用SubOS的独立React工程。
健康与订阅通过iframe嵌入主面板。

## 本机启动

安装Node.js 22.12以上版本和Python 3。
在当前项目根目录执行：

```sh
npm run ui
```

启动器补齐缺少的锁定依赖，并构建订阅子页。
预览固定监听127.0.0.1:5173。
端口占用时，启动失败，不切换到其他服务。

| 页面 | 本地地址 |
|---|---|
| 日时间轴 | http://127.0.0.1:5173/dashboard/time/day |
| 时间统计 | http://127.0.0.1:5173/dashboard/time/stats |
| 财务面板 | http://127.0.0.1:5173/dashboard/fin/status |
| 资金流水 | http://127.0.0.1:5173/dashboard/fin/ledger |
| 健康 | http://127.0.0.1:5173/dashboard/health |
| 订阅 | http://127.0.0.1:5173/dashboard/subscriptions |
| 历史记录 | http://127.0.0.1:5173/dashboard/records |
| 原话收件箱 | http://127.0.0.1:5173/dashboard/inbox |

主面板保存源码后，Vite即时更新。
健康页保存public资源后，适配器重建并刷新。
订阅页修改后，停止预览并重新执行npm run ui。
重启会重建订阅子页并读取新的资源文件名。

## 编辑位置

| 范围 | 源码位置 |
|---|---|
| 页面路由与认证组合 | apps/web/src/App.tsx |
| 领域导航与整体布局 | apps/web/src/dashboard/components/shell/、components/Layout.tsx |
| 三个应用共用二级侧栏 | apps/web/src/dashboard/components/shell/sidebar.css |
| 全局与领域设置装配 | apps/web/src/dashboard/settings/SettingsHub.tsx |
| 时间轴与时间统计 | apps/web/src/dashboard/pages/ |
| 时间轴画布与操作 | apps/web/src/dashboard/components/timeline/ |
| 通用按钮、表单和弹窗 | apps/web/src/dashboard/components/ui/ |
| 设计系统原件（锁版本） | design/zzm/zzm.css |
| 令牌桥、字阶和全局样式 | apps/web/src/dashboard/index.css |
| 图表画布实色与数据色 | apps/web/src/dashboard/theme/index.ts |
| 财务页面及图表 | apps/web/src/dashboard/fin/ |
| 登录、历史与收件箱 | apps/web/src/及其styles/ |
| 健康页布局与图表 | apps/whoop/public/ |
| 健康页云端适配 | apps/web/health-ui.mjs、health-bridge.js、health-settings.js |
| 健康页宿主 | apps/web/src/HealthPage.tsx |
| 订阅页全部界面 | apps/subscriptions/web/src/（令牌在 design/tokens.css） |
| 订阅页宿主 | apps/web/src/SubscriptionsPage.tsx |
| 演示数据与接口 | apps/web/preview/ |

直接编辑上述源码。dist和cloud-web由构建生成。
不要编辑生成目录，下一次构建会覆盖它们。
当前文件夹是工作真源，不复制第二套前端源码。

## 演示范围

演示预览不读取.dev.vars或私有凭据。
Vite拒绝静态访问凭据、私有目录和运行数据库。
演示预览不连接Supabase、VPS、微信或MemOS。
合成时间、财务及订阅记录支持界面试改。
健康图表复用正式分析引擎，输入为合成数据。
主题、导航、筛选、时间和流水弹窗可交互。
演示接口仅覆盖美化所需的常用读写。
主数据写入、附件及外部识别不在演示范围内。
WHOOP同步与真实晨间投递仍需正式环境。
此预览不替代生产认证、RLS与事务验收。
本机18787转发真实VPS订阅库；美化预览不使用它。

## 交给其他工具的提示词

```text
请先读取CLAUDE.md和docs/UI美化交接.md。
这是LifeOS的现有完整工程，请直接改源码。
使用根目录npm run ui启动合成数据预览。
请统一主面板、健康页与订阅页的视觉和交互。
先梳理现有主题、布局与通用组件，再做设计。
保留时间统计、收支、WHOOP和订阅的业务契约。
覆盖桌面和手机，保留可用的交互与空状态。
生产认证、数据库迁移和服务配置不属于美化范围。
不要读取或上传.private、.dev.vars和运行数据库。
完成后更新L3、L2及根CLAUDE.md，执行类型检查。
请交付可运行代码和改动说明，不自动部署。
```

## 校验与发布

主面板类型检查：npm run ui:check。
正式构建：npm --prefix apps/web run build。
正式构建保留Worker、AAL2与私有订阅服务绑定。
演示插件仅由Vite的serve命令和ui模式载入。
生产包不包含演示API或免登录会话。
本机美化完成后，单独验收并执行部署。
发布流程见apps/web/README.md。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
