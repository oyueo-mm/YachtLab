import { describe, expect, it } from "vitest";
import { seededDiceSource } from "../src/online";
import { OnlineRoom, ROOM_LIMITS, type RoomConnection, type RoomRecord } from "../src/online/room";
import type { ServerMessage } from "../src/online/wire";
import { SOCIAL_ITEMS, allowSocial, canSend, newSocialBucket } from "../src/social/catalog";
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
    expect(JSON.stringify(store.record)).not.toContain("chat.hello");
  });

  it("도배 제한: 연속 3개 후 2초당 1개, 같은 항목은 1.5초 안에 반복 불가", async () => {
    const { room, a, b, clock } = await setup();
    for (const id of ["emote.clap", "emote.fire", "chat.nice", "chat.great"]) await room.message(a, JSON.stringify({ t: "say", id }));
    expect(b.all("said")).toHaveLength(3);
    expect(a.last("error")!.code).toBe("SOCIAL_RATE_LIMITED");
    clock.advance(2100);
    await room.message(a, JSON.stringify({ t: "say", id: "emote.party" }));
    expect(b.all("said")).toHaveLength(4);
    const bucket = newSocialBucket(0);
    expect(allowSocial(bucket, "emote.clap", 0)).toBe(true);
    expect(allowSocial(bucket, "emote.clap", 1000)).toBe(false);
    expect(allowSocial(bucket, "emote.clap", 1600)).toBe(true);
  });

  it("카탈로그 ID는 고유하고 형식이 안정적이며 무료 기본 항목만 보낼 수 있다", () => {
    const ids = SOCIAL_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of SOCIAL_ITEMS) {
      expect(item.id).toMatch(/^(chat|emote)\.[a-z_]+$/);
      expect(item.id.startsWith(item.kind + ".")).toBe(true);
      expect(canSend(item.id)).toBe(true);
    }
    expect(canSend("chat.hello", new Set())).toBe(false); // not owned
    expect(canSend(42)).toBe(false);
  });
});
