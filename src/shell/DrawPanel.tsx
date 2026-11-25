import { useEffect, useRef, useState } from "react";
import { Coins } from "lucide-react";
import { DiceArea } from "../DiceArea";
import { waitForDice } from "../dice-motion";
import { itemById } from "../economy/live/catalog";
import { DRAW_COMBINATIONS, DRAW_COST, DRAW_DAILY_LIMIT, DRAW_TIERS, DUPLICATE_COINS, HANDS, drawAvailable, drawItems, drawPool, enumerateDrawHands, type DrawPool, type DrawReceipt, type DrawStatus } from "../economy/live/draw";
import { SEASONS, type SeasonId } from "../economy/live/seasons";
import { session } from "../identity/account-client";
import { drawStatus, EconomyError, economyRequestId, submitDraw, type Snapshot } from "../identity/economy-client";
import { BrandMark } from "../ui/BrandLoading";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ItemThumb, tierLabel } from "./ItemViews";

type Pending = { pool: DrawPool; requestId: string };
const odds = (count: number, items = 1) => (count * 100 / DRAW_COMBINATIONS / items).toFixed(items === 1 ? 3 : 5) + "%";
const format = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });
const order = [0, 1, 2, 3, 4];

async function pendingKey(server: string) {
  const owner = session();
  if (!owner) return null;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(server + "\n" + owner));
  return "yachtlab.draw.pending:" + Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function DrawPanel({ server, onWallet }: { server: string; onWallet: (snapshot: Snapshot) => void }) {
  const [status, setStatus] = useState<DrawStatus | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pool, setPool] = useState<DrawPool>("standard");
  const [key, setKey] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<DrawReceipt | null>(null);
  const [animating, setAnimating] = useState(false);
  const [rollEvent, setRollEvent] = useState(0);
  const [counts] = useState(enumerateDrawHands);
  const sending = useRef(false);

  const load = async () => {
    setError("");
    try {
      const result = await drawStatus(server);
      setStatus(result.draw);
      setSnapshot(result.snapshot);
    } catch (error) {
      setError(error instanceof Error ? error.message : "뽑기 정보를 불러오지 못했어요.");
    }
  };
  useEffect(() => { void load(); }, [server]);
  useEffect(() => {
    let live = true;
    void pendingKey(server).then((key) => {
      if (!live || !key) return;
      const raw = sessionStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) as Partial<Pending> : null;
      if (parsed && drawPool(parsed.pool) && typeof parsed.requestId === "string") setPending(parsed as Pending);
      setKey(key);
    }).catch(() => setError("브라우저에 뽑기 요청을 저장할 수 없어요."));
    return () => { live = false; };
  }, [server]);
  useEffect(() => {
    if (!animating) return;
    const controller = new AbortController();
    const frame = requestAnimationFrame(() => {
      void waitForDice(controller.signal).then(() => setAnimating(false)).catch(() => {});
    });
    const visibility = () => { if (document.hidden) setAnimating(false); };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visibility);
      controller.abort();
    };
  }, [animating, rollEvent]);

  const clearPending = () => {
    if (key) sessionStorage.removeItem(key);
    setPending(null);
  };
  const draw = async (retry = pending) => {
    if (!key || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    const request = retry ?? { requestId: economyRequestId(), pool };
    try {
      sessionStorage.setItem(key, JSON.stringify(request));
      setPending(request);
      const response = await submitDraw(server, request.pool, request.requestId);
      setSnapshot(response.snapshot);
      onWallet(response.snapshot);
      setStatus(response.draw);
      setReceipt(response.receipt);
      clearPending();
      if (!retry && !document.hidden) {
        setRollEvent((current) => current + 1);
        setAnimating(true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "뽑기 요청을 처리하지 못했어요.";
      if (error instanceof EconomyError && ["DRAW_CLOSED", "DRAW_LIMIT", "INSUFFICIENT", "DRAW_REQUEST", "INVALID"].includes(error.code)) {
        clearPending();
        setError(message);
      } else {
        setError(message + " 결과 확인을 누르면 같은 요청을 조회해요.");
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const active = status !== null && drawAvailable(pool, status.now);
  const season = pool === "standard" ? null : SEASONS[pool];
  const dice = (receipt?.dice ?? [1, 1, 1, 1, 1]).map((value, id) => ({ id, value, held: false }));
  const won = itemById(receipt?.itemId);
  const canDraw = snapshot && active && status.remaining > 0 && snapshot.wallet.coins >= DRAW_COST;
  return <section className="draw-panel" role="tabpanel" aria-label="뽑기">
    <div className="draw-controls">
      <label>뽑기 종류 <select value={pool} onChange={(event) => setPool(event.target.value as DrawPool)}>
        <option value="standard">일반 뽑기</option>
        {(Object.keys(SEASONS) as SeasonId[]).map((id) => <option key={id} value={id}>{SEASONS[id].name}</option>)}
      </select></label>
      {status && <small>오늘 남은 횟수 {status.remaining}/{DRAW_DAILY_LIMIT} · 매일 00:00 초기화</small>}
    </div>
    {season && <p className="econ-note">{format.format(season.start)} ~ {format.format(season.end)} (한국 시간){active ? "" : " · 판매 기간 외"}</p>}
    <p className="econ-note">주사위 5개를 한 번 굴려 족보에 해당하는 등급에서 상품 하나를 받아요. 같은 상품을 받으면 {DUPLICATE_COINS}코인으로 지급해요.</p>
    <section className="game-board throw-tray stage-board" aria-label="뽑기 주사위">
      <DiceArea state={{ dice, order, rolls: receipt ? 1 : 0 }} animate={!receipt || animating} rollEvent={rollEvent} />
    </section>
    {busy && <p role="status" className="econ-note"><BrandMark /> 뽑기 결과를 불러오는 중…</p>}
    {error && <p className="error-message" role="alert">{error}</p>}
    {status && !active && pool !== "standard" && <p className="econ-note">시즌 중에만 참여할 수 있어요.</p>}
    {!status && error && <button className="secondary" type="button" onClick={() => void load()}>다시 불러오기</button>}
    {pending ? <button className="primary" type="button" disabled={busy} onClick={() => void draw()}>결과 확인</button> :
      <button className="primary" type="button" disabled={!canDraw || !key || busy || animating} onClick={() => setConfirm(true)}><Coins size={16} /> {DRAW_COST}코인으로 1회 뽑기</button>}
    {animating && <button type="button" className="secondary" onClick={() => setAnimating(false)}>연출 건너뛰기</button>}
    {receipt && won && !animating && <div className="draw-result" role="status">
      <ItemThumb item={won} />
      <div><strong>{won.name}</strong><p>{HANDS[receipt.hand].title} · {tierLabel(won.tier)} · {receipt.dice.join(" · ")}</p>
        {receipt.duplicateCoins > 0 && <small>보유한 상품 · {receipt.duplicateCoins}코인 지급</small>}</div>
    </div>}
    <details className="draw-odds">
      <summary>족보와 상품별 확률</summary>
      <p>요트 → 라지 → 포카드 → 풀 하우스 → 스몰 → 트리플 → 투 페어 → 원 페어 → 노 페어 순서로 한 가지만 인정해요. 등급 내 상품은 같은 확률이에요.</p>
      <ul>{Object.entries(HANDS).map(([hand, def]) =>
        <li key={hand}>{def.title} · {tierLabel(def.tier)} · {counts[hand as keyof typeof HANDS]}/{DRAW_COMBINATIONS} ({odds(counts[hand as keyof typeof HANDS])})</li>)}</ul>
      {DRAW_TIERS.map((tier) => {
        const products = drawItems(pool, tier);
        const hits = Object.entries(HANDS).reduce((total, [hand, def]) => total + (def.tier === tier ? counts[hand as keyof typeof HANDS] : 0), 0);
        return <details key={tier}>
          <summary>{tierLabel(tier)} {odds(hits)} · 상품당 {odds(hits, products.length)}</summary>
          <ul>{products.map((item) => <li key={item.id}>{item.name}</li>)}</ul>
        </details>;
      })}
    </details>
    {status && <details className="draw-history">
      <summary>최근 뽑기 기록</summary>
      {status.history.length ? <ol>{status.history.map((entry) =>
        <li key={entry.requestId}>{format.format(entry.at)} · {HANDS[entry.hand].title} · {itemById(entry.itemId)?.name ?? entry.itemId} · {entry.dice.join("·")}{entry.duplicateCoins ? ` · 중복 +${entry.duplicateCoins}코인` : ""}</li>)}</ol> : <p>아직 뽑기 기록이 없어요.</p>}
    </details>}
    <ConfirmDialog open={confirm} title="주사위를 굴릴까요?" message={`${DRAW_COST}코인을 사용해 ${season?.name ?? "일반 뽑기"}를 1회 진행해요.`}
      confirmLabel="뽑기" onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void draw(null); }} />
  </section>;
}
