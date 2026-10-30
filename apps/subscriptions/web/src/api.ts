/**
 * [INPUT]: 依赖LifeOS本人AAL2代理或本机回环REST，依赖types返回形状
 * [OUTPUT]: 提供双模式订阅、通用余额与幂等充值等 /v1 动作；写成功广播 subos:changed
 * [POS]: web 的唯一网络出口，页面不直接 fetch。边栏靠这条广播刷新分类
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { announceChange } from "./lib/refresh";
import {isVisitor,visitorRequest} from './visitor';
import type {
  Account,
  BankCard,
  CardAiStatus,
  CardArtSearchResult,
  CardCoverResult,
  CardIdentifyResult,
  Category,
  PaymentMethod,
  ReminderPack,
  Subscription,
  Summary,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if(isVisitor())return visitorRequest<T>(path,init);
  const base=new URL(document.baseURI);
  const local=base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname);
  const response = await fetch(local?path:"/api/subscriptions/request", {
    ...(local?init:{}),
    method:local?(init?.method??"GET"):"POST",credentials:"same-origin",cache:"no-store",
    headers:{"Content-Type":"application/json",...(local?init?.headers??{}:{})},
    body:local?init?.body:JSON.stringify({method:(init?.method??"GET").toUpperCase(),path,
      body:typeof init?.body==='string'?JSON.parse(init.body):undefined}),
  });
  if(response.status===401)window.parent.postMessage({type:"subscriptions-session-expired"},base.origin);
  let data: T & { error?: string };
  try {
    data = (await response.json()) as T & { error?: string };
  } catch {
    throw new Error(`请求失败（${response.status}）`);
  }
  if (!response.ok) {
    throw new Error(data.error || `请求失败（${response.status}）`);
  }
  const method = (init?.method ?? "GET").toUpperCase();
  const isReadLikePost =
    path === "/v1/card-identify" ||
    path === "/v1/card-cover/search" ||
    path === "/v1/card-cover/resolve" ||
    path === "/v1/card-cover/ai-key" ||
    path === "/v1/card-cover/ai-generate";
  if (method !== "GET" && !path.startsWith("/v1/reminders/") && !isReadLikePost) {
    announceChange();
  }
  // 仅改写服务端生成的图片地址，不改写正文、账号或网站字段。
  const rewrite = (value: unknown): void => {
    if(!value || typeof value!=="object")return;
    for(const [key,item] of Object.entries(value)){
      if((key==="logo_src"||key==="cover_src") && typeof item==="string" && /^\/(?:icons|card-covers)\//.test(item)){
        (value as Record<string,unknown>)[key]="/api/subscriptions"+item;
      }else if(typeof item==="object")rewrite(item);
    }
  };
  if(!local)rewrite(data);
  return data;
}

export const api = {
  resolveLogo: (website: string, logoUrl = "") => {
    const query = new URLSearchParams({ website, logo_url: logoUrl });
    return request<{ logo_src: string }>(`/v1/logo?${query.toString()}`);
  },
  summary: () => request<Summary>("/v1/summary"),
  reminders: () => request<ReminderPack>("/v1/reminders"),
  claimReminders: () => request<ReminderPack>("/v1/reminders/claim", { method: "POST", body: "{}" }),
  releaseReminders: (items: ReminderPack["due"]) => request("/v1/reminders/release", { method: "POST", body: JSON.stringify({ items }) }),
  ackReminders: (
    items: Array<{ id: string; wave: 7 | 3 | 1; next_renewal_on: string; delivery_token?: string }>,
  ) =>
    request<{ ok: boolean; accepted: number }>("/v1/reminders/ack", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),
  listSubscriptions: () => request<{ items: Subscription[] }>("/v1/subscriptions"),
  getSubscription: (id: string) => request<Subscription>(`/v1/subscriptions/${id}`),
  setBalance: (id: string, balanceYuan: string) =>
    request<Subscription>(`/v1/subscriptions/${id}/balance`, {
      method: "POST", body: JSON.stringify({ balance_yuan: balanceYuan }),
    }),
  topUpBalance: (id: string, amountYuan: string, requestId: string) =>
    request<Subscription>(`/v1/subscriptions/${id}/top-up`, {
      method: "POST", body: JSON.stringify({ amount_yuan: amountYuan, request_id: requestId }),
    }),
  createSubscription: (body: unknown) =>
    request<Subscription>("/v1/subscriptions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateSubscription: (id: string, body: unknown) =>
    request<Subscription>(`/v1/subscriptions/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteSubscription: (id: string) =>
    request<{ ok: boolean }>(`/v1/subscriptions/${id}`, { method: "DELETE" }),
  reorderSubscriptions: (categoryId: string, ids: string[]) =>
    request<{ ok: boolean; ids: string[] }>("/v1/subscriptions/reorder", {
      method: "PUT",
      body: JSON.stringify({ category_id: categoryId, ids }),
    }),
  confirmRenewal: (id: string) =>
    request<Subscription>(`/v1/subscriptions/${id}/confirm-renewal`, {
      method: "POST",
      body: "{}",
    }),
  /** 暂停：keepRemaining 为 false 就是服务生效途中退订，剩余期限作废 */
  pauseSubscription: (id: string, keepRemaining: boolean) =>
    request<Subscription>(`/v1/subscriptions/${id}/pause`, {
      method: "POST",
      body: JSON.stringify({ keep_remaining: keepRemaining }),
    }),
  resumeSubscription: (id: string) =>
    request<Subscription>(`/v1/subscriptions/${id}/resume`, {
      method: "POST",
      body: "{}",
    }),
  listMethods: () => request<{ items: PaymentMethod[] }>("/v1/payment-methods"),
  createMethod: (body: unknown) =>
    request<PaymentMethod>("/v1/payment-methods", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateMethod: (id: string, body: unknown) =>
    request<PaymentMethod>(`/v1/payment-methods/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteMethod: (id: string) =>
    request<{ ok: boolean }>(`/v1/payment-methods/${id}`, { method: "DELETE" }),
  listCards: () => request<{ items: BankCard[] }>("/v1/cards"),
  getCard: (id: string) => request<BankCard>(`/v1/cards/${id}`),
  createCard: (body: unknown) =>
    request<BankCard>("/v1/cards", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateCard: (id: string, body: unknown) =>
    request<BankCard>(`/v1/cards/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteCard: (id: string) =>
    request<{ ok: boolean }>(`/v1/cards/${id}`, { method: "DELETE" }),
  identifyCard: (iin: string) =>
    request<CardIdentifyResult>("/v1/card-identify", {
      method: "POST",
      body: JSON.stringify({ iin }),
    }),
  searchCardCovers: (body: {
    issuer: string;
    product: string;
    network: string;
    keywords: string;
    issuer_website: string;
  }) =>
    request<CardArtSearchResult>("/v1/card-cover/search", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  resolveCardCover: (sourceUrl: string) =>
    request<CardCoverResult>("/v1/card-cover/resolve", {
      method: "POST",
      body: JSON.stringify({ source_url: sourceUrl }),
    }),
  cardAiStatus: () => request<CardAiStatus>("/v1/card-cover/ai-status"),
  configureCardAi: (apiKey: string) =>
    request<CardAiStatus>("/v1/card-cover/ai-key", {
      method: "POST",
      body: JSON.stringify({ api_key: apiKey }),
    }),
  generateCardCover: (body: {
    reference_data_url: string;
    issuer: string;
    product: string;
    network: string;
  }) =>
    request<CardCoverResult>("/v1/card-cover/ai-generate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listAccounts: () => request<{ items: Account[] }>("/v1/accounts"),
  createAccount: (body: unknown) =>
    request<Account>("/v1/accounts", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateAccount: (id: string, body: unknown) =>
    request<Account>(`/v1/accounts/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteAccount: (id: string) =>
    request<{ ok: boolean }>(`/v1/accounts/${id}`, { method: "DELETE" }),
  listCategories: () => request<{ items: Category[] }>("/v1/categories"),
  createCategory: (body: unknown) =>
    request<Category>("/v1/categories", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateCategory: (id: string, body: unknown) =>
    request<Category>(`/v1/categories/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteCategory: (id: string) =>
    request<{ ok: boolean }>(`/v1/categories/${id}`, { method: "DELETE" }),
};
