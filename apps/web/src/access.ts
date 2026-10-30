/**
 * [INPUT]: 根组件确认的会话级别。
 * [OUTPUT]: 访客只读呈现与独立公开API地址。
 * [POS]: 前端访问模式；服务端权限不依赖此状态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {createContext,useContext} from 'react';
export const AccessContext=createContext({owner:true});
export const useAccess=()=>useContext(AccessContext);
let ownerMode=true;
export function configureAccess(owner:boolean){ownerMode=owner;}
export function nativeEndpoint(){return ownerMode?'/api/native':'/api/visitor/native';}
export function isVisitor(){return !ownerMode;}
