/**
 * [INPUT]: 依赖 /v1 JSON 契约，字段与 server/store 水合结果同构
 * [OUTPUT]: 提供双模式订阅、余额、支付方式、银行卡、卡面、账号与汇总类型
 * [POS]: web 的数据形状唯一入口，页面禁止再声明一份平行接口
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export type Cycle = "monthly" | "quarterly" | "yearly" | "custom";
export type BillingMode = "balance" | "auto_charge";
export type Status = "active" | "paused" | "cancelled" | "expired";
export type Urgency = "ok" | "soon" | "today" | "overdue";
export type Subscription = {
  id: string;
  name: string;
  website: string;
  amount_fen: number;
  amount_yuan: string;
  currency: string;
  cycle: Cycle;
  cycle_days: number | null;
  next_renewal_on: string;
  auto_renew: boolean;
  billing_mode: BillingMode;
  balance_fen: number | null;
  balance_yuan: string | null;
  balance_stopped: boolean;
  balance_low: boolean;
  balance_cycles: number | null;
  auto_charge_ready: boolean;
  status: Status;
  display_status: Status;
  /** 暂停那天。生效中为空串 */
  paused_on: string;
  /** 暂停时冻结的剩余天数，恢复时原样还回来。0 = 中途退订，剩余作废 */
  paused_days_left: number | null;
  is_phone: boolean;
  phone_balance_fen: number | null;
  phone_balance_yuan: string | null;
  phone_balance_stopped: boolean;
  phone_balance_low: boolean;
  phone_balance_months: number | null;
  payment_method_id: string | null;
  payment_method_name: string | null;
  payment_method_account: string | null;
  account_id: string | null;
  account_label: string | null;
  account_identifier: string | null;
  category_id: string | null;
  category_name: string | null;
  category_sort: number | null;
  logo_url: string;
  logo_src: string;
  remain_ratio: number;
  remind_days: number;
  notes: string;
  days_left: number;
  urgency: Urgency;
  monthly_yuan: string;
  yearly_yuan: string;
  spent_count: number;
  spent_fen: number;
  spent_yuan: string;
  upcoming_yuan: string;
  sort_order: number;
};

export type PaymentMethod = {
  id: string;
  name: string;
  kind: "other" | CardKind;
  card_type: CardType | "";
  account: string;
  status: CardStatus;
  note: string;
};

export type CardKind = "physical_card" | "virtual_card";
export type CardType = "credit" | "debit" | "prepaid";
export type CardStatus = "active" | "frozen" | "closed";
export type CardNetwork =
  | "unionpay"
  | "visa"
  | "mastercard"
  | "amex"
  | "jcb"
  | "discover"
  | "other";

export type BankCard = {
  id: string;
  name: string;
  kind: CardKind;
  issuer: string;
  card_type: CardType;
  network: CardNetwork;
  last4: string;
  currency: string;
  expiry_month: string;
  billing_day: number | null;
  payment_due_day: number | null;
  status: CardStatus;
  cover_key: string;
  cover_src: string;
  cover_source_url: string;
  note: string;
  subscription_count: number;
};

export type CardCoverResult = {
  cover_key: string;
  cover_src: string;
  cover_source_url: string;
};

export type CardAiStatus = {
  available: boolean;
  provider: "openai";
  provider_label: string;
  model: string;
  quality: "low" | "medium" | "high" | "auto";
  privacy: string;
  credential_store: string;
};

export type CardIdentifyResult = {
  issuer: string;
  issuer_website: string;
  network: CardNetwork;
  card_type: CardType | "";
  product: string;
  country: string;
  country_code: string;
  currency: string;
  source: "binlist" | "local";
  notice: string;
};

export type CardArtCandidate = {
  id: string;
  title: string;
  image_url: string;
  thumbnail_url: string;
  source_page_url: string;
  source_host: string;
  official: boolean;
  width: number;
  height: number;
};

export type CardArtSearchResult = {
  items: CardArtCandidate[];
  provider: "brave" | "duckduckgo";
  provider_label: string;
  query: string;
  notice: string;
};

export type Account = {
  id: string;
  label: string;
  identifier: string;
  note: string;
};

export type Category = {
  id: string;
  name: string;
  sort_order: number;
  builtin: boolean;
};

export type CategoryTotal = {
  id: string;
  name: string;
  sort_order: number;
  active_count: number;
  monthly_yuan: string;
};

export type Summary = {
  today: string;
  count: number;
  active_count: number;
  paused_count: number;
  ended_count: number;
  soon_count: number;
  overdue_count: number;
  monthly_yuan: string;
  yearly_yuan: string;
  projected_yuan: string;
  this_month_yuan: string;
  by_category: CategoryTotal[];
  curve: Array<{ month: string; fen: number; yuan: string }>;
};

export type ReminderWave = {
  delivery_token?: string;
  id: string;
  name: string;
  wave: 7 | 3 | 1;
  days_left: number;
  amount_yuan: string;
  next_renewal_on: string;
  website: string;
};

export type ReminderPack = {
  items: Subscription[];
  due: ReminderWave[];
};

export type ApiError = {
  error: string;
};
