import { describe, expect, it } from "vitest";
import { seededDiceSource } from "../src/online";
import { OnlineRoom, ROOM_LIMITS, type RoomConnection, type RoomRecord } from "../src/online/room";
import type { ServerMessage } from "../src/online/wire";
import { SOCIAL_ITEMS, allowSocial, canSend, newSocialBucket, socialRetryMs } from "../src/social/catalog";
import { categories } from "../src/engine";

/** Phase 3 social features on the runtime-free room: rematch, preset chat / emotes, leaving. */
class Conn implements RoomConnection {
  playerId: string | null = null;
  seenSeq = 0;
  bucket = { tokens: ROOM_LIMITS.burst, at: 0 };
  sent: ServerMessage[] = [];
  closed: number | null = null;
  send(m: ServerMessage) {
    this.sent.push(JSON.parse(JSON.stringify(m)));
  }
  close(code: number) {
    this.closed = code;
  }
  last<T extends ServerMessage["t"]>(t: T) {
    return [...this.sent].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined;
  }
  all<T extends ServerMessage["t"]>(t: T) {
    return this.sent.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }
}

async function setup(opts: { allowMatch?: () => string | null } = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const store = { record: null as RoomRecord | null, writes: 0 };
  const room = OnlineRoom.create("ABCDEF", {
    now: clock.now,
    dice: seededDiceSource(11),
    save: (r) => {
      store.record = JSON.parse(JSON.stringify(r));
      store.writes++;
    },
    schedule: () => {},
    allowMatch: opts.allowMatch,
  });
  const ja = await room.join("민수");
  const jb = await room.join("지민");
  if (!ja.ok || !jb.ok) throw Error("join");
  const a = new Conn(),
    b = new Conn();
  room.connect(a);
  room.connect(b);
  await room.message(a, JSON.stringify({ t: "hello", token: ja.token }));
  await room.message(b, JSON.stringify({ t: "hello", token: jb.token }));
  let n = 0;
  const cmd = async (c: Conn, action: object) => {
    clock.advance(50);
    await room.message(c, JSON.stringify({ t: "cmd", id: "c" + ++n, action }));
    return c.last("ack")!;
  };
  const conns = { [ja.playerId]: a, [jb.playerId]: b };
  /** Play the whole match: whoever's turn it is rolls once and takes the first open category. */
  const playOut = async () => {
    for (let guard = 0; guard < 40 && room.match.status === "playing"; guard++) {
      const turn = room.match.turn!;
      const c = conns[turn.playerId];
      await cmd(c, { type: "roll", keep: [] });
      const me = room.match.players.find((p) => p.playerId === turn.playerId)!;
      await cmd(c, { type: "score", category: categories.find((k) => me.card[k] === undefined) });
    }
  };
  return { room, a, b, ja, jb, cmd, playOut, clock, store };
}

describe("재대결 (같은 방 재사용)", () => {
  it("요청·수락으로 새 matchId의 경기가 시작되고, 선공이 바뀌며, 이전 경기 결과는 방 전적으로 남는다", async () => {
    const { room, a, b, ja, jb, cmd, playOut, clock, store } = await setup();
    await cmd(a, { type: "start" });
    const firstId = room.match.matchId;
    expect(firstId).toMatch(/^m_[A-Za-z0-9_-]{16}$/);
    expect(room.match.turn!.playerId).toBe(ja.playerId);
    await playOut();
    expect(room.match.status).toBe("finished");
    // The finish itself announces the room score (no request yet).
    expect(b.last("rematch")!.rematch.requests).toEqual([]);
    expect(b.last("rematch")!.series.games).toBe(1);
    await room.message(a, JSON.stringify({ t: "rematch", op: "request" }));
    expect(b.last("rematch")!.rematch.requests).toEqual([ja.playerId]);
    // double tap: no second write, no duplicate request
    const writes = store.writes;
    await room.message(a, JSON.stringify({ t: "rematch", op: "request" }));
    expect(store.writes).toBe(writes);
    clock.advance(2000);
    await room.message(b, JSON.stringify({ t: "rematch", op: "request" }));
    expect(room.match.status).toBe("playing");
    expect(room.match.matchId).not.toBe(firstId);
    expect(room.match.turn!.playerId).toBe(jb.playerId); // the other player starts this time
    expect(room.match.version).toBeLessThan(10); // fresh log for the new match
    const series = b.last("rematch")!.series;
    expect(series.games).toBe(1);
    expect(series.matchNo).toBe(2);
    expect(store.record!.series).toHaveLength(1);
    expect(store.record!.series![0].matchId).toBe(firstId);
    // Both screens got the new match from seq 0, and the old seat tokens still work.
    expect(a.last("view")!.view.matchId).toBe(room.match.matchId);
    expect(await room.authenticate(ja.token)).toBe(ja.playerId);
  });

  it("동시 요청, 3경기 연속, 경기마다 다른 matchId, 점수·타이머 초기화", async () => {
    const { room, a, b, cmd, playOut, clock } = await setup();
    await cmd(a, { type: "start" });
    const ids = new Set<string>();
    for (let game = 0; game < 3; game++) {
      ids.add(room.match.matchId);
      expect(room.match.players.every((p) => Object.keys(p.card).length === 0)).toBe(true);
      await playOut();
      clock.advance(2000);
      // both ask at (almost) the same time: messages are serialized by the room
      await Promise.all([room.message(a, JSON.stringify({ t: "rematch", op: "request" })), room.message(b, JSON.stringify({ t: "rematch", op: "request" }))]);
      expect(room.match.status).toBe("playing");
    }
    ids.add(room.match.matchId);
    expect(ids.size).toBe(4);
    expect(b.last("rematch")!.series.games).toBe(3);
  });

  it("거절·취소, 상대가 방을 떠나면 재대결 불가, 모두 떠나면 방이 닫힌다", async () => {
    const { room, a, b, ja, jb, cmd, playOut, clock } = await setup();
    await cmd(a, { type: "start" });
    await playOut();
    await room.message(a, JSON.stringify({ t: "rematch", op: "request" }));
    clock.advance(1500);
    await room.message(b, JSON.stringify({ t: "rematch", op: "decline" }));
    expect(a.last("rematch")!.rematch).toMatchObject({ requests: [], declinedBy: jb.playerId });
    clock.advance(1500);
    await room.message(a, JSON.stringify({ t: "rematch", op: "request" }));
    clock.advance(1500);
    await room.message(a, JSON.stringify({ t: "rematch", op: "cancel" }));
    expect(b.last("rematch")!.rematch.requests).toEqual([]);
    await room.message(b, JSON.stringify({ t: "bye" }));
    expect(b.closed).toBe(4002);
    expect(a.last("rematch")!.rematch.departed).toEqual([jb.playerId]);
    expect(a.last("rematch")!.rematch.blocked).toBeTruthy();
    expect(await room.authenticate(jb.token)).toBeNull();
    clock.advance(1500);
    await room.message(a, JSON.stringify({ t: "rematch", op: "request" }));
    expect(a.last("error")!.code).toBe("REMATCH");
    await room.message(a, JSON.stringify({ t: "bye" }));
    expect(room.isClosed).toBe(true);
    void ja;
  });

  it("일일 한도에 걸리면 새 경기를 시작하지 않고 이유를 알린다", async () => {
    const { room, a, b, cmd, playOut, clock } = await setup({ allowMatch: () => "오늘은 온라인 경기를 더 할 수 없어요." });
    await cmd(a, { type: "start" });
    await playOut();
    const id = room.match.matchId;
    await room.message(a, JSON.stringify({ t: "rematch", op: "request" }));
    clock.advance(1500);
    await room.message(b, JSON.stringify({ t: "rematch", op: "request" }));
    expect(room.match.matchId).toBe(id);
    expect(room.match.status).toBe("finished");
    expect(a.last("rematch")!.rematch.blocked).toContain("오늘");
  });

  it("진행 중에는 재대결·퇴장 메시지가 무시된다", async () => {
    const { room, a, cmd } = await setup();
    await cmd(a, { type: "start" });
    await room.message(a, JSON.stringify({ t: "rematch", op: "request" }));
    expect(a.last("error")!.code).toBe("REMATCH");
    await room.message(a, JSON.stringify({ t: "bye" }));
    expect(room.match.status).toBe("playing");
    expect(a.closed).toBeNull();
  });
});

describe("프리셋 채팅·이모티콘", () => {
  it("장착하지 않은 항목 거절은 그 ID를 알려 준다", async () => {
    const { room, a, cmd } = await setup();
    await cmd(a, { type: "start" });
    await room.message(a, JSON.stringify({ t: "say", id: "emote.fire" }));
    expect(a.last("error")).toMatchObject({ code: "INVALID_SOCIAL", id: "emote.fire" });
  });

  it("카탈로그 ID만 전달, 임의 문자열·허용되지 않은 ID 거부, 저장·재생 없음, 게임 상태 불변", async () => {
    const { room, a, b, ja, cmd, store } = await setup();
    await cmd(a, { type: "start" });
    const before = { version: room.match.version, writes: store.writes, deadline: room.match.turn!.deadline };
    await room.message(a, JSON.stringify({ t: "say", id: "chat.hello" }));
    expect(b.last("said")).toEqual({ t: "said", from: ja.playerId, id: "chat.hello" });
    expect(a.last("said")).toEqual({ t: "said", from: ja.playerId, id: "chat.hello" }); // echo
    await room.message(a, JSON.stringify({ t: "say", id: "안녕 바보야" }));
    await room.message(a, JSON.stringify({ t: "say", id: "chat.premium_gold" }));
    await room.message(a, JSON.stringify({ t: "say", text: "free text" }));
    expect(b.all("said")).toHaveLength(1);
    expect(a.all("error").map((e) => e.code)).toEqual(["INVALID_SOCIAL", "INVALID_SOCIAL", "INVALID_COMMAND"]);
    expect({ version: room.match.version, writes: store.writes, deadline: room.match.turn!.deadline }).toEqual(before);
    // A reconnecting screen does not get past messages again.
    const c = new Conn();
    room.connect(c);
    await room.message(c, JSON.stringify({ t: "hello", token: (await Promise.resolve(ja)).token }));
    expect(c.all("said")).toHaveLength(0);
    // Nothing said is stored (the stored looks list what may be sent, not what was sent).
    const { looks: _looks, ...stored } = store.record as Record<string, unknown>;
    expect(JSON.stringify(stored)).not.toContain("chat.hello");
    expect(JSON.stringify(store.record)).not.toContain("said");
  });

  it("도배 제한: 연속 3개 후 2초당 1개, 같은 항목은 1.5초 안에 반복 불가", async () => {
    const { room, a, b, clock } = await setup();
    for (const id of ["emote.clap", "emote.smile", "chat.thanks", "chat.great"]) await room.message(a, JSON.stringify({ t: "say", id }));
    expect(b.all("said")).toHaveLength(3);
    // the refusal names the item and says exactly how long to wait (the page shows it, never "sent")
    expect(a.last("error")).toMatchObject({ code: "SOCIAL_RATE_LIMITED", id: "chat.great", retryMs: 2000 });
    clock.advance(2100);
    await room.message(a, JSON.stringify({ t: "say", id: "emote.party" }));
    expect(b.all("said")).toHaveLength(4);
    const bucket = newSocialBucket(0);
    expect(allowSocial(bucket, "emote.clap", 0)).toBe(true);
    expect(allowSocial(bucket, "emote.clap", 1000)).toBe(false);
    expect(allowSocial(bucket, "emote.clap", 1600)).toBe(true);
    // the page's prediction (same function) agrees with the server: wait for the same item, then for a token
    const b2 = newSocialBucket(0);
    for (const id of ["a", "b", "c"]) allowSocial(b2, id, 0);
    expect(socialRetryMs(b2, "d", 0)).toBe(2000);
    expect(socialRetryMs(b2, "c", 1000)).toBe(1000);
    const b3 = newSocialBucket(0);
    allowSocial(b3, "x", 0);
    expect(socialRetryMs(b3, "x", 500)).toBe(1000); // same item: 1.5 s gap
    expect(socialRetryMs(b3, "y", 500)).toBe(0);
  });

  it("카탈로그 ID는 고유하고 형식이 안정적이며 무료 기본 항목만 보낼 수 있다", () => {
    const ids = SOCIAL_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of SOCIAL_ITEMS) {
      expect(item.id).toMatch(/^(chat|emote)\.[a-z_]+$/);
      expect(item.id.startsWith(item.kind + ".")).toBe(true);
      // Without an equipped set only the free default items can be sent.
      expect(canSend(item.id)).toBe(item.acquisition === "default");
    }
    // Phase 3 ids keep their meaning (inventories and old clients refer to them).
    for (const [id, text] of [["chat.hello", "안녕하세요!"], ["chat.nice", "잘했어요!"], ["chat.rematch", "한 판 더?"], ["emote.clap", "👏"], ["emote.fire", "🔥"], ["emote.handshake", "🤝"]])
      expect(SOCIAL_ITEMS.find((i) => i.id === id)?.text).toBe(text);
    expect(SOCIAL_ITEMS.filter((i) => i.acquisition === "default" && i.kind === "emote").map((i) => i.text)).toEqual(["🙂", "🎉", "👏", "👍"]);
    expect(SOCIAL_ITEMS.filter((i) => i.acquisition === "default" && i.kind === "chat").map((i) => i.text)).toEqual(["안녕하세요!", "화이팅!", "대단해요!", "감사합니다!", "좋은 경기였어요!", "잘 부탁해요!"]);
    expect(canSend("chat.nice", new Set(["chat.nice"]))).toBe(true); // equipped shop item
    expect(canSend("chat.hello", new Set())).toBe(false); // not owned
    expect(canSend(42)).toBe(false);
  });
});

describe("실시간 관전 (읽기 전용)", () => {
  const watcher = async (room: OnlineRoom, key: string) => {
    const c = new Conn();
    room.connect(c);
    await room.message(c, JSON.stringify({ t: "watch", key }));
    return c;
  };
  it("방장이 관전을 열어야 관전 키가 생기고(일반 참가자는 바꿀 수 없음), 관전자는 중립 시점의 공개 정보만 받으며 조작할 수 없다", async () => {
    const { room, a, b, ja, jb, cmd, clock } = await setup();
    await cmd(a, { type: "start" });
    // Default private: a guessed key is refused.
    expect(a.last("spectate")?.spectate ?? room.spectateState()).toMatchObject({ active: false, key: null, visibility: "private", hostControl: true, host: ja.playerId });
    expect((await watcher(room, "x".repeat(24))).closed).toBe(4003);
    // A non-host player cannot open it (server-checked), whatever the page sends.
    await room.message(b, JSON.stringify({ t: "spectate", allow: true, visibility: "public" }));
    expect(b.last("error")!.code).toBe("NOT_HOST");
    expect(b.last("spectate")!.spectate).toMatchObject({ active: false, key: null, visibility: "private" });
    clock.advance(1100);
    // The host (an older page sends {allow:true} only = link spectating).
    await room.message(a, JSON.stringify({ t: "spectate", allow: true }));
    const state = a.last("spectate")!.spectate;
    expect(state).toMatchObject({ active: true, visibility: "invite" });
    expect(state.allow).toEqual({ [ja.playerId]: true, [jb.playerId]: true });
    expect(state.key).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(state.sid).toMatch(/^[A-Z2-9]{10}$/);
    expect(b.last("spectate")!.spectate).toMatchObject({ active: true, visibility: "invite", host: ja.playerId });
    expect((await watcher(room, "y".repeat(24))).closed).toBe(4003); // wrong key
    const w = await watcher(room, state.key!);
    expect(w.closed).toBeNull();
    const welcome = w.last("watching")!;
    expect(welcome.view.you).toBeNull();
    expect(welcome.view.legal).toBeNull();
    // The spectator learns the spectate id, never the room (= invite) code.
    expect(welcome.code).toBe(state.sid);
    const text = JSON.stringify(w.sent);
    expect(text).not.toContain(ja.token);
    expect(text).not.toContain(jb.token);
    expect(text).not.toContain("ABCDEF");
    expect(text).not.toContain('"by"'); // no command ids of the players
    expect(a.last("spectate")!.spectate.spectators).toBe(1);
    // live updates: roll + hold order
    await cmd(a, { type: "roll", keep: [] });
    expect(w.last("view")!.view.turn!.rolls).toBe(1);
    await room.message(a, JSON.stringify({ t: "hold", keep: [2, 0], n: 1 }));
    expect(w.last("hold")!.keep).toEqual([2, 0]);
    // a spectator cannot act, take a seat with someone else's id or its own watch key, or chat
    const version = room.match.version;
    for (const frame of [{ t: "cmd", id: "x1", action: { type: "roll", keep: [] } }, { t: "say", id: "chat.hello" }, { t: "rematch", op: "request" }, { t: "spectate", allow: false }, { t: "hello", token: "z".repeat(40) }, { t: "hello", token: state.key }])
      await room.message(w, JSON.stringify(frame));
    expect(room.match.version).toBe(version);
    expect(w.all("error").every((e) => e.code === "SPECTATOR")).toBe(true);
    expect(b.all("said")).toHaveLength(0);
    // a fresh socket cannot use the watch key as a seat token either
    const intruder = new Conn();
    room.connect(intruder);
    await room.message(intruder, JSON.stringify({ t: "hello", token: state.key }));
    expect(intruder.last("welcome")).toBeUndefined();
    expect(room.match.players).toHaveLength(2);
    // players' chat is visible to spectators
    await room.message(b, JSON.stringify({ t: "say", id: "emote.clap" }));
    expect(w.last("said")!.id).toBe("emote.clap");
  });

  it("관전자 수 제한, 방장의 비공개 전환 시 즉시 종료·이전 링크 무효, 최종 결과와 재대결도 이어서 관전", async () => {
    const { room, a, b, cmd, playOut, clock } = await setup();
    await room.message(a, JSON.stringify({ t: "spectate", allow: true, visibility: "invite" }));
    const key = a.last("spectate")!.spectate.key!;
    const ws = [];
    for (let i = 0; i < ROOM_LIMITS.maxSpectators; i++) ws.push(await watcher(room, key));
    expect(ws.every((w) => w.closed === null)).toBe(true);
    expect((await watcher(room, key)).closed).toBe(4005);
    await cmd(a, { type: "start" });
    await playOut();
    // D-027: the final result reaches the spectators; the link stays valid.
    expect(ws[0].last("view")!.view.status).toBe("finished");
    expect(ws.every((w) => w.closed === null)).toBe(true);
    clock.advance(1100);
    await room.message(a, JSON.stringify({ t: "rematch", op: "request" }));
    clock.advance(1100);
    await room.message(b, JSON.stringify({ t: "rematch", op: "request" }));
    expect(ws[0].last("view")!.view.matchId).toBe(room.match.matchId);
    expect(ws[0].last("view")!.view.status).toBe("playing");
    // A non-host cannot revoke either; only the host's choice changes the range.
    clock.advance(1100);
    await room.message(b, JSON.stringify({ t: "spectate", allow: false }));
    expect(b.last("error")!.code).toBe("NOT_HOST");
    expect(ws.every((w) => w.closed === null)).toBe(true);
    await room.message(a, JSON.stringify({ t: "spectate", allow: false, visibility: "private" }));
    expect(ws.every((w) => w.closed === 4003)).toBe(true);
    expect((await watcher(room, key)).closed).toBe(4003);
    expect(b.last("spectate")!.spectate).toMatchObject({ active: false, visibility: "private", key: null });
    clock.advance(1100);
    await room.message(a, JSON.stringify({ t: "spectate", allow: true, visibility: "invite" }));
    const fresh = a.last("spectate")!.spectate.key!;
    expect(fresh).not.toBe(key);
    expect((await watcher(room, fresh)).closed).toBeNull();
  });

  it("공개는 방장이 고를 때만 목록에 오르고 목록은 관전 ID만 보이며, 공개→링크 축소 시 목록 키만 폐기한다", async () => {
    const { room, a, b, cmd, playOut, clock } = await setup();
    await cmd(a, { type: "start" });
    expect(room.publicEntry()).toBeNull();
    await room.message(a, JSON.stringify({ t: "spectate", allow: true, visibility: "invite" }));
    expect(room.publicEntry()).toBeNull();
    expect(room.publicWatchKey()).toBeNull();
    const inviteKey = a.last("spectate")!.spectate.key!;
    const linkViewer = await watcher(room, inviteKey);
    expect(linkViewer.closed).toBeNull();
    clock.advance(1100);
    await room.message(a, JSON.stringify({ t: "spectate", allow: true, visibility: "public" }));
    const entry = room.publicEntry()!;
    const sid = a.last("spectate")!.spectate.sid!;
    expect(entry).toMatchObject({ id: sid, code: sid, kind: "friend", status: "playing", participants: 2, round: 1, spectators: 1 });
    expect(JSON.stringify(entry)).not.toContain("ABCDEF");
    expect(b.last("spectate")!.spectate.visibility).toBe("public");
    // widening keeps the link key; the list hands out its own key
    expect(a.last("spectate")!.spectate.key).toBe(inviteKey);
    expect(linkViewer.closed).toBeNull();
    const publicKey = room.publicWatchKey()!;
    expect(publicKey).not.toBe(inviteKey);
    const listViewer = await watcher(room, publicKey);
    expect(listViewer.closed).toBeNull();
    // public → link: list viewers out, the list key dead, link viewers stay
    await room.message(a, JSON.stringify({ t: "spectate", allow: true, visibility: "invite" }));
    expect(room.publicEntry()).toBeNull();
    expect(listViewer.closed).toBe(4003);
    expect(linkViewer.closed).toBeNull();
    expect((await watcher(room, publicKey)).closed).toBe(4003);
    expect(a.last("spectate")!.spectate.visibility).toBe("invite");
    // a finished match leaves the list at once even when public; the link still shows the result
    clock.advance(1100);
    await room.message(a, JSON.stringify({ t: "spectate", allow: true, visibility: "public" }));
    expect(room.publicEntry()).not.toBeNull();
    await playOut();
    expect(room.publicEntry()).toBeNull();
    expect(room.publicWatchKey()).toBeNull();
    expect(linkViewer.closed).toBeNull();
    expect(linkViewer.last("view")!.view.status).toBe("finished");
  });

  it("방장을 넘기면 관전 설정은 유지되고 새 방장만 바꿀 수 있다", async () => {
    const { room, a, b, ja, jb, clock } = await setup();
    await room.message(a, JSON.stringify({ t: "spectate", allow: true, visibility: "invite" }));
    const key = a.last("spectate")!.spectate.key!;
    const w = await watcher(room, key);
    clock.advance(1100);
    await room.message(a, JSON.stringify({ t: "host", to: jb.playerId }));
    expect(room.lobbyState().hostId).toBe(jb.playerId);
    expect(a.last("spectate")!.spectate).toMatchObject({ visibility: "invite", host: jb.playerId, key });
    expect(w.closed).toBeNull();
    await room.message(a, JSON.stringify({ t: "spectate", allow: false, visibility: "private" }));
    expect(a.last("error")!.code).toBe("NOT_HOST");
    expect(w.closed).toBeNull();
    await room.message(b, JSON.stringify({ t: "spectate", allow: false, visibility: "private" }));
    expect(w.closed).toBe(4003);
    expect(a.last("spectate")!.spectate).toMatchObject({ visibility: "private", host: jb.playerId });
    expect(ja.playerId).not.toBe(jb.playerId);
  });

  it("대기실에 새 플레이어가 들어와도 방장이 정한 범위는 유지되고, 새 플레이어도 현재 범위를 본다", async () => {
    let t = 1;
    const room = OnlineRoom.create("ABCDEF", { now: () => t, save: () => {}, schedule: () => {} });
    const ja = await room.join("민수");
    if (!ja.ok) throw Error();
    const a = new Conn();
    room.connect(a);
    await room.message(a, JSON.stringify({ t: "hello", token: ja.token }));
    await room.message(a, JSON.stringify({ t: "spectate", allow: true }));
    const key = a.last("spectate")!.spectate.key!;
    const w = await watcher(room, key);
    expect(w.closed).toBeNull();
    t += 10;
    const jb = await room.join("지민");
    if (!jb.ok) throw Error();
    expect(w.closed).toBeNull();
    const b = new Conn();
    room.connect(b);
    await room.message(b, JSON.stringify({ t: "hello", token: jb.token }));
    expect(b.last("welcome")!.spectate).toMatchObject({ active: true, visibility: "invite", host: ja.playerId });
  });

  it("호스트 제어 이전 기록(구 Worker)은 전원 허용일 때만 링크 관전이고 새 플레이어가 들어오면 멈추며, 공개는 소급되지 않는다", async () => {
    const store = { record: null as RoomRecord | null };
    let t = 1;
    const deps = { now: () => t, save: (r: RoomRecord) => void (store.record = JSON.parse(JSON.stringify(r))), schedule: () => {} };
    const first = OnlineRoom.create("ABCDEF", deps, { seats: 3 });
    const ja = await first.join("민수");
    const jb = await first.join("지민");
    if (!ja.ok || !jb.ok) throw Error();
    // What an older Worker stored: per-player consent and one key, no host range, no spectate id.
    const legacy: RoomRecord = { ...store.record!, spectate: { allow: { [ja.playerId]: true, [jb.playerId]: true }, key: "L".repeat(24), publicAllow: { [ja.playerId]: true, [jb.playerId]: true } } };
    const room = OnlineRoom.restore(legacy, deps);
    expect(room.spectateState()).toMatchObject({ active: true, visibility: "invite" });
    expect(room.publicSpectating()).toBe(false);
    const w = await watcher(room, "L".repeat(24));
    expect(w.closed).toBeNull();
    expect(w.last("watching")!.code).toBe("ABCDEF"); // legacy links already carried the code
    t += 10;
    await room.join("하늘");
    expect(w.closed).toBe(4003);
    expect(room.spectateState()).toMatchObject({ active: false, visibility: "private" });
  });
});
