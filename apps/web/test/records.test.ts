/**
 * [INPUT]: 编辑字段规则、账目计算与受控 RPC 客户端。
 * [OUTPUT]: 时间精度、负数金额、扣减和冲突回执的验收证据。
 * [POS]: 人工编辑边界测试；不连接生产或发送消息。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  amountInput,
  decimalCents,
  shanghaiInput,
  shanghaiInstant,
  type RecordDetail,
} from "../src/record-model";
import { initialValues, changedPatch } from "../src/record-fields";
import { netMinutes, coverage, type TimeEntry } from "../src/model";
import { editRecord } from "../worker/records";
const id = "11111111-1111-4111-8111-111111111111";
function detail(): RecordDetail {
  return {
    record: {
      id,
      kind: "money",
      event_at: "2026-07-21T03:21:36.386015Z",
      title: "历史",
      source: "local-lifeos",
      data: {
        id,
        revision: 1,
        occurred_at: "2026-07-21T03:21:36.386015Z",
        title: "历史",
        direction: "expense",
        amount_cents: -1234,
        currency: "CNY",
        category_id: 1,
        account: "账户",
        merchant: null,
        note: "原备注",
      },
    },
    categories: [],
    choices: [],
    changes: [],
    changesMore: false,
    source: null,
    attachments: [],
  };
}
test("金额输入保留负数、零和大整数，拒绝浮点模糊与超过两位小数", () => {
  assert.equal(decimalCents("-12.34"), -1234);
  assert.equal(decimalCents("0"), 0);
  assert.equal(amountInput(-50), "-0.50");
  assert.equal(amountInput(0), "0.00");
  assert.equal(decimalCents("90071992547409.91"), Number.MAX_SAFE_INTEGER);
  for (const value of ["1e3", "0.001", "NaN", "90071992547409.92"])
    assert.throws(() => decimalCents(value));
});
test("备注修改不重写原有时间、金额、来源或隐藏字段", () => {
  const data = detail(),
    initial = initialValues(data);
  assert.equal(initial.occurred_at, "2026-07-21T11:21:36");
  const patch = changedPatch(data, initial, { ...initial, note: "人工备注" });
  assert.deepEqual(patch, { note: "人工备注" });
  assert.deepEqual(
    changedPatch(data, initial, { ...initial, amount_cents: "-0.50" }),
    { amount_cents: -50 },
  );
});
test("上海墙钟转换不跟随浏览器时区，非法日期被拒绝", () => {
  assert.equal(shanghaiInput("2026-07-21T01:00:00Z"), "2026-07-21T09:00:00");
  assert.equal(shanghaiInstant("2026-07-21T09:00"), "2026-07-21T01:00:00.000Z");
  assert.throws(() => shanghaiInstant("2026-02-30T09:00"));
});
test("跨日扣减按半偶数分摊，覆盖率仍按毛区间，进行中使用快照", () => {
  const entry: TimeEntry = {
    id,
    start_at: "2026-07-21T23:30:00+08:00",
    end_at: "2026-07-22T00:30:00+08:00",
    deduction_minutes: 1,
    category_id: 1,
    activity: "工作",
    note: null,
  };
  assert.equal(netMinutes(entry, "2026-07-21"), 30);
  assert.equal(netMinutes(entry, "2026-07-22"), 29);
  assert.equal(
    coverage([entry], "2026-07-22", Date.parse("2026-07-22T01:00+08:00"))
      .recorded,
    30,
  );
  assert.equal(
    netMinutes(
      {
        ...entry,
        start_at: "2026-07-22T00:00+08:00",
        end_at: null,
        deduction_minutes: 0,
      },
      "2026-07-22",
      Date.parse("2026-07-22T01:00+08:00"),
    ),
    60,
  );
});
test("编辑只调用受限 RPC，拒绝未知字段；版本冲突返回409", async () => {
  let calls = 0;
  let args: unknown;
  const client = {
    rpc: async (name: string, input: unknown) => {
      calls++;
      assert.equal(name, "edit_record");
      args = input;
      return { data: { revision: 2 }, error: null };
    },
  } as unknown as SupabaseClient;
  assert.deepEqual(
    await editRecord(client, {
      kind: "money",
      id,
      revision: 1,
      patch: { amount_cents: -50 },
    }),
    { revision: 2 },
  );
  assert.deepEqual(args, {
    p_kind: "money",
    p_id: id,
    p_revision: 1,
    p_patch: { amount_cents: -50 },
  });
  await assert.rejects(
    editRecord(client, {
      kind: "money",
      id,
      revision: 1,
      patch: { owner_id: id },
    }),
  );
  assert.equal(calls, 1);
  const conflict = {
    rpc: async () => ({
      data: null,
      error: { code: "40001", message: "private details" },
    }),
  } as unknown as SupabaseClient;
  await assert.rejects(
    editRecord(conflict, {
      kind: "time",
      id,
      revision: 1,
      patch: { activity: "修改" },
    }),
    { status: 409, message: "这条记录已被更新，请重新载入后再保存" },
  );
});
