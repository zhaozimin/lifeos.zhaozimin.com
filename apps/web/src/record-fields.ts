/**
 * [INPUT]: 记录详情、字段草稿及原始初值。
 * [OUTPUT]: 按类型的编辑字段和仅包含实际变化的补丁。
 * [POS]: 编辑表单规则；未修改的时间保留原始秒与微秒。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  amountInput,
  decimalCents,
  shanghaiInput,
  shanghaiInstant,
  type RecordDetail,
} from "./record-model";
export interface Field {
  key: string;
  label: string;
  type?: string;
  options?: Array<[string, string]>;
  help?: string;
}
export const FIELD_NAMES: Record<string, string> = {
  activity: "活动",
  title: "标题",
  name: "名称",
  start_at: "开始时间",
  end_at: "结束时间",
  category_id: "分类",
  deduction_minutes: "扣减分钟",
  deduction_note: "扣减原因",
  project: "项目",
  tags: "标签",
  note: "备注",
  occurred_at: "发生时间",
  direction: "收支类型",
  amount_cents: "金额",
  currency: "币种",
  account: "账户或支付方式",
  from_account: "转出账户",
  to_account: "转入账户",
  merchant: "商户",
  openingBalance: "期初余额",
  task_date: "计划日期",
  start_time: "开始时刻",
  end_time: "结束时刻",
  status: "任务状态",
  group_id: "所属任务组",
};
export function fieldsFor(
  detail: RecordDetail,
  values: Record<string, string>,
): Field[] {
  const { kind } = detail.record;
  const common = ["project", "tags", "note"];
  let keys: string[] = [];
  if (kind === "time")
    keys = [
      "activity",
      "category_id",
      "start_at",
      "end_at",
      "deduction_minutes",
      "deduction_note",
      ...common,
    ];
  if (kind === "money")
    keys = [
      "title",
      "occurred_at",
      "direction",
      "amount_cents",
      "currency",
      "category_id",
      ...(values.direction === "transfer"
        ? ["from_account", "to_account"]
        : ["account"]),
      "merchant",
      ...common,
    ];
  if (kind === "account") keys = ["name", "openingBalance", "note"];
  if (kind === "task")
    keys = [
      "title",
      "status",
      "task_date",
      "start_time",
      "end_time",
      "group_id",
      "note",
    ];
  if (kind === "task_group") keys = ["title", "note"];
  if (kind === "project") keys = ["name", "note"];
  return keys.map((key) => {
    const field: Field = {
      key,
      label: FIELD_NAMES[key],
      type: ["note", "deduction_note"].includes(key) ? "textarea" : "text",
    };
    if (["start_at", "end_at", "occurred_at"].includes(key))
      field.type = "datetime-local";
    if (key === "task_date") field.type = "date";
    if (["start_time", "end_time"].includes(key)) field.type = "time";
    if (key === "deduction_minutes") field.type = "number";
    if (key === "category_id") {
      field.type = "select";
      const current = Number(values.category_id);
      field.options = detail.categories
        .filter(
          (c) =>
            c.kind === (kind === "time" ? "time" : "money") &&
            (c.id === current || c.is_active !== false) &&
            (kind === "time" ||
              c.direction === null ||
              c.direction === values.direction),
        )
        .map((c) => [
          String(c.id),
          c.name + (c.is_active === false ? "（历史）" : ""),
        ]);
      if (values.direction === "transfer")
        field.options = detail.categories
          .filter((c) => c.kind === "money" && c.direction === null)
          .map((c) => [String(c.id), c.name]);
    }
    if (key === "direction") {
      field.type = "select";
      field.options = [
        ["expense", "支出"],
        ["income", "收入"],
        ["transfer", "转账"],
      ];
    }
    if (key === "status") {
      field.type = "select";
      field.options = [
        ["pending", "待完成"],
        ["completed", "已完成"],
      ];
    }
    if (key === "group_id") {
      field.type = "select";
      field.options = [
        ["", "无分组"],
        ...detail.choices
          .filter((x) => x.kind === "task_group")
          .map((x) => [x.source_id, String(x.data.title)] as [string, string]),
      ];
    }
    if (key === "end_at") field.help = "留空表示进行中。";
    if (key === "amount_cents")
      field.help = "保留负数冲减和零金额；最多两位小数。";
    if (key === "openingBalance") field.help = "这是期初余额，不是当前余额。";
    if (key === "tags") field.help = "使用逗号分隔。";
    if (key === "task_date")
      field.help = "排期三项一起填写；全部留空表示未排期。";
    return field;
  });
}
export function initialValues(detail: RecordDetail): Record<string, string> {
  const outer = detail.record.data as unknown as Record<string, unknown>;
  const row = (
    ["time", "money"].includes(detail.record.kind) ? outer : outer.data
  ) as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(row))
    values[key] =
      value == null
        ? ""
        : Array.isArray(value)
          ? value.join(", ")
          : String(value);
  for (const key of ["start_at", "end_at", "occurred_at"])
    if (key in row) values[key] = shanghaiInput(row[key] as string | null);
  if ("amount_cents" in row)
    values.amount_cents = amountInput(row.amount_cents as number);
  return values;
}
export function changedPatch(
  detail: RecordDetail,
  initial: Record<string, string>,
  values: Record<string, string>,
) {
  const patch: Record<string, unknown> = {};
  for (const { key } of fieldsFor(detail, values)) {
    const value = values[key] ?? "";
    if (value === (initial[key] ?? "")) continue;
    if (["start_at", "end_at", "occurred_at"].includes(key))
      patch[key] = value ? shanghaiInstant(value) : null;
    else if (key === "amount_cents") patch[key] = decimalCents(value);
    else if (key === "openingBalance") patch[key] = decimalCents(value) / 100;
    else if (["deduction_minutes", "category_id"].includes(key)) {
      if (!/^\d+$/.test(value))
        throw new Error(`${FIELD_NAMES[key]}请填写整数`);
      patch[key] = Number(value);
    } else if (key === "tags")
      patch[key] = value
        .split(/[,，]/)
        .map((x) => x.trim())
        .filter(Boolean);
    else patch[key] = value || null;
  }
  return patch;
}
