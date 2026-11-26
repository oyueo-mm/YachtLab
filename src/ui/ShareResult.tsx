import { useEffect, useRef, useState } from "react";
import { Download, Link2, Share2, X } from "lucide-react";

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
  g.fillStyle = "#1f1f1f";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#d93636";
  g.fillRect(0, 0, W, 10);
  g.fillStyle = "#fff";
  g.font = font(800, 40);
  g.textBaseline = "alphabetic";
  g.fillText("Online", 64, 92);
  const online = g.measureText("Online ").width;
  g.fillStyle = "#ff5a5a";
  g.fillText("Yacht", 64 + online, 92);
  g.fillStyle = "#bdbdbd";
  g.font = font(600, 28);
  g.textAlign = "right";
  g.fillText(facts.kind, W - 64, 90);
  g.textAlign = "center";
  const title = facts.outcome === "win" ? "승리" : facts.outcome === "lose" ? "패배" : "무승부";
  g.fillStyle = facts.outcome === "win" ? "#ffd166" : "#ffffff";
  g.font = font(900, 92);
  g.fillText(title, W / 2, 232);
  const side = (x: number, label: string, total: number, yachts: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, 330, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#e6e6e6";
    g.font = font(700, 32);
    g.fillText(label, x, 392);
    g.fillStyle = "#fff";
    g.font = font(900, 112);
    g.fillText(String(total), x, 506);
    g.fillStyle = "#bdbdbd";
    g.font = font(600, 26);
    g.fillText(yachts ? `요트 ${yachts}회` : " ", x, 548);
  };
  const clip = (s: string) => (s.length > 12 ? s.slice(0, 11) + "…" : s);
  side(W * 0.3, showNames ? clip(facts.me.name) : "나", facts.me.total, facts.me.yachts, "#d93636");
  side(W * 0.7, showNames ? clip(facts.opponent.name) : "상대", facts.opponent.total, facts.opponent.yachts, "#2f6fde");
  g.fillStyle = "#777";
  g.font = font(800, 64);
  g.fillText(":", W / 2, 490);
  g.fillStyle = "#9a9a9a";
  g.font = font(600, 24);
  g.fillText("oyueo-mm.github.io/YachtLab · 무료 온라인 요트다이스", W / 2, 606);
}

export function ShareResultButton({ facts }: { facts: ShareFacts }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="secondary share-result-button" onClick={() => setOpen(true)}><Share2 size={16} aria-hidden="true" /> 결과 공유</button>
    {open && <ShareSheet facts={facts} onClose={() => setOpen(false)} />}
  </>;
}

function ShareSheet({ facts, onClose }: { facts: ShareFacts; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [showNames, setShowNames] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
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
    <dialog ref={dialog} className="modal share-sheet" aria-label="결과 공유" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="share-head">
        <h2>결과 공유</h2>
        <button type="button" className="icon-button" aria-label="닫기" onClick={onClose}><X size={18} /></button>
      </div>
      <canvas ref={canvas} className="share-canvas" role="img" aria-label={`${text} 결과 이미지`} />
      <label className="share-names"><input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} /> 닉네임 표시</label>
      <div className="share-actions">
        <button type="button" className="primary" onClick={() => void save()}><Download size={16} aria-hidden="true" /> 이미지 저장</button>
        <button type="button" className="secondary" onClick={() => void copy()}><Link2 size={16} aria-hidden="true" /> 링크 복사</button>
        {typeof navigator.share === "function" && <button type="button" className="secondary" onClick={() => void share()}><Share2 size={16} aria-hidden="true" /> 공유</button>}
      </div>
      <p className="share-note" role="status">{note}</p>
    </dialog>
  );
}
