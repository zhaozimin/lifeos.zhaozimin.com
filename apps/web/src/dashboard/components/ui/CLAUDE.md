# ui/
> L2 | 父级: ../CLAUDE.md

本目录把赵子民设计系统（design/zzm/zzm.css）落成 React 原语。
键用 .zzm-btn 家族，卡片用 .zzm-card，确认窗用 .zzm-dialog-*；输入槽几何在 fields.css。
页面只选语义变体，不散写阴影、圆角与颜色。

成员清单
AlertDialog.tsx: 确认与通知窗；纸面 440 宽，遮罩只降亮。框内显示异步失败，提交期间拦截 Esc。朱键只给破坏性确认。
Autocomplete.tsx: 自适应选择器；桌面为可搜索组合框（.field 外壳 + .zzm-popover 浮层 + .option-row 选项），触屏降级为原生 select。
Badge.tsx: 只读标签；不可点，所以是胶囊。朱色只给需要处理的 primary 档，其余用中性灰或哑光数据色。
Button.tsx: 键原语；primary 与 destructive 朱键（主配色朱砂红）、secondary/outline 纸键、ghost 幽灵键；loading 走 --busy。
Card.tsx: 容器原语；default 为 .zzm-card 白卡，muted 为卡内 12 圆角浅灰面。
DatePicker.tsx: 日期选择；桌面弹出月历浮层（MonthGrid），移动端使用系统日期选择器。
fields.css: 输入槽外壳 .field、标签与提示文字、.zzm-popover 浮层、.option-row 选项行；只引用设计系统材质令牌。
KPICard.tsx: 指标卡；mono 节标签 + 数值 + 辅助口径。趋势只用墨与灰，不用红绿替用户下结论。
MonthGrid.tsx: 日期选择器与全领域日期面板共用月历；选中日朱底白字，区间中段朱色淡底；墙钟日期字符串进出，支持单日、整段与端点强调三种选中呈现。
Modal.tsx: 编辑弹层；统一尺寸、滚动锁、Esc 关闭和不卸载表单的错误槽。
PageHeader.tsx: 页头骨架；mono 节标签 + 标题 + 行内注记 + 右侧工具条。全部页面共用。
SegmentedSwitch.tsx: 少档位模式开关；一排 sm 纸键，当前档是朱键。不做胶囊分段控件。
Select.tsx: 原生选择器；共用 .field 输入槽，支持 sm/md 两档高度。
StatusPill.tsx: 保存状态提示；不可点，无面无光影，状态色只落在图标上。
Tabs.tsx: CategoryTabs；segmented 为下划线标签（2px 朱线＝这一屏的「你在这里」），pills 为 sm 按钮组。一屏只留一组朱线。
TextInput.tsx: 文本与多行输入；错误＝朱色描边加一句怎么改。
TimelineCanvas.tsx: 时间画布结构与交互视觉原语；稳定三列骨架，按需扩展引导线通道与细节栏，统一缩放、标签、刻度、分布/事项块及调时手柄。缩放步进键是幽灵键。
timeline.css: 日/周时间轴样式真源；整屏弹性视口、五列等分布局、23px 渐进披露、细节标签/引导线、选中手势与响应式 token。「现在」线是朱色。

法则: 时间与财务两域的页面都从这里消费原语；设计系统的样张与规范在 ui.zhaozimin.com，本地不维护展示页。
财务侧只有 `fin/components/ui/` 中列出的分叉件例外，新增原语一律落在本目录，禁止按域再复制一套。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
