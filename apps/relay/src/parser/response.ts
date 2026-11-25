/**
 * [INPUT]: 官方 agy 的 JSON 信封与模型响应文本。
 * [OUTPUT]: 完整JSON值，或超时、上游不可用、额度及格式错误码。
 * [POS]: CLI 完成状态与格式边界；中断输出禁止进入账目校验。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { RelayError } from '../errors.js';

export function decodeResponse(envelope: unknown): unknown {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new RelayError('PARSER_JSON_INVALID');
  }
  const value = envelope as Record<string, unknown>;
  if (typeof value.error === 'string' && /\bIndividual quota reached\b|\bquota exhausted\b/i.test(value.error)) {
    throw new RelayError('PARSER_QUOTA_EXHAUSTED');
  }
  if (typeof value.error === 'string' && /\bUNAVAILABLE\b|\bcode 503\b/i.test(value.error)) {
    throw new RelayError('PARSER_UPSTREAM_UNAVAILABLE');
  }
  // CLI 超时仍能返回 SUCCESS；完整 JSON 也不能证明这一轮已完成。
  if (value.finished_reason === 'print_timeout') throw new RelayError('PARSER_TIMEOUT');
  if (value.status !== 'SUCCESS' || value.finished_reason) throw new RelayError('PARSER_REQUEST_FAILED');
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
