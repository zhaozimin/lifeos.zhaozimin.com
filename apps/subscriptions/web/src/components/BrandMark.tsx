/**
 * [INPUT]: 依赖订阅的 website / logo_src / name
 * [OUTPUT]: 对外提供 BrandMark。方图和照片铺满方板；横条字标才居中留白
 * [POS]: components 的识别入口。用 button 打开站点，避免套在卡片 Link 里成嵌套 <a>
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useState, type MouseEvent } from "react";
import { hostOf } from "../lib/format";

function isFullBleed(src: string): boolean {
  if (src.startsWith("/api/subscriptions/icons/") || src.startsWith("/icons/")) return true;
  return /mzstatic\.com\/image\/thumb\/Purple/i.test(src);
}

function isBrandMarkSrc(src: string): boolean {
  return /google\.com\/s2\/favicons/i.test(src) || /simpleicons\.org/i.test(src) || /lobehub\/icons/i.test(src);
}

function fitFromSize(width: number, height: number): "cover" | "mark" {
  if (!width || !height) return "cover";
  const ratio = width / height;
  return ratio >= 0.82 && ratio <= 1.22 ? "cover" : "mark";
}

export function BrandMark({
  name,
  website,
  logoSrc,
  size = 40,
}: {
  name: string;
  website: string;
  logoSrc: string;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const [fit, setFit] = useState<"cover" | "mark">(() =>
    isBrandMarkSrc(logoSrc) ? "mark" : "cover",
  );
  const letter = (name.trim()[0] || hostOf(website)[0] || "?").toUpperCase();
  const cover = isFullBleed(logoSrc) || (!isBrandMarkSrc(logoSrc) && fit === "cover");

  useEffect(() => {
    setBroken(false);
    setFit(isBrandMarkSrc(logoSrc) ? "mark" : "cover");
  }, [logoSrc]);

  function openSite(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!website) return;
    window.open(website, "_blank", "noopener,noreferrer");
  }

  return (
    <button
      type="button"
      title={`打开 ${hostOf(website)}`}
      onClick={openSite}
      className="app-icon"
      style={{ width: size, height: size }}
    >
      <span className="app-icon-face">
        {!broken && logoSrc ? (
          <img
            src={logoSrc}
            alt=""
            width={size}
            height={size}
            className={cover ? "is-cover" : "is-mark"}
            draggable={false}
            onLoad={(event) => {
              if (isFullBleed(logoSrc) || isBrandMarkSrc(logoSrc)) return;
              setFit(fitFromSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight));
            }}
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="app-icon-fallback">{letter}</span>
        )}
      </span>
    </button>
  );
}
