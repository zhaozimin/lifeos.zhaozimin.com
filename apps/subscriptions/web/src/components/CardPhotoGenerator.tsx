/**
 * [INPUT]: 依赖浏览器 Canvas 在本地裁切、去元数据并像素化卡片照片，依赖 api 的 AI 状态/钥匙串配置/生成接口，接收当前卡片的非敏感管理字段
 * [OUTPUT]: 对外提供照片选择、脱敏预览与卡面生成；云端密钥由VPS私有配置装载；只把 32×20 像素化 PNG 发给服务端
 * [POS]: components 的卡片照片隐私闸门。原始 File 不进 React 状态、不进 fetch、不进缓存；生成后的无文字底图交还 CardCoverPicker 持久化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useState, type ChangeEvent } from "react";
import { useAsyncScope } from "../lib/asyncScope";
import { api } from "../api";
import type { CardAiStatus, CardCoverResult, CardNetwork } from "../types";
import "../card-photo.css";

const CARD_RATIO = 1.586;
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const PIXEL_WIDTH = 32;
const PIXEL_HEIGHT = 20;

async function privacyReferenceFromFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("请选择 JPG、PNG、WebP 或系统可读取的照片");
  if (file.size > MAX_PHOTO_BYTES) throw new Error("原始照片不能超过 12MB");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("浏览器无法读取这张照片，请先转换成 JPG 或 PNG");
  }

  try {
    const sourceRatio = bitmap.width / bitmap.height;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = bitmap.width;
    let sourceHeight = bitmap.height;
    if (sourceRatio > CARD_RATIO) {
      sourceWidth = bitmap.height * CARD_RATIO;
      sourceX = (bitmap.width - sourceWidth) / 2;
    } else {
      sourceHeight = bitmap.width / CARD_RATIO;
      sourceY = (bitmap.height - sourceHeight) / 2;
    }

    const tiny = document.createElement("canvas");
    tiny.width = PIXEL_WIDTH;
    tiny.height = PIXEL_HEIGHT;
    const tinyContext = tiny.getContext("2d", { alpha: false });
    if (!tinyContext) throw new Error("浏览器无法处理这张照片");
    tinyContext.imageSmoothingEnabled = true;
    tinyContext.imageSmoothingQuality = "high";
    tinyContext.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      PIXEL_WIDTH,
      PIXEL_HEIGHT,
    );

    return tiny.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}

export function CardPhotoGenerator({
  issuer,
  product,
  network,
  onResolved,
  onError,
  onBusyChange,
  disabled = false,
}: {
  issuer: string;
  product: string;
  network: CardNetwork;
  onResolved: (cover: CardCoverResult) => void;
  onError: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const scope = useAsyncScope();
  const [status, setStatus] = useState<CardAiStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [referenceDataUrl, setReferenceDataUrl] = useState("");
  const [photoName, setPhotoName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [configuring, setConfiguring] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [note, setNote] = useState("");

  const working = processing || generating || configuring;
  useEffect(() => { onBusyChange(working); }, [working, onBusyChange]);

  useEffect(() => {
    let active = true;
    api
      .cardAiStatus()
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch((error) => {
        if (active) setStatusError(error instanceof Error ? error.message : "无法读取 AI 状态");
      });
    return () => {
      active = false;
    };
  }, []);

  async function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const current = scope.begin("photo");
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProcessing(true);
    setNote("");
    onError("");
    try {
      const dataUrl = await privacyReferenceFromFile(file);
      if (!current()) return;
      setReferenceDataUrl(dataUrl);
      setPhotoName(file.name);
      setNote("原图已在浏览器中裁切、去元数据并压成 32×20 色块；下面显示的就是 AI 能看到的全部内容。");
      if (status?.available) void generateReference(dataUrl, true);
    } catch (error) {
      if (!current()) return;
      setReferenceDataUrl("");
      setPhotoName("");
      onError(error instanceof Error ? error.message : "无法处理这张照片");
    } finally {
      if (current()) setProcessing(false);
    }
  }

  async function configure() {
    const current = scope.begin("config");
    if (!apiKey.trim()) {
      onError("请填写 OpenAI API Key");
      return;
    }
    setConfiguring(true);
    onError("");
    try {
      const next = await api.configureCardAi(apiKey);
      if (!current()) return;
      setStatus(next);
      setApiKey("");
      setStatusError("");
      setNote("图像服务已配置。密钥保存在 macOS 钥匙串，不写入 SubOS 数据库。");
      if (referenceDataUrl && next.available) void generateReference(referenceDataUrl, true);
    } catch (error) {
      if (!current()) return;
      onError(error instanceof Error ? error.message : "无法配置图像服务");
    } finally {
      if (current()) setConfiguring(false);
    }
  }

  async function generateReference(reference: string, available = Boolean(status?.available)) {
    const current = scope.begin("generate");
    if (!reference) {
      onError("请先上传一张卡片照片");
      return;
    }
    if (!available) {
      onError("请先配置 OpenAI API Key");
      return;
    }
    if ([issuer, product].some((label) => label.length > 80 || /\d{8,}/.test(label.replace(/[\s-]+/g, "")) || /\b(cvv|cvc|cid|pin|password|passwd)\b|卡密|支付密码|验证码/i.test(label))) {
      onError("卡片名称或发卡行包含号码、安全码或过长文本，请修改后再生成");
      return;
    }
    setGenerating(true);
    setNote("AI 正在根据脱敏色块重绘卡面，通常需要几十秒，复杂图案可能接近 2 分钟…");
    onError("");
    try {
      const cover = await api.generateCardCover({
        reference_data_url: reference,
        issuer,
        product,
        network,
      });
      if (!current()) return;
      onResolved(cover);
      setNote("卡面已生成并保存。银行名、卡名与尾号由 SubOS 显示，AI 不负责写这些信息。");
    } catch (error) {
      if (!current()) return;
      setNote("");
      onError(error instanceof Error ? error.message : "AI 卡面生成失败");
    } finally {
      if (current()) setGenerating(false);
    }
  }

  return (
    <div className="card-photo-generator">
      <div className="card-photo-generator-head">
        <div>
          <strong>拍照生成数字卡面</strong>
          <p>保留配色和大体构图，不复制卡号、安全特征或原照片。</p>
        </div>
        {status?.available ? <span className="card-ai-ready">AI 已就绪</span> : null}
      </div>

      <label className="card-photo-upload">
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={disabled || working}
          onChange={(event) => void pickPhoto(event)}
        />
        <span>{processing ? "正在本地脱敏…" : referenceDataUrl ? "重新选择照片" : "上传或拍摄卡片照片"}</span>
        <small>原图不上传；AI 就绪时，选定照片会自动发送脱敏色块并开始生成。</small>
      </label>

      {referenceDataUrl ? (
        <div className="card-photo-private-preview">
          <img src={referenceDataUrl} alt="将发送给 AI 的低清脱敏参考" />
          <div>
            <b>AI 可见的脱敏参考</b>
            <small>{photoName}</small>
          </div>
        </div>
      ) : null}

      {!status?.available && status?.credential_store !== "VPS私有 OPENAI_API_KEY 配置" ? (
        <details className="card-ai-config" open>
          <summary>首次使用：配置 OpenAI 图像服务</summary>
          <p>云端图像服务使用VPS私有配置；本地原图仅在浏览器内脱敏。</p>
          <div className="card-ai-config-row">
            <input
              className="field"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-…"
              aria-label="OpenAI API Key"
            />
            <button type="button" className="btn" disabled={disabled || working} onClick={() => void configure()}>
              {configuring ? "保存中…" : "保存到钥匙串"}
            </button>
          </div>
          <p>
            需要 OpenAI API 账户与可用额度；SubOS 默认用 {status?.model || "gpt-image-2"} 的低质量档生成草图。
          </p>
        </details>
      ) : null}

      {statusError ? <p className="caption card-ai-error">{statusError}</p> : null}
      {note ? <p className="caption card-photo-note">{note}</p> : null}
      <div className="card-photo-generate-row">
        <button
          type="button"
          className="btn btn-zhu"
          disabled={disabled || !referenceDataUrl || working || !status?.available}
          onClick={() => void generateReference(referenceDataUrl)}
        >
          {generating ? "正在生成卡面…" : "重新生成数字卡面"}
        </button>
        <small>选择照片或重新生成都会产生一次图像 API 费用。</small>
      </div>
    </div>
  );
}
