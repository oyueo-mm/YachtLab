import { useMemo, useState } from "react";
import { ITEMS, lookAt, publicLook, DEFAULT_LOADOUT, type ItemCategory, type ItemDef } from "../economy/live/catalog";
import { SOCIAL_ITEMS } from "../social/catalog";
import { FIXTURE_CHATS, fixtureLine, type FixtureLine } from "../chat/a2-fixture";
import { ChatMessage } from "../play/ChatMessage";
import { PlayerTag } from "../play/Looks";
import { FxBurst, type FxKind } from "../play/FxBurst";
import { groupByTier, SocialDock, TableFeed, TIER_NAME, useTableChat } from "../play/SocialDock";
import { GUEST_LOOK } from "../economy/live/catalog";
import { chatMoodOf } from "../chat/chat-mood";
import { playEmoteSfx, unlockAudio } from "../sound";

/**
 * 꾸미기 미리보기 (A2, test environment). Everything here uses the SAME components as the game
 * (ChatMessage, PlayerTag, FxBurst), so what is shown is what the table shows. The 38 chat lines are a
 * fixture with a proposed tier split — not the live catalog, and nothing is saved or sent.
 */
const byCat = (c: ItemCategory) => ITEMS.filter((i) => i.category === c && !i.id.endsWith(".none") && !i.id.endsWith("basic"));
const LEVELS = [1, 2, 3] as const;
/** The preview resolves fixture ids and falls back to the live catalog for emotes. */
const resolve = (id: unknown) => (typeof id === "string" ? fixtureLine(id) ?? SOCIAL_ITEMS.find((i) => i.id === id) ?? null : null);

function Picker({ items, value, onChange, label }: { items: ItemDef[]; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <label className="cosm-pick">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">없음</option>
        {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
    </label>
  );
}

export default function CosmeticsLab() {
  const chat = useTableChat("me", resolve);
  const bubbles = useMemo(() => byCat("bubble"), []);
  const names = useMemo(() => byCat("nameFx"), []);
  const titles = useMemo(() => byCat("title"), []);
  const frames = useMemo(() => ITEMS.filter((i) => i.category === "profile" && /pf-ring/.test(i.look.css ?? "")), []);
  const fxs = useMemo(() => byCat("fx"), []);
  const emotes = useMemo(() => SOCIAL_ITEMS.filter((i) => i.kind === "emote" && !i.retired), []);

  const [bubbleId, setBubbleId] = useState("bubble.neon");
  const [bubbleLv, setBubbleLv] = useState(3);
  const [line, setLine] = useState<FixtureLine>(FIXTURE_CHATS.find((l) => l.text === "대박!") ?? FIXTURE_CHATS[0]);
  const [lineKey, setLineKey] = useState(0);
  const [emoteId, setEmoteId] = useState("emote.fire");
  const [emoteLv, setEmoteLv] = useState(3);
  const [emoteKey, setEmoteKey] = useState(0);
  const [nameId, setNameId] = useState("nameFx.neon");
  const [nameLv, setNameLv] = useState(3);
  const [titleId, setTitleId] = useState("title.legend_roll");
  const [frameId, setFrameId] = useState("profile.flame");
  const [frameLv, setFrameLv] = useState(3);
  const [fxId, setFxId] = useState("fx.fireworks");
  const [fxLv, setFxLv] = useState(3);
  const [fxKind, setFxKind] = useState<FxKind>("yacht");
  const [fxKey, setFxKey] = useState(0);

  const pickerLook = useMemo(() => ({
    ...GUEST_LOOK, bubble: bubbleId || GUEST_LOOK.bubble, bubbleLv,
    chats: [...FIXTURE_CHATS.slice(0, 6), ...FIXTURE_CHATS.filter((l) => ["대박!", "정말요?", "저런…", "요트 한 번만!", "멋지네요!", "아쉽네요"].includes(l.text))].map((l) => l.id),
    emotes: ["emote.smile", "emote.party", "emote.clap", "emote.thumbs_up"].map((id) => ({ id, lv: 1 })),
  }), [bubbleId, bubbleLv]);
  const bubble = ITEMS.find((i) => i.id === bubbleId);
  const bubbleCss = bubble ? lookAt(bubble, bubbleLv).css ?? "" : "";
  const emote = SOCIAL_ITEMS.find((i) => i.id === emoteId)!;
  const worn = {
    ...publicLook(DEFAULT_LOADOUT, new Map()),
    nameFx: nameId || "nameFx.none", nameFxLv: nameLv,
    title: titleId || "title.none",
    profile: frameId || "profile.die", profileLv: frameLv,
  };
  const fxItem = ITEMS.find((i) => i.id === fxId);
  const fxLook = fxItem ? lookAt(fxItem, fxLv).fx : undefined;

  return (
    <section className="cosm-lab" aria-labelledby="cosm-title">
      <div className="lab-hub-heading"><h1 id="cosm-title">꾸미기 미리보기</h1></div>

      <section aria-label="채팅 38종">
        <h2>채팅 <small>(테스트 fixture · 등급은 제안)</small></h2>
        <div className="stage" data-testid="chat-stage">
          <div className="table-feed"><ChatMessage key={lineKey} item={line} from="친구" bubbleCss={bubbleCss} /></div>
          <small className="stage-meta" data-testid="chat-meta">{TIER_NAME[line.proposedTier]} · 움직임 {chatMoodOf(line.text)}</small>
        </div>
        {groupByTier(FIXTURE_CHATS).map(([tier, lines]) => (
          <div className="tier-block" key={tier}>
            <h3>{TIER_NAME[tier]} {lines.length}종</h3>
            <div className="line-buttons">
              {lines.map((l) => (
                <button key={l.id} type="button" data-tier={tier} aria-pressed={l.id === line.id} onClick={() => { setLine(l); setLineKey((n) => n + 1); }}
                  style={{ ["--tier-c" as string]: ({ basic: "#51cf66", common: "#adb5bd", rare: "#4dabf7", epic: "#9775fa", legendary: "#f59f00", mythic: "#f03e3e" } as Record<string, string>)[tier] }}>{l.text}</button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section aria-label="채팅 선택창">
        <h2>채팅 선택창 <small>(게임과 같은 보내기 창 · 보내도 어디에도 전송되지 않아요)</small></h2>
        <div className="stage" data-testid="dock-stage">
          <TableFeed chat={chat} names={{ me: "나" }} looks={{ me: pickerLook }} me="me" resolve={resolve} />
          <SocialDock chat={chat} look={pickerLook} online transport={(id) => { window.setTimeout(() => chat.received("me", id), 80); return true; }} me="me" resolve={resolve} />
        </div>
      </section>

      <section aria-label="말풍선">
        <h2>말풍선 <small>(채팅 움직임과 별개로 표면·테두리만)</small></h2>
        <div className="row">
          <Picker items={bubbles} value={bubbleId} onChange={(v) => { setBubbleId(v); setLineKey((n) => n + 1); }} label="말풍선" />
          <div className="row chips" role="group" aria-label="말풍선 단계">
            {LEVELS.filter((l) => !bubble || l <= bubble.maxLevel).map((l) => <button key={l} type="button" aria-pressed={bubbleLv === l} onClick={() => { setBubbleLv(l); setLineKey((n) => n + 1); }}>Lv.{l}</button>)}
          </div>
        </div>
        <p className="cosm-hint">위 무대의 채팅 문구에 적용돼요.</p>
      </section>

      <section aria-label="이모티콘">
        <h2>이모티콘</h2>
        <div className="row chips" role="group" aria-label="이모티콘 단계">
          {LEVELS.map((l) => <button key={l} type="button" aria-pressed={emoteLv === l} onClick={() => { setEmoteLv(l); setEmoteKey((n) => n + 1); }}>Lv.{l}</button>)}
        </div>
        <div className="stage" data-testid="emote-stage">
          <div className="table-feed"><ChatMessage key={emoteKey} item={emote} from="친구" bubbleCss={bubbleCss} level={emoteLv} /></div>
        </div>
        <div className="line-buttons">
          {emotes.map((e) => <button key={e.id} type="button" aria-label={e.label} aria-pressed={e.id === emoteId} onClick={() => { unlockAudio(); setEmoteId(e.id); setEmoteKey((n) => n + 1); if (emoteLv >= 3) playEmoteSfx(e.id, emoteLv); }}>{e.text}</button>)}
        </div>
      </section>

      <section aria-label="닉네임 · 칭호 · 프레임">
        <h2>닉네임 · 칭호 · 프레임 조합</h2>
        <div className="row">
          <Picker items={names} value={nameId} onChange={setNameId} label="닉네임 효과" />
          <div className="row chips" role="group" aria-label="닉네임 단계">{LEVELS.map((l) => <button key={l} type="button" aria-pressed={nameLv === l} onClick={() => setNameLv(l)}>Lv.{l}</button>)}</div>
        </div>
        <div className="row"><Picker items={titles} value={titleId} onChange={setTitleId} label="칭호" /></div>
        <div className="row">
          <Picker items={frames} value={frameId} onChange={setFrameId} label="프레임" />
          <div className="row chips" role="group" aria-label="프레임 단계">{LEVELS.map((l) => <button key={l} type="button" aria-pressed={frameLv === l} onClick={() => setFrameLv(l)}>Lv.{l}</button>)}</div>
        </div>
        <div className="stage" data-testid="tag-stage">
          <div className="profile-card-sample"><PlayerTag name="요트왕" look={worn} me /></div>
          <div className="seat-dark" aria-label="게임 좌석 표시"><PlayerTag name="요트왕" look={worn} me tone="me" compact /></div>
        </div>
      </section>

      <section aria-label="특수 효과">
        <h2>특수 효과</h2>
        <div className="row">
          <Picker items={fxs} value={fxId} onChange={(v) => { setFxId(v); setFxKey((n) => n + 1); }} label="효과" />
          <div className="row chips" role="group" aria-label="효과 단계">{LEVELS.map((l) => <button key={l} type="button" aria-pressed={fxLv === l} onClick={() => { setFxLv(l); setFxKey((n) => n + 1); }}>Lv.{l}</button>)}</div>
        </div>
        <div className="row chips" role="group" aria-label="연출 종류">
          {([["win", "승리"], ["yacht", "요트"], ["large", "라지 스트레이트"]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={fxKind === k} onClick={() => { setFxKind(k); setFxKey((n) => n + 1); }}>{t}</button>)}
        </div>
        <div className="stage tall" data-testid="fx-stage">
          {fxLook && <FxBurst key={fxKey} fx={fxLook} level={fxLv} seed={`lab-${fxId}-${fxKind}-${fxKey}`} kind={fxKind} sound={fxKey > 0} />}
          <strong className="stage-label">{fxKind === "win" ? "승리했습니다!" : fxKind === "yacht" ? "요트!" : "라지 스트레이트"}</strong>
        </div>
        <button type="button" className="primary" onClick={() => { unlockAudio(); setFxKey((n) => n + 1); }}>재생</button>
      </section>
    </section>
  );
}
