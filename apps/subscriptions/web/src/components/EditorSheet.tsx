/**
 * [INPUT]: 依赖 react-router 的 /new 与 /s/:id，依赖 Sheet、EditorForm 与访客只读详情
 * [OUTPUT]: 对外提供订阅编辑 Sheet。打开时背后整页毛玻璃
 * [POS]: components 的编辑层，App 常驻；看板仍在下面；访客不挂载写入表单
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useMatch, useNavigate } from "react-router-dom";
import { EditorForm } from "../pages/Editor";
import { Sheet, SheetContent } from "./ui/sheet";
import {isVisitor} from '../visitor';
import {VisitorDetail} from '../pages/VisitorDetail';

export function EditorSheet() {
  const navigate = useNavigate();
  const creating = useMatch("/new");
  const editing = useMatch("/s/:id");
  const open = Boolean(creating || editing);
  const id = editing?.params.id;

  function close() {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  }

  function saved() {
    /* 写接口自己会广播 subos:changed */
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <SheetContent side="right">
        {open ? isVisitor()?<VisitorDetail key={id??'new'} id={id}/>:<EditorForm key={id ?? "new"} id={id} onSaved={saved} onClosed={close} /> : null}
      </SheetContent>
    </Sheet>
  );
}
