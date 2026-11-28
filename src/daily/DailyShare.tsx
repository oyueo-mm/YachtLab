import { useContext, useEffect, useRef, useState } from "react";
import { Download, Link2, Share2, X } from "lucide-react";
import { ActivityVisible } from "../shell/activity-visible";
import { categories, names, upper, type Card } from "../engine";
import { shareSummary, shareText, type ShareInput } from "./share";

/** Daily result image (canvas, nothing uploaded) and text. No dice faces are shown (share.ts). */
export const DAILY_SHARE_URL = "https://oyueo-mm.github.io/YachtLab/?utm_source=share&utm_medium=daily_card&utm_campaign=organic#daily";

export function drawDailyCard(canvas: HTMLCanvasElement, input: ShareInput) {
  const W = 1080, H = 1080;
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");
  if (!g) return;
  const font = (w: number, s: number) => `${w} ${s}px system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  g.fillStyle = "#1f1f1f";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#d93636";
  g.fillRect(0, 0, W, 12);
  g.textAlign = "left";
  g.fillStyle = "#fff";
  g.font = font(800, 44);
  g.fillText("오늘의 요트", 72, 110);
  g.fillStyle = "#bdbdbd";
  g.font = font(600, 32);
  g.textAlign = "right";
  g.fillText(input.date, W - 72, 110);
  g.textAlign = "center";
  g.fillStyle = "#ffd166";
  g.font = font(900, 168);
  g.fillText(String(input.score), W / 2, 330);
  g.fillStyle = "#e6e6e6";
  g.font = font(700, 36);
  g.fillText("점", W / 2, 392);
  const card: Card = input.card;
  const cols = [categories.slice(0, 6), categories.slice(6)];
  cols.forEach((list, col) => {
    list.forEach((c, i) => {
      const x = col === 0 ? 120 : W / 2 + 40, y = 480 + i * 72;
      const v = card[c];
      g.fillStyle = v === 0 ? "#3a3a3a" : c === "yacht" && v ? "#ffd166" : "#2f6f4e";
      g.fillRect(x, y - 40, 380, 56);
      g.fillStyle = "#fff";
      g.textAlign = "left";
      g.font = font(650, 28);
      g.fillText(names[c].replace(/ \(\d\)/, ""), x + 20, y - 2);
      g.textAlign = "right";
      g.font = font(800, 30);
      g.fillText(v === undefined ? "-" : String(v), x + 360, y - 2);
    });
  });
  g.textAlign = "center";
  g.fillStyle = "#bdbdbd";
  g.font = font(650, 30);
  const u = upper(card);
  g.fillText(u >= 63 ? `상단 ${u}점 · 보너스 +35` : `상단 ${u}/63`, W / 2, 960);
  g.fillStyle = "#9a9a9a";
  g.font = font(600, 26);
  g.fillText("oyueo-mm.github.io/YachtLab · 매일 같은 주사위로 겨루는 오늘의 요트", W / 2, 1030);
}

export function DailyShareButton({ input }: { input: Omit<ShareInput, "url"> }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="secondary share-result-button" onClick={() => setOpen(true)}><Share2 size={16} aria-hidden="true" /> 결과 공유</button>
    {open && <Sheet input={{ ...input, url: DAILY_SHARE_URL }} onClose={() => setOpen(false)} />}
  </>;
}

function Sheet({ input, onClose }: { input: ShareInput; onClose: () => void }) {
  const visible = useContext(ActivityVisible);
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (visible && !dialog.current?.open) dialog.current?.showModal();
    else if (!visible && dialog.current?.open) dialog.current.close();
  }, [visible]);
  useEffect(() => {
    if (canvas.current) drawDailyCard(canvas.current, input);
  }, [input]);
  const text = shareText(input);
  const blob = () => new Promise<Blob | null>((resolve) => canvas.current?.toBlob(resolve, "image/png") ?? resolve(null));
  const save = async () => {
    const b = await blob();
    if (!b) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = `yacht-daily-${input.date}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setNote("이미지를 저장했어요.");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setNote("결과 문구를 복사했어요.");
    } catch {
      setNote("복사하지 못했어요.");
    }
  };
  const share = async () => {
    const b = await blob();
    const file = b ? new File([b], `yacht-daily-${input.date}.png`, { type: "image/png" }) : null;
    try {
      if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text });
      else await navigator.share({ text });
    } catch {
      /* cancelled */
    }
  };
  return (
    <dialog ref={dialog} className="modal share-sheet" aria-label="오늘의 요트 결과 공유" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="share-head">
        <h2>결과 공유</h2>
        <button type="button" className="icon-button" aria-label="닫기" onClick={onClose}><X size={18} /></button>
      </div>
      <canvas ref={canvas} className="share-canvas daily-share-canvas" role="img" aria-label={shareSummary(input)} />
      <pre className="daily-share-text">{text}</pre>
      <div className="share-actions">
        <button type="button" className="primary" onClick={() => void save()}><Download size={16} aria-hidden="true" /> 이미지 저장</button>
        <button type="button" className="secondary" onClick={() => void copy()}><Link2 size={16} aria-hidden="true" /> 문구 복사</button>
        {typeof navigator.share === "function" && <button type="button" className="secondary" onClick={() => void share()}><Share2 size={16} aria-hidden="true" /> 공유</button>}
      </div>
      <p className="share-note" role="status">{note}</p>
    </dialog>
  );
}
