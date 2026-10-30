/**
 * [INPUT]: 官方 agy 的 JSON 信封与模型响应文本。
 * [OUTPUT]: 待 schema 校验的 JSON 值及明确的空响应错误。
 * [POS]: CLI 格式边界；只剥离完整 JSON 代码块，不从解释中截取对象。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { RelayError } from '../errors.js';

export function decodeResponse(envelope: unknown): unknown {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new RelayError('PARSER_JSON_INVALID');
  }
  const value = envelope as Record<string, unknown>;
  if (value.status !== 'SUCCESS') throw new RelayError('PARSER_REQUEST_FAILED');
  if (value.structured_output !== undefined && value.structured_output !== null) {
    return value.structured_output;
  }
  if (typeof value.response !== 'string' || !value.response.trim()) {
    throw new RelayError('PARSER_RESPONSE_EMPTY');
  }
  const text = value.response.trim();
  const fenced = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/i.exec(text);
  try { return JSON.parse(fenced ? fenced[1]! : text); }
  catch { throw new RelayError('PARSER_JSON_INVALID'); }
}
