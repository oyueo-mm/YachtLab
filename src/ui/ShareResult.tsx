import { useEffect, useRef, useState } from "react";
import { Download, Link2, Share2 } from "lucide-react";
import { Sheet } from "./kit";

/**
 * Match result card for sharing (Phase 8.1, D-064): final score, result, yachts, match type, the brand
 * and the play link — drawn on a canvas in the browser (nothing is uploaded). Nicknames are hidden by
 * default ("나" / "상대"); the player can choose to show them. Only facts of the finished game appear:
 * no accuracy or luck numbers unless a verified review computed them.
 */
export type ShareFacts = {
  outcome: "win" | "lose" | "draw";
  me: { name: string; total: number; yachts: number };
  opponent: { name: string; total: number; yachts: number };
  /** e.g. "온라인 대전", "AI 대전 · 매우 어려움". */
  kind: string;
};

export const SHARE_URL = "https://oyueo-mm.github.io/YachtLab/?utm_source=share&utm_medium=result_card&utm_campaign=organic";

export function drawResultCard(canvas: HTMLCanvasElement, facts: ShareFacts, showNames: boolean) {
  const W = 1200, H = 630;
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");
  if (!g) return;
  const font = (w: number, s: number) => `${w} ${s}px system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  const round = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  // UI-1 card: dark table felt, the result as a headline, two score panels (the winner's lit up).
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#2b2b2b");
  bg.addColorStop(1, "#171717");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#d93636";
  g.fillRect(0, 0, W, 10);
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  g.fillStyle = "#fff";
  g.font = font(800, 40);
  g.fillText("Online", 64, 90);
  const online = g.measureText("Online ").width;
  g.fillStyle = "#ff5a5a";
  g.fillText("Yacht", 64 + online, 90);
  // match type as a pill on the right
  g.font = font(650, 26);
  const kindWidth = g.measureText(facts.kind).width + 40;
  round(W - 64 - kindWidth, 56, kindWidth, 46, 23);
  g.fillStyle = "rgba(255,255,255,0.1)";
  g.fill();
  g.fillStyle = "#d9d9d9";
  g.textAlign = "center";
  g.fillText(facts.kind, W - 64 - kindWidth / 2, 88);
  const title = facts.outcome === "win" ? "승리" : facts.outcome === "lose" ? "패배" : "무승부";
  g.fillStyle = facts.outcome === "win" ? "#ffd166" : facts.outcome === "draw" ? "#e8e8e8" : "#cfcfcf";
  g.font = font(900, 84);
  g.fillText(title, W / 2, 200);
  const clip = (s: string) => (s.length > 12 ? s.slice(0, 11) + "…" : s);
  const panel = (x: number, label: string, total: number, yachts: number, color: string, lead: boolean) => {
    const w = 400, h = 300, y = 240;
    round(x - w / 2, y, w, h, 28);
    g.fillStyle = lead ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)";
    g.fill();
    g.lineWidth = lead ? 4 : 2;
    g.strokeStyle = lead ? color : "rgba(255,255,255,0.12)";
    g.stroke();
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y + 52, 12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ececec";
    g.font = font(700, 32);
    g.fillText(label, x, y + 112);
    g.fillStyle = "#fff";
    g.font = font(900, 120);
    g.fillText(String(total), x, y + 236);
    g.fillStyle = "#bdbdbd";
    g.font = font(600, 26);
    g.fillText(yachts ? `요트 ${yachts}회` : " ", x, y + 278);
  };
  const meLead = facts.outcome === "win", oppLead = facts.outcome === "lose";
  panel(W * 0.29, showNames ? clip(facts.me.name) : "나", facts.me.total, facts.me.yachts, "#ff5a5a", meLead);
  panel(W * 0.71, showNames ? clip(facts.opponent.name) : "상대", facts.opponent.total, facts.opponent.yachts, "#5b8ff0", oppLead);
  g.fillStyle = "#8a8a8a";
  g.font = font(800, 40);
  g.fillText("VS", W / 2, 404);
  g.fillStyle = "#9a9a9a";
  g.font = font(600, 24);
  g.fillText("oyueo-mm.github.io/YachtLab · 무료 온라인 요트다이스", W / 2, 600);
}

export function ShareResultButton({ facts }: { facts: ShareFacts }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="secondary share-result-button" onClick={() => setOpen(true)}><Share2 size={16} aria-hidden="true" /> 결과 공유</button>
    {open && <ShareSheet facts={facts} onClose={() => setOpen(false)} />}
  </>;
}

function ShareSheet({ facts, onClose }: { facts: ShareFacts; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [showNames, setShowNames] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (canvas.current) drawResultCard(canvas.current, facts, showNames);
  }, [facts, showNames]);
  const blob = () => new Promise<Blob | null>((resolve) => canvas.current?.toBlob(resolve, "image/png") ?? resolve(null));
  const save = async () => {
    const b = await blob();
    if (!b) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = "online-yacht-result.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setNote("이미지를 저장했어요.");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      setNote("링크를 복사했어요.");
    } catch {
      setNote("복사하지 못했어요. " + SHARE_URL);
    }
  };
  const text = `요트다이스 ${facts.outcome === "win" ? "승리" : facts.outcome === "lose" ? "패배" : "무승부"} ${facts.me.total} : ${facts.opponent.total}`;
  const share = async () => {
    const b = await blob();
    const file = b ? new File([b], "online-yacht-result.png", { type: "image/png" }) : null;
    try {
      if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text, url: SHARE_URL });
      else await navigator.share({ text, url: SHARE_URL });
    } catch {
      /* cancelled */
    }
  };
  return (
    // UI-1: the common Sheet (centred modal on PC, bottom sheet on phones, backdrop, Esc, focus return).
    // The old bare <dialog> lost its `margin: auto` to the CSS reset and opened in the top-left corner.
    <Sheet open onClose={onClose} title="결과 공유" className="share-sheet">
      <canvas ref={canvas} className="share-canvas" role="img" aria-label={`${text} 결과 이미지`} />
      <label className="share-names"><input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} /> 닉네임 표시</label>
      <div className="share-actions">
        <button type="button" className="primary" onClick={() => void save()}><Download size={16} aria-hidden="true" /> 이미지 저장</button>
        <button type="button" className="secondary" onClick={() => void copy()}><Link2 size={16} aria-hidden="true" /> 링크 복사</button>
        {typeof navigator.share === "function" && <button type="button" className="secondary" onClick={() => void share()}><Share2 size={16} aria-hidden="true" /> 공유</button>}
      </div>
      <p className="share-note" role="status">{note}</p>
    </Sheet>
  );
}
