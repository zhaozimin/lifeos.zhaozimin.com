/**
 * [INPUT]: 访客公开范围说明。
 * [OUTPUT]: 私有模块的只读说明，不展示登录入口。
 * [POS]: 访客专用呈现；不通过假金额或隐藏DOM伪装脱敏。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {LockKeyhole} from 'lucide-react';
export function VisitorRestricted({title='此内容仅本人可见'}:{title?:string}){
 return <section className="m-6 rounded-lg border border-border bg-card p-8"><LockKeyhole size={22}/><h1 className="mt-4 text-title-lg">{title}</h1>
 <p className="my-4 text-sm text-muted-foreground">访客可以浏览公开的时间、健康指标和订阅目录。完整数据与修改功能需要密码及动态码验证。</p>
 </section>;
}
