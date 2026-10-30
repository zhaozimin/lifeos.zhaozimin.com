/**
 * [INPUT]: 依赖 @radix-ui/react-select 的键盘与定位，以及敏感选项文本替换
 * [OUTPUT]: 对外提供纸面 Select。右侧不放箭头和滚动条，点整行仍能展开、滚轮仍能滚
 * [POS]: components/ui 的菜单。触发器跟 .field 同高，选项浮在纸面上
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as RadixSelect from "@radix-ui/react-select";
import { useCallback } from "react";
export type SelectOption = { value: string; label: string };

function markOverflow(scroller: HTMLElement | null) {
  if (!scroller) return;
  const host = (scroller.closest(".select-content") as HTMLElement | null) ?? scroller;
  host.dataset.overflow = scroller.scrollHeight > scroller.clientHeight + 1 ? "1" : "0";
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = "请选择",
  disabled,
  sensitive,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  sensitive?: boolean;
}) {
  const onViewport = useCallback((node: HTMLDivElement | null) => {
    markOverflow(node);
    if (node) requestAnimationFrame(() => markOverflow(node));
  }, []);

  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger className={sensitive ? "select-trigger is-veiled-field" : "select-trigger"}>
        <RadixSelect.Value placeholder={placeholder} className="select-value" />
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="select-content" position="popper" sideOffset={6}>
          <RadixSelect.Viewport
            ref={onViewport}
            className="select-viewport"
            onScroll={(event) => markOverflow(event.currentTarget)}
          >
            {options.map((option) => (
              <RadixSelect.Item key={option.value} value={option.value} className="select-item">
                <RadixSelect.ItemText>{sensitive && option.value !== "__none__" ? `已隐藏 · 选项 ${options.indexOf(option) + 1}` : option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

export function selectNone(value: string): string {
  return value || "__none__";
}

export function fromSelectNone(value: string): string {
  return value === "__none__" ? "" : value;
}

export function withNone(options: SelectOption[], noneLabel = "暂不指定"): SelectOption[] {
  return [{ value: "__none__", label: noneLabel }, ...options];
}
