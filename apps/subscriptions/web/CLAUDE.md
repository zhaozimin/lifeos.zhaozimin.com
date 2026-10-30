# web/
> L2 | 父级: ../CLAUDE.md

成员清单
test/: Node test runner + 真实 React/Radix 的 JSDOM 回归，不启动浏览器。
package.json: 包含云端与独立构建、npm test回归入口，React Router 7.18.2； React 19 + Vite 8 + Tailwind 4，与 FinOS 看板同族。
package-lock.json: npm 精确依赖与完整性锁定，安装和安全审计以此为依据。
tsconfig.json: TypeScript 构建入口，引用应用和构建配置两个类型检查项目。
tsconfig.app.json: 浏览器源码的严格类型检查，禁止未使用声明，不输出 JavaScript。
tsconfig.node.json: Vite 配置的 Node 类型检查，与浏览器代码分离。
vite.config.ts: 独立构建写入server/web，云端构建写入cloud-web；开发代理 /v1、/icons、/card-covers 到 127.0.0.1:18787。
index.html: 看板 HTML 壳。挂 favicon 与 Apple 触摸图标。
public/: 站点标。朱底倒计时环，苹果用正方形原图。
src/: 页面、组件、类型与 API。见 src/CLAUDE.md。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
