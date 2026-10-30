/**
 * [INPUT]: 依赖 CardPhotoGenerator 的本地脱敏 AI 生成、api 的瞬时公开卡面搜索与安全封面解析，接收编辑器中的发卡行、产品、卡组织、官网提示和当前封面
 * [OUTPUT]: 对外提供照片自动重绘、识别后自动搜索、关键词补充、候选核对、点选后单图缓存与官网 URL 兜底界面
 * [POS]: components 的卡面来源编排边界。优先走原图不离开浏览器的脱敏 AI 流；公开搜索候选不落库，只有最终选中的单图缓存；不接收银行卡号
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useState } from "react";
import { useAsyncScope } from "../lib/asyncScope";
import { api } from "../api";
import type { CardArtCandidate, CardCoverResult, CardNetwork } from "../types";
import { CardPhotoGenerator } from "./CardPhotoGenerator";

export function CardCoverPicker({
  issuer,
  product,
  network,
  issuerWebsite,
  autoSearchVersion,
  coverKey,
  coverSrc,
  coverSourceUrl,
  onSourceUrlChange,
  onResolved,
  onClear,
  onError,
  onBusyChange,
}: {
  issuer: string;
  product: string;
  network: CardNetwork;
  issuerWebsite: string;
  autoSearchVersion: number;
  coverKey: string;
  coverSrc: string;
  coverSourceUrl: string;
  onSourceUrlChange: (value: string) => void;
  onResolved: (cover: CardCoverResult) => void;
  onClear: () => void;
  onError: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [keywords, setKeywords] = useState("");
  const [candidates, setCandidates] = useState<CardArtCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolvingUrl, setResolvingUrl] = useState("");
  const [note, setNote] = useState("");
  const scope = useAsyncScope();
  const [photoBusy, setPhotoBusy] = useState(false);
  const working = photoBusy || searching || Boolean(resolvingUrl);
  useEffect(() => { onBusyChange(working); }, [working, onBusyChange]);
  const publicSourceUrl = coverSourceUrl.startsWith("https://api.openai.com/") ? "" : coverSourceUrl;

  async function search() {
    const current = scope.begin("search");
    if (!issuer.trim() && !product.trim() && !keywords.trim()) {
      onError("请先填写发卡行、卡片名称或卡面关键词");
      return;
    }
    setSearching(true);
    onError("");
    try {
      const result = await api.searchCardCovers({
        issuer,
        product,
        network,
        keywords,
        issuer_website: issuerWebsite,
      });
      if (!current()) return;
      setCandidates(result.items);
      setNote(`${result.notice} · 来源：${result.provider_label}`);
    } catch (error) {
      if (!current()) return;
      setCandidates([]);
      setNote("");
      onError(error instanceof Error ? error.message : "卡面搜索失败");
    } finally {
      if (current()) setSearching(false);
    }
  }

  useEffect(() => {
    if (autoSearchVersion > 0) void search();
    // autoSearchVersion 是一次明确的识别完成事件；字段值随同一批渲染进入这里。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSearchVersion]);

  async function resolve(sourceUrl: string) {
    const current = scope.begin("cover");
    if (!sourceUrl.trim()) {
      onError("请先选择候选卡面，或粘贴官方卡片页 / 图片地址");
      return;
    }
    setResolvingUrl(sourceUrl);
    onError("");
    try {
      const cover = await api.resolveCardCover(sourceUrl);
      if (current()) onResolved(cover);
    } catch (error) {
      if (current()) onError(error instanceof Error ? error.message : "无法读取卡面");
    } finally {
      if (current()) setResolvingUrl("");
    }
  }

  return (
    <section className="card-cover-editor" aria-labelledby="card-cover-title">
      <div className="card-cover-editor-head">
        <div>
          <h3 id="card-cover-title">卡片封面（可空）</h3>
          <p>可从实物照片自动重绘，也可检索公开卡面。</p>
        </div>
        <button type="button" className="text-action" disabled={searching} onClick={() => void search()}>
          {searching ? "搜索中…" : "搜索候选卡面"}
        </button>
      </div>

      <CardPhotoGenerator
        issuer={issuer}
        product={product}
        network={network}
        onResolved={onResolved}
        onError={onError}
        onBusyChange={setPhotoBusy}
        disabled={Boolean(resolvingUrl) || photoBusy}
      />

      <div className="card-cover-divider" aria-hidden="true">
        <span>或检索公开卡面</span>
      </div>

      <label className="block mt-3">
        <span className="field-label">补充关键词（可空）</span>
        <input
          className="field"
          value={keywords}
          onChange={(event) => setKeywords(event.target.value)}
          placeholder="例如：经典白、白金、Visa Signature"
        />
      </label>

      {note ? <p className="caption card-cover-search-note">{note}</p> : null}
      {candidates.length ? (
        <div className="card-cover-candidates" aria-label="卡面搜索候选">
          {candidates.map((candidate) => (
            <button
              type="button"
              className="card-cover-candidate"
              key={candidate.id}
              disabled={Boolean(resolvingUrl) || photoBusy}
              onClick={() => void resolve(candidate.image_url)}
              title={`选择 ${candidate.title}`}
            >
              <span className="card-cover-candidate-image">
                <img
                  src={candidate.thumbnail_url}
                  alt={candidate.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
                {candidate.official ? <strong>官网来源</strong> : null}
                {resolvingUrl === candidate.image_url ? <em>缓存中…</em> : null}
              </span>
              <span className="card-cover-candidate-meta">
                <b>{candidate.title}</b>
                <small>{candidate.source_host || "图片来源未知"}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <details className="card-cover-advanced mt-3">
        <summary>没有找到？使用官网卡片页或图片地址</summary>
        <label className="block mt-3">
          <span className="field-label">HTTPS 地址</span>
          <input
            className="field"
            type="url"
            inputMode="url"
            autoComplete="off"
            disabled={working}
            value={publicSourceUrl}
            onChange={(event) => onSourceUrlChange(event.target.value)}
            placeholder="https://bank.example/cards/..."
          />
        </label>
        <div className="card-cover-actions mt-3">
          <button
            type="button"
            className="btn"
            disabled={Boolean(resolvingUrl) || photoBusy}
            onClick={() => void resolve(publicSourceUrl)}
          >
            {resolvingUrl === publicSourceUrl && resolvingUrl ? "正在读取…" : "读取并缓存"}
          </button>
        </div>
      </details>

      {coverSrc ? (
        <div className="card-cover-preview mt-3">
          <img src={coverSrc} alt="待保存的银行卡卡面" />
          <div>
            <p>已缓存到本机。保存银行卡后生效。</p>
            {coverKey ? (
              <button type="button" className="text-action" disabled={working} onClick={() => { scope.invalidate(); onClear(); }}>
                移除卡面
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="caption mt-3">
        搜索只发送发卡行、卡片名称、卡组织与补充关键词，不发送卡号。候选可能来自非官网，请以卡片实物核对版本。
      </p>
    </section>
  );
}
