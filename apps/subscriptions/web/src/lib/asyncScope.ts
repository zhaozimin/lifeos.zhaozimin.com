/**
 * [INPUT]: 依赖 React 生命周期
 * [OUTPUT]: 提供 useAsyncScope，按通道分配请求身份并在新请求或卸载时使旧结果失效
 * [POS]: lib 的异步提交边界；组件只在票据仍有效时提交数据或错误
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useRef } from "react";

export function useAsyncScope() {
  const versions = useRef(new Map<string, symbol>());
  useEffect(() => () => { versions.current.clear(); }, []);
  function begin(channel = "default") {
    const token = Symbol(channel);
    versions.current.set(channel, token);
    return () => versions.current.get(channel) === token;
  }
  function invalidate() { versions.current.clear(); }
  return { begin, invalidate };
}
