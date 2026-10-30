/**
 * [INPUT]: 已提交账目、持久化自然回答、原话标签和小结。
 * [OUTPUT]: 账目、纠错前后对比、WHOOP状态、控制回执与自然回答。
 * [POS]: 唯一回复渲染器；账目成功仍只依据数据库快照。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { RawInput, RecordSnapshot, DailySummary } from './contracts.js';
import { RelayError } from './errors.js';

export function money(cents: number | string, currency = 'CNY'): string {
  if (typeof cents === 'number' && !Number.isSafeInteger(cents)) throw new RelayError('REPLY_AMOUNT_INVALID');
  const value = BigInt(cents);
  const absolute=value<0n?-value:value;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const prefix = ({ CNY: '¥', USD: '$', EUR: '€' } as Record<string, string>)[currency] ?? `${currency} `;
  return `${value<0n?'-':''}${prefix}${whole}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
export function clock(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}
export function formatReceipt(snapshot: RecordSnapshot, result: Record<string, unknown> | null = null): string {
  const lines: string[] = [];
  const answer = typeof result?.answer === 'string' ? result.answer.trim() : '';
  const edits=(result?._time_corrections??[]) as Array<{before:Record<string,unknown>;after:Record<string,unknown>}>;
  const dateFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
  const describe=(entry:Record<string,unknown>)=>{
    const start=String(entry.start_at);
    const day=dateFormat.format(new Date(start));
    const endDay=entry.end_at?dateFormat.format(new Date(String(entry.end_at))):day;
    const end=entry.end_at?`${endDay===day?'':endDay+' '}${clock(String(entry.end_at))}`:'进行中';
    return `${day} ${clock(start)}–${end} ${String(entry.activity)} · ${String(entry.category)}`;
  };
  for (const edit of edits) lines.push(`✓ 已修改\n原：${describe(edit.before)}\n现：${describe(edit.after)}`);
  for (const entry of snapshot.time_entries) {
    const category=entry.category==='待确认'&&/(睡觉|睡眠|午睡|补觉|入睡|打盹)/u.test(entry.activity)
      ? '待确认（等待WHOOP校准）' : entry.category;
    lines.push(entry.end_at
      ? `✓ ${entry.activity} · ${clock(entry.start_at)}–${clock(entry.end_at)} · ${entry.duration_min}分钟 · ${category}`
      : `▶ ${entry.activity} · ${clock(entry.start_at)}起 · ${category}`);
  }
  for (const entry of snapshot.transactions) {
    const accounts: Record<string, string> = { wechat_pay: '微信支付', alipay: '支付宝' };
    const account = entry.account ? ` · ${accounts[entry.account] ?? entry.account}` : '';
    const direction = entry.direction === 'income' ? '收入 ' : '';
    lines.push(`✓ ${direction}${money(entry.amount_cents, entry.currency)} ${entry.note ?? entry.category}${account} · ${entry.category}`);
  }
  if (typeof result?._stopped_at === 'string') lines.push(`⏸ ${clock(result._stopped_at)}起暂停记录`);
  const archive = result?.archive_kind;
  if (!answer) {
    if (archive === 'inspiration') lines.push('✓ 灵感原话已存数据库');
    else if (archive === 'diary') lines.push('✓ 日记原话已存数据库');
    else if (archive === 'emotion' || (archive === 'raw' && !lines.length)) lines.push('✓ 已存原话');
  }
  const unsupported: Record<string, string> = {
    correction: '可以修改单条时间记录的活动、分类和起止时间；复杂拆分、合并请在网页操作。',
    transfer: '转账、还款与报销核销请在网页记录。',
    foreign_currency: '目前只记人民币，请折算后报数；尚未入账。',
    recurring: '尚未开启周期自动记账，请每次发生时告诉我。',
    knowledge: '已保留原话；知识整理仍在 Obsidian 中完成。',
    schedule: '计划请在网页录入，尚未记成实际活动。',
    history_query: '微信暂支持“今天”汇总，其他范围请在网页查询。',
    obsidian_binding: 'VPS 尚未连接本机 Obsidian；原话已存数据库。',
    other: '这项操作尚未接入，已保留原话。',
  };
  if (!answer && typeof result?.unsupported === 'string' && unsupported[result.unsupported]) {
    if (!lines.length) lines.push('✓ 已存原话');
    lines.push(unsupported[result.unsupported]!);
  }
  if (answer) lines.push(answer);
  if (!lines.length) lines.push('✓ 已存原话');
  return lines.join('\n');
}
export function formatCommand(input: RawInput): string {
  const value = input.parse_result ?? {};
  if (value.command === 'daily') return formatDaily(value as unknown as DailySummary);
  if (value.command === 'help') return '可以直接提问、聊天或继续追问，我会回答；每句话也会保留原文。\n时间：开始写代码／9点到10点写方案\n纠错：把今天18:13到18:25的休息改成写作／把上一段结束时间改到18:25\n收支：午饭38元，生活账户，微信付\n灵感、日记和感受：直接说\n指令：今天、撤销、帮助、停止计时、取消追问';
  if (value.command === 'cancel') return '已取消待补充的问题。';
  if (value.command === 'stop') return Number(value.stopped_count ?? 0)>0 && typeof value._stopped_at==='string'
    ? `⏸ ${clock(value._stopped_at)}已停止计时，当前活动已结束。` : '当前没有进行中的计时，已退出待补充的问题。';
  if (value.command === 'undo' && value.correction_conflict) return '这次时间修改之后记录又发生了变化，未执行撤销。请说明要恢复的日期、时段和内容。';
  if (value.command === 'undo' && Number(value.restored_corrections)>0) return `已撤销上一条记录，恢复 ${Number(value.restored_corrections)} 处时间修改，原话和修改历史保留。`;
  if (value.command === 'undo') return value.undone
    ? `已撤销上一条记录（${Number(value.record_count ?? 0)} 条账目），原话保留。${value.restore_skipped ? '\n前一活动已有后续修改，请在网页核对。' : ''}` : '没有可以撤销的记录。';
  const times = (value.time ?? []) as Array<{ name: string; minutes: number }>;
  const totals = (value.money ?? []) as Array<{ currency: string; direction: string; cents: number }>;
  return ['今日汇总', ...times.map((entry) => `· ${entry.name} ${entry.minutes} 分钟`),
    ...totals.map((entry) => `· ${entry.direction === 'income' ? '收入' : '支出'} ${money(Number(entry.cents), entry.currency)}`),
    ...(!times.length && !totals.length ? ['今天还没有已整理的记录。'] : []),
  ].join('\n');
}
export function formatDaily(value: DailySummary): string {
  const lines = [`${value.day} 今日小结`, `截至 ${clock(value.as_of)}（北京时间）`];
  if (value.time.length) lines.push(...value.time.map(e => `· ${e.name} ${e.minutes} 分钟`));
  else lines.push('时间：暂无已整理记录。');
  if (value.money.length) lines.push(...value.money.map(e => `· ${e.direction === 'income' ? '收入' : '支出'} ${money(e.cents,e.currency)}`));
  else lines.push('收支：暂无已整理记录。');
  lines.push(`已覆盖 ${value.covered_minutes} 分钟，未记录 ${value.gap_minutes} 分钟。`);
  if (value.time.reduce((n,e)=>n+e.minutes,0)>value.covered_minutes) lines.push('分类含重叠时段，覆盖时长已去重。');
  if (value.gaps.length) {
    const label=value.gaps_truncated ? `最长的 ${value.gaps.length} 段空白` : '空白时段';
    lines.push(`${label}（至少 ${value.gap_min_minutes} 分钟）：`);
    lines.push(...value.gaps.map(e=>`· ${clock(e.start_at)}–${clock(e.end_at)}（${e.minutes} 分钟）`));
  }
  return lines.join('\n');
}
