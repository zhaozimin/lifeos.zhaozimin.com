/**
 * [INPUT]: 本人会话、附件、CSV 预览和原版导出请求。
 * [OUTPUT]: 私有下载、两步导入及无公式 XLSX 文件。
 * [POS]: 原版文件交互适配；预览不写账，导入仅经事务 RPC。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { zipSync, strToU8 } from "fflate";
import { HttpError } from "./auth";
import { databaseError } from "./records";
import { nativeFinance, type Row, wall } from "./native-data";
import { parseBill } from "./native-import";
async function call(client: SupabaseClient, name: string, args: Row) {
  const { data, error } = await client.rpc(name, args);
  if (error) databaseError(error);
  return data;
}
function base64(bytes: Uint8Array) {
  let result = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    result += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(result);
}
function xml(value: unknown) {
  return String(value ?? "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
export function xlsx(sheets: Array<{ name: string; rows: unknown[][] }>) {
  const files: Record<string, Uint8Array> = {};
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  files["[Content_Types].xml"] = strToU8(
    declaration +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("") +
      "</Types>",
  );
  files["_rels/.rels"] = strToU8(
    declaration +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  files["xl/workbook.xml"] = strToU8(
    declaration +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets
        .map(
          (s, i) =>
            `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join("") +
      "</sheets></workbook>",
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    declaration +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("") +
      "</Relationships>",
  );
  for (const [i, s] of sheets.entries())
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(
      declaration +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        s.rows
          .map(
            (row, n) =>
              `<row r="${n + 1}">` +
              row
                .map((value) =>
                  typeof value === "number" && Number.isFinite(value)
                    ? `<c><v>${value}</v></c>`
                    : `<c t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`,
                )
                .join("") +
              "</row>",
          )
          .join("") +
        "</sheetData></worksheet>",
    );
  return zipSync(files, { level: 6 });
}
export async function nativeFiles(
  client: SupabaseClient,
  {
    method,
    path,
    params,
    body,
  }: { method: string; path: string; params: Row; body: Row },
): Promise<unknown> {
  const file = /^\/v1\/fin\/attachments\/([0-9a-f-]{36})$/.exec(path);
  if (file && method === "GET")
    return call(client, "read_attachment", { p_id: file[1] });
  if (file && method === "DELETE") {
    await call(client, "dashboard_attachment", {
      p_action: "delete",
      p_id: file[1],
      p_transaction: null,
      p_data: {},
    });
    return { ok: true, id: file[1] };
  }
  const upload = /^\/v1\/fin\/transactions\/([0-9a-f-]{36})\/attachments$/.exec(
    path,
  );
  if (upload && method === "POST") {
    const data = z
      .object({
        filename: z.string().min(1).max(500),
        mime: z.string().max(120),
        data: z.string().max(14_000_000),
      })
      .strict()
      .parse(body);
    if (!/^(image\/(jpeg|png|gif|webp)|application\/pdf)$/.test(data.mime))
      data.mime = "application/octet-stream";
    const r = await call(client, "dashboard_attachment", {
      p_action: "create",
      p_id: crypto.randomUUID(),
      p_transaction: upload[1],
      p_data: data,
    });
    return {
      id: r.id,
      mime: r.mime,
      sizeBytes: r.size_bytes,
      originalName: r.filename,
      createdAt: new Date().toISOString(),
    };
  }
  if (method === "POST" && path === "/v1/fin/import/preview") {
    const content = z.string().max(14_000_000).parse(body.content);
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
    } catch {
      throw new HttpError(400, "账单文件编码无效");
    }
    const { configuration } = await nativeFinance(client);
    return parseBill(bytes, String(body.template || "generic"), configuration);
  }
  if (method === "POST" && path === "/v1/fin/import/commit") {
    const input = z
      .object({
        transactions: z
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .max(5000),
        requestId: z.uuid(),
      })
      .parse(body);
    const { configuration, categories } = await nativeFinance(client);
    const items = input.transactions.map((t) => {
      const category =
        categories.find(
          (c) => String(c.id) === String((t.category as Row)?.id),
        ) || categories.find((c) => c.code === "uncategorized");
      const value = Number(t.amount);
      if (!Number.isFinite(value) || Math.round(value * 100) / 100 !== value)
        throw new HttpError(400, "导入金额必须精确到分");
      const occurred = String(t.occurredAt || "");
      const stamp = /([zZ]|[+-]\d\d:\d\d)$/.test(occurred)
        ? occurred
        : occurred + "+08:00";
      if (!Number.isFinite(Date.parse(stamp)))
        throw new HttpError(400, "导入日期无效");
      return {
        title: t.title,
        occurred_at: new Date(stamp).toISOString(),
        direction: t.kind,
        amount_cents: Math.round(value * 100),
        currency: "CNY",
        category_id: category?.id,
        account: t.accountName || configuration.accounts[0]?.name,
        note: t.note,
        merchant: t.merchant,
        tags: t.tags || [],
        details: {
          source: t.source || "import",
          reimbursement_status: t.reimbursementStatus || "notApplicable",
        },
      };
    });
    return call(client, "dashboard_import", {
      p_batch: input.requestId,
      p_items: items,
    });
  }
  if (
    method === "GET" &&
    ["/v1/fin/export/xlsx", "/v1/fin/export/tax-report"].includes(path)
  ) {
    const { transactions, configuration } = await nativeFinance(client);
    const year = Number(params.year || new Date().getFullYear()),
      quarter = params.quarter ? Number(params.quarter) : null;
    const tx = transactions.filter(
      (t) =>
        (!params.from || t.occurredAt.slice(0, 10) >= params.from) &&
        (!params.to || t.occurredAt.slice(0, 10) <= params.to) &&
        (path.endsWith("/xlsx") ||
          (t.occurredAt.startsWith(String(year)) &&
            (!quarter ||
              Math.ceil(Number(t.occurredAt.slice(5, 7)) / 3) === quarter))),
    );
    const detail = [
      [
        "日期",
        "标题",
        "方向",
        "金额",
        "币种",
        "分类",
        "账户",
        "转出账户",
        "转入账户",
        "商户",
        "项目",
        "备注",
        "税务类别",
        "已开票",
      ],
      ...tx.map((t) => [
        t.occurredAt,
        t.title,
        t.kind,
        t.amount,
        t.currency,
        t.category.name,
        t.accountName,
        t.fromAccountName,
        t.toAccountName,
        t.merchant,
        t.projectName,
        t.note,
        t.taxCategory,
        t.invoiceIssued ? "是" : "否",
      ]),
    ];
    const month = new Map<string, { income: number; expense: number }>();
    for (const t of tx) {
      const key = t.occurredAt.slice(0, 7) + " " + t.currency;
      const m = month.get(key) || { income: 0, expense: 0 };
      if (t.kind === "income") m.income += Math.round(t.amount * 100);
      if (t.kind === "expense") m.expense += Math.round(t.amount * 100);
      month.set(key, m);
    }
    const sheets = [
      { name: "流水明细", rows: detail },
      {
        name: "月度汇总",
        rows: [
          ["月份与币种", "收入", "支出", "净额"],
          ...[...month.entries()].map(([key, m]) => [
            key,
            m.income / 100,
            m.expense / 100,
            (m.income - m.expense) / 100,
          ]),
        ],
      },
      {
        name: "账户余额",
        rows: [
          ["账户", "币种", "期初余额", "当前余额"],
          ...configuration.accounts
            .filter((a) => !a.deletedAt)
            .map((a) => [
              a.name,
              a.currency,
              a.openingBalance,
              a.currentBalance,
            ]),
        ],
      },
    ];
    if (path.endsWith("tax-report"))
      sheets.push({
        name: "税务参数",
        rows: [
          ["参数", "值"],
          ...Object.entries(configuration.settings.taxConfig || {}),
        ],
      });
    return {
      base64: base64(xlsx(sheets)),
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: path.endsWith("tax-report")
        ? `tax-report-${year}.xlsx`
        : "lifeos-finance.xlsx",
    };
  }
  if (method === "POST" && path === "/v1/fin/reimbursements/settle")
    return call(client, "dashboard_settle", {
      p_income: z.uuid().parse(body.incomeId),
      p_settle: body.settle || [],
      p_unsettle: body.unsettle || [],
    });
  return undefined;
}
