/**
 * [INPUT]: 依赖 React input/textarea 属性、可选前后内容、clsx 与 fields.css 的 .field 输入槽。
 * [OUTPUT]: 对外提供标签、提示、错误与焦点状态统一的 TextInput 和 TextArea。
 * [POS]: components/ui 的文本输入原语；两域表单共享，TextArea 仅时间侧关键词编辑使用，本体不承担业务字段验证。
 *   错误＝朱色描边加一句「怎么改」，不只变红。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import clsx from "clsx";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  containerClassName?: string;
}

function FieldText({ hint, error }: { hint?: string; error?: string }) {
  if (!hint && !error) return null;
  return <span className={clsx("field-hint", error && "field-hint--error")}>{error || hint}</span>;
}

export const TextInput = forwardRef<HTMLInputElement, Props>(function TextInput(
  { label, hint, error, leading, trailing, className, containerClassName, ...rest },
  ref,
) {
  return (
    <label className={clsx("block", containerClassName)}>
      {label && <span className="field-label">{label}</span>}
      <span className="field" data-invalid={error ? "true" : undefined}>
        {leading && <span className="flex shrink-0 text-zzm-muted">{leading}</span>}
        <input
          ref={ref}
          aria-invalid={error ? true : undefined}
          className={clsx(
            "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
            className,
          )}
          {...rest}
        />
        {trailing && <span className="flex shrink-0 text-zzm-muted">{trailing}</span>}
      </span>
      <FieldText hint={hint} error={error} />
    </label>
  );
});

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, className, containerClassName, ...rest },
  ref,
) {
  return (
    <label className={clsx("block", containerClassName)}>
      {label && <span className="field-label">{label}</span>}
      <span className="field field--area" data-invalid={error ? "true" : undefined}>
        <textarea ref={ref} aria-invalid={error ? true : undefined} className={clsx("resize-y", className)} {...rest} />
      </span>
      <FieldText hint={hint} error={error} />
    </label>
  );
});
