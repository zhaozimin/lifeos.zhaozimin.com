/**
 * [INPUT]: CSV/TSV 字节、原版表头别名与财务主数据。
 * [OUTPUT]: 两步导入预览、建议分类和逐行日期警告。
 * [POS]: 本机 importer 的纯函数移植；预览不写账本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Configuration } from "../src/dashboard/fin/types";
import { HttpError } from "./auth";
import { validDay } from "../src/model";
const aliases: Record<string, string[]> = {
  occurredAt: [
    "交易时间",
    "日期",
    "交易日期",
    "时间",
    "记账日期",
    "操作时间",
    "交易日",
    "交易时间(北京时间)",
    "记账日",
    "transaction time",
    "date",
    "occurredat",
    "trans date",
    "trade date",
  ],
  amount: [
    "金额",
    "金额(元)",
    "支出金额",
    "收入金额",
    "金额（元）",
    "交易金额",
    "交易金额(元)",
    "金额（收入为正,支出为负）",
    "amount",
    "amt",
    "支出/收入",
    "收/支金额",
    "trans amount",
    "trade amount",
  ],
  kindLabel: [
    "收/支",
    "收支",
    "收入/支出",
    "type",
    "direction",
    "交易类型",
    "借贷标志",
    "借贷",
    "收支类型",
    "trans type",
  ],
  merchant: [
    "交易对方",
    "商户名称",
    "对方名称",
    "商品",
    "商品说明",
    "摘要",
    "对方账户名称",
    "对方户名",
    "对手户名",
    "对方账户",
    "merchant",
    "name",
    "payee",
    "交易摘要",
    "用途",
  ],
  note: ["备注", "remark", "note", "memo", "附言", "用途备注"],
  category: ["分类", "交易分类", "category", "支出分类", "类型"],
  accountName: [
    "支付方式",
    "账户",
    "支付账户",
    "card",
    "account",
    "支付方式 / 账户",
    "本方账户",
    "我的账户",
    "卡号",
  ],
};
export function csvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
export function parseBill(
  bytes: Uint8Array,
  template: string,
  configuration: Configuration,
) {
  if (bytes.length > 10_000_000) throw new HttpError(413, "账单不能超过10MB");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("gb18030").decode(bytes);
  }
  text = text.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(
    (l) => /金额|amount/i.test(l) && /时间|日期|date|transaction/i.test(l),
  );
  if (start > 0) text = lines.slice(start).join("\n");
  const sample = text.split("\n")[0] || "";
  const delimiter = ["\t", ",", ";"].sort(
    (a, b) => sample.split(b).length - sample.split(a).length,
  )[0];
  const rows = csvRows(text, delimiter),
    headers = (rows.shift() || []).map((h) =>
      h.trim().replace(/^['"]|['"]$/g, ""),
    );
  const detected_columns = Object.fromEntries(
    Object.entries(aliases).map(([key, options]) => {
      let at = -1;
      for (const option of options) {
        at = headers.findIndex(
          (h) =>
            h.toLowerCase() === option.toLowerCase() ||
            h.toLowerCase().includes(option.toLowerCase()),
        );
        if (at >= 0) break;
      }
      return [key, at >= 0 ? at : null];
    }),
  );
  const warnings: string[] = [];
  const transactions: Record<string, unknown>[] = [];
  if (detected_columns.amount === null)
    return {
      transactions,
      warnings: ["未识别到金额列，请检查表头。"],
      detected_columns,
      headers,
      template,
    };
  for (const [index, row] of rows.entries()) {
    const cell = (key: string) =>
      detected_columns[key] === null
        ? ""
        : String(row[detected_columns[key]!] || "").trim();
    const raw = cell("amount").replace(/[¥￥,\s]/g, ""),
      amount = Math.abs(Number(raw));
    if (!Number.isFinite(amount) || amount === 0) continue;
    const label = cell("kindLabel").toLowerCase();
    const kind = /收入|income|credit|贷|进账|存入|已收/.test(label)
      ? "income"
      : /支出|expense|debit|借|出账|支取|已付/.test(label)
        ? "expense"
        : /转账|transfer|划转/.test(label)
          ? "transfer"
          : raw.startsWith("+")
            ? "income"
            : "expense";
    let occurredAt = cell("occurredAt").replace(/[/.]/g, "-").replace(" ", "T");
    if (/^\d{8}$/.test(occurredAt))
      occurredAt =
        occurredAt.slice(0, 4) +
        "-" +
        occurredAt.slice(4, 6) +
        "-" +
        occurredAt.slice(6, 8);
    if (occurredAt.length === 10) occurredAt += "T00:00";
    if (
      !validDay(occurredAt.slice(0, 10)) ||
      !Number.isFinite(Date.parse(occurredAt + "+08:00"))
    ) {
      warnings.push(`第${index + 2}行日期无效，已跳过。`);
      continue;
    }
    const merchant = cell("merchant"),
      note = cell("note"),
      words = (merchant + " " + note).toLowerCase();
    const category = configuration.categories
      .filter(
        (c) =>
          !c.deletedAt &&
          (!c.direction ||
            c.direction === (kind === "income" ? "收入" : "支出")),
      )
      .map((c) => ({
        c,
        score: (c.keywords || []).reduce(
          (n, w) => n + (w && words.includes(w.toLowerCase()) ? w.length : 0),
          0,
        ),
      }))
      .sort((a, b) => b.score - a.score)[0]?.c;
    const account =
      configuration.accounts.find(
        (a) =>
          !a.deletedAt &&
          (a.name === cell("accountName") ||
            (a.keywords || []).some(
              (w) => w && words.includes(w.toLowerCase()),
            )),
      ) || configuration.accounts.find((a) => !a.deletedAt);
    transactions.push({
      title: merchant || "未命名账单",
      amount: Math.round(amount * 100) / 100,
      kind,
      occurredAt,
      merchant,
      note,
      category: category ? { id: category.id, name: category.name } : null,
      accountName: account?.name || "",
      tags: ["导入", template],
      source: "import-" + template,
      sourceName: template,
      reimbursementStatus: "notApplicable",
    });
  }
  return { transactions, warnings, detected_columns, headers, template };
}
