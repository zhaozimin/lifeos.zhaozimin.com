/**
 * [INPUT]: 常驻规则、官方agy、有限对话与只读记忆片段。
 * [OUTPUT]: 经校验的工具计划和自然回答；格式错误仅补试一次。
 * [POS]: Parser 的 CLI 实现；不读取 OAuth 文件，不访问微信或数据库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Parser, ParserInput, ParseResult } from '../contracts.js';
import { RelayError } from '../errors.js';
import { parseJsonSchema, validateParse } from './schema.js';
import { runAgy, type RunnerOptions } from './runner.js';
import { decodeResponse } from './response.js';
import { readStewardRules } from './rules.js';

type Run = (prompt: string, schema: unknown) => Promise<unknown>;
export class AntigravityParser implements Parser {
  private readonly run: Run;
  constructor(public readonly enabled: boolean, options: RunnerOptions, run?: Run) {
    this.run = run ?? ((prompt, schema) => runAgy(options, prompt, schema));
  }
  async parse(input: ParserInput): Promise<ParseResult> {
    if (!this.enabled) throw new RelayError('PARSER_DISABLED');
    const template = (await readStewardRules())
      .replace(/^<!--[\s\S]*?-->\s*/, '');
    const payload = JSON.stringify({ ...input, timezone: 'Asia/Shanghai',
      categories: input.categories.filter((c) => c.is_active)
        .map(({ code,name,kind,keywords,direction,nature }) => ({ code,name,kind,keywords,direction,nature })),
    });
    const prompt = `${template}\n\n输入 JSON：\n${payload}`;
    let correction = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const envelope = await this.run(prompt + correction, parseJsonSchema);
        return validateParse(decodeResponse(envelope), input.categories, input.context);
      } catch (error) {
        if (error instanceof RelayError && !['PARSER_JSON_INVALID', 'PARSER_RESPONSE_EMPTY', 'PARSER_SCHEMA_INVALID',
          'PARSER_TIME_INVALID', 'PARSER_CATEGORY_INVALID', 'PARSER_CATEGORY_DIRECTION_INVALID',
          'PARSER_CLARIFICATION_CONFLICT', 'PARSER_ACCOUNT_REQUIRED', 'PARSER_ACCOUNT_INVALID',
          'PARSER_TIME_EVENT_INVALID'].includes(error.code)) throw error;
        if (attempt === 1) throw error instanceof RelayError ? error : new RelayError('PARSER_JSON_INVALID');
        const code = error instanceof RelayError ? error.code : 'PARSER_JSON_INVALID';
        correction = `\n\n上次输出未通过机器校验（${code}）。请根据以上相同输入重新生成完整 JSON 对象。`
          + '保持 received_at 不变，只使用输入中的分类 code。不要 Markdown、解释文字或工具调用。';
      }
    }
    throw new RelayError('PARSER_JSON_INVALID');
  }
}
