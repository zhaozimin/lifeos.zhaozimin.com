/**
 * [INPUT]: 原版契约适配、时间投影、CSV 预览与 XLSX 导出。
 * [OUTPUT]: 时间精度、跨日扣减、重叠覆盖和文件安全行为验收。
 * [POS]: 原版界面的数据边界；不连接生产数据库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import {
  toSegment,
  toTransaction,
  timeSummary,
  wall,
} from "../worker/native-data";
import { parseBill, csvRows } from "../worker/native-import";
import { xlsx } from "../worker/native-files";
const categories = [
  { id: 1, name: "写作", nature: "core" },
  {
    id: 2,
    name: "饮食",
    direction: "expense",
    metadata: { tintHex: "#123456" },
  },
];
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  revision: 3,
  start_at: "2026-10-24T15:30:00.123456+00:00",
  end_at: "2026-10-24T16:30:00.123456+00:00",
  category_id: 1,
  activity: "写方案",
  deduction_minutes: 11,
};
test("原版时间投影保留UTC锚点、版本与导入来源", () => {
  const s = toSegment({ source: "local-lifeos", data: row }, categories);
  assert.equal(s.startedAt, "2026-10-24T23:30");
  assert.equal(s.startedUtc, row.start_at);
  assert.equal(s.source, "import");
  assert.equal(s.revision, 3);
  assert.equal(s.pureMinutes, 49);
});
test("原版跨日统计按半偶分摊扣减，重叠不重复计算覆盖", () => {
  const s = toSegment(row, categories);
  const summary = timeSummary(
    [s],
    "2026-10-24",
    "2026-10-25",
    new Date("2026-10-25T02:00:00Z"),
  );
  assert.equal(summary.effectiveWorkMinutes, 49);
  assert.equal(summary.days[0].effectiveWorkMinutes, 24);
  const overlap = timeSummary(
    [s, { ...s, id: "second" }],
    "2026-10-24",
    "2026-10-25",
    new Date("2026-10-25T02:00:00Z"),
  );
  assert.equal(overlap.recordedMinutes, summary.recordedMinutes);
});
test("原版流水投影保留负数、转账、附件和税务原值", () => {
  const t = toTransaction(
    {
      id: "tx",
      revision: 2,
      amount_cents: -50,
      direction: "expense",
      occurred_at: "2026-10-24T20:00:00Z",
      category_id: 2,
      details: { tax_category: "personal", reimbursement_status: "submitted" },
    },
    categories,
    [
      {
        id: "file",
        transaction_id: "tx",
        filename: "凭证.jpg",
        size_bytes: 1,
        mime: "image/jpeg",
      },
    ],
  );
  assert.equal(t.amount, -0.5);
  assert.equal(t.occurredAt, "2026-10-25T04:00");
  assert.equal(t.reimbursementStatus, "submitted");
  assert.equal(t.attachments?.[0].originalName, "凭证.jpg");
});
test("CSV识别带引号分隔符和多行备注，预览不伪造非法日期", () => {
  assert.deepEqual(csvRows('a,b\r\n"x,y","备注\n第二行"', ","), [
    ["a", "b"],
    ["x,y", "备注\n第二行"],
  ]);
  const config = {
    categories: [
      { id: "2", name: "饮食", direction: "支出", keywords: ["午饭"] },
    ],
    accounts: [{ name: "生活账户" }],
    settings: {},
  } as any;
  const preview = parseBill(
    new TextEncoder().encode(
      "交易时间,金额,收支,商品,备注\n2026-10-25 12:30:00,38,支出,午饭,测试\n无效日期,20,支出,午饭,不应入库",
    ),
    "generic",
    config,
  );
  assert.equal(preview.transactions.length, 1);
  assert.equal((preview.transactions[0].category as any)?.id, "2");
  assert.equal(preview.transactions[0].occurredAt, "2026-10-25T12:30:00");
  assert.equal(preview.warnings.length, 1);
});
test("XLSX将公式样式文本固定为字符串，并转义XML字符", () => {
  const bytes = xlsx([
    {
      name: "流水",
      rows: [
        ["标题", "金额"],
        ['=HYPERLINK("https://x")', 38],
        ["<script>&", -0.5],
      ],
    },
  ]);
  const xml = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]);
  assert.ok(xml.includes('t="inlineStr"'));
  assert.ok(!xml.includes("<f>"));
  assert.ok(xml.includes("&lt;script&gt;&amp;"));
  assert.ok(xml.includes("<v>-0.5</v>"));
});

test("原版编辑只写用户改动，保留微秒锚点和非转账账户端点", async () => {
  const { saveTime, saveMoney } = await import("../worker/native");
  const calls: any[] = [];
  const money = {
    id: row.id,
    revision: 3,
    occurred_at: "2026-10-24T12:00:00.123456Z",
    amount_cents: 29900,
    direction: "expense",
    currency: "CNY",
    category_id: 2,
    account: "经营账户",
    from_account: null,
    to_account: null,
    note: "原备注",
    title: "模板",
    tags: [],
    details: {},
    deleted_at: null,
  };
  const source: any = {
    time_entries: [{ ...row, raw_inputs: { source: "wechat" } }],
    v_records: [{ data: money, source: "local-lifeos" }],
    categories,
    local_records: [],
    record_attachments: [],
  };
  const client: any = {
    from: (table: string) => {
      const q: any = {};
      for (const key of ["select", "eq", "in", "is", "order", "lt", "or"])
        q[key] = () => q;
      q.range = async () => ({ data: source[table] || [], error: null });
      q.maybeSingle = async () => ({
        data: { data: {}, revision: 1 },
        error: null,
      });
      return q;
    },
    rpc: async (name: string, args: any) => {
      calls.push(args);
      return {
        data: { ...(args.p_kind === "time" ? row : money), ...args.p_data },
        error: null,
      };
    },
  };
  await saveTime(client, "PUT", row.id, {
    revision: 3,
    title: "写方案",
    startedAt: "2026-10-24T23:30",
    endedAt: "2026-10-25T00:30",
    note: "新备注",
  });
  assert.deepEqual(calls[0].p_data, { note: "新备注" });
  await saveMoney(client, "PUT", row.id, {
    revision: 3,
    kind: "expense",
    amount: 299,
    accountName: "经营账户",
    fromAccountName: "经营账户",
    toAccountName: null,
    note: "新备注",
  });
  assert.deepEqual(calls[1].p_data, { note: "新备注" });
});
