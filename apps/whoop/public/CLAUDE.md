# public/

> L2 | 父级: ../CLAUDE.md

成员清单
index.html: 控制台语义骨架；只加载同源脚本与样式。
privacy.html: 本机隐私与数据使用说明；供 WHOOP 授权页面引用。
app.js: 六页状态与交互；调用 API，绑定图表解读，提交报告修订。
html.js: HTML 转义边界；文本和属性共用，防止载荷注入。
chart-help.js: 纯解读层；定义指标含义、基线比较和按日期命中载荷。
chart-interactions.js: 唯一图表交互控制器；悬停、固定、键盘和触屏共用浮层。
charts.js: 基础 SVG；绘制曲线和恢复环，日期整列可触发解读。
insights.js: 多图趋势视图；各类图形输出同一解读契约。
plans.js: 晨间训练视图与日程；优先展示当天训练、发布状态和同步凭据。
styles.css: 样式入口；按基础、展示、表单、专题和断点加载。
base.css: 全局变量与控制台骨架；定义导航、按钮和面板；主操作与当前档用朱键和朱色淡底。
dashboard.css: 数据展示组件；绘制指标、睡眠与训练表格。
forms.css: 输入和反馈组件；定义接入表单与每日记录窗口。
insights.css: 多图看板样式；定义图表网格、对照和恢复日历。
plans.css: 每日报告样式；定义日期导航、作息轴和三餐卡片。
chart-help.css: 图表解读样式；定义命中反馈、浮层和触屏底部面板。
responsive.css: 断点覆盖；适配窄屏与减少动画偏好。
favicon.svg: LifeOS 朱砂根标志；由 apps/web/brand-icons.mjs 生成，勿手改。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
