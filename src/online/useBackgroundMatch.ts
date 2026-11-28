import { useEffect, useRef, useState } from "react";
import { playSfx } from "../sound";
import { QuickMatch, pendingQuick, savedSeat, serverFeatures, type QuickMatched } from "./client";
import { tabId } from "../identity/friends-client";
import { LOCK_BEAT_MS, MATCH_COUNTDOWN_MS, beatLock, claimLock, forgetMatched, matchedNotEntered, otherTabWaiting, releaseLock, rememberMatched, tabChannel, type TabMessage } from "./match-flow";

export type MatchState =
  | { phase: "idle" }
  | { phase: "connecting" | "waiting" | "reconnecting" | "cancelling" | "pairing"; since: number }
  /** A6: paired; the room is running. `until` = automatic entry (countdown), `enterNow()` skips it. */
  | { phase: "matched"; match: QuickMatched; until: number }
  | { phase: "entering"; match: QuickMatched }
  /** A6: another tab of this browser owns the wait (`cancelOther()` asks it to cancel). */
  | { phase: "elsewhere"; since: number }
  | { phase: "error"; code: string; message: string; room?: string };

export type MatchController = {
  state: MatchState;
  display: "hidden" | "minimized" | "expanded";
  setDisplay: (display: "hidden" | "minimized" | "expanded") => void;
  start: (name: string) => void;
  cancel: () => void;
  reconnect: () => void;
  entered: () => void;
  entryFailed: (message: string, room: string) => void;
  /** A6: skip the countdown. */
  enterNow: () => void;
  /** A6: ask the tab that owns the wait to cancel it. */
  cancelOther: () => void;
};

/**
 * `countdownMs()` is asked when a pairing arrives (A6: 3 s, 5 s while a local AI game is put aside).
 * The C3 contract is unchanged otherwise (docs/online/C3-BACKGROUND-MATCH.md, docs/online/SOC-1-SOCIAL.md).
 */
export function useBackgroundMatch(server: string | null, onMatched: (match: QuickMatched) => void, countdownMs: () => number = () => MATCH_COUNTDOWN_MS): MatchController {
  const [state, update] = useState<MatchState>({ phase: "idle" });
  const [display, setDisplay] = useState<MatchController["display"]>("hidden");
  const transport = useRef<QuickMatch | null>(null);
  const request = useRef<object | null>(null);
  const handoff = useRef(onMatched);
  handoff.current = onMatched;
  const serverRef = useRef(server);
  serverRef.current = server;
  const countdown = useRef(countdownMs);
  countdown.current = countdownMs;
  const tab = useRef("");
  if (!tab.current) tab.current = tabId();
  const entryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const beat = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const channel = useRef<ReturnType<typeof tabChannel> | null>(null);
  const cancelRef = useRef<() => void>(() => undefined);
  const stopBeat = () => {
    clearInterval(beat.current);
    beat.current = undefined;
    releaseLock(tab.current);
  };
  /** Enter the paired match now (countdown over or skipped). Idempotent. */
  const go = (match: QuickMatched) => {
    clearTimeout(entryTimer.current);
    entryTimer.current = undefined;
    handoff.current(match);
    update({ phase: "entering", match });
  };
  const paired = (match: QuickMatched, at = Date.now(), wait = countdown.current()) => {
    transport.current = null;
    stopBeat();
    rememberMatched({ code: match.code, opponent: match.opponent, at });
    channel.current?.post({ t: "matched", from: tab.current, code: match.code });
    const until = at + Math.max(0, wait);
    update({ phase: "matched", match, until });
    setDisplay("expanded");
    clearTimeout(entryTimer.current);
    entryTimer.current = setTimeout(() => go(match), Math.max(0, until - Date.now()));
  };

  const start = (name: string) => {
    if (!server || request.current) return;
    // A6: one wait per browser. Another tab's fresh lock → show it instead of opening a second ticket.
    const claim = claimLock(tab.current, Date.now());
    if (!claim.ok) {
      setDisplay("expanded");
      return update({ phase: "elsewhere", since: claim.holder.at });
    }
    clearInterval(beat.current);
    beat.current = setInterval(() => beatLock(tab.current, Date.now()), LOCK_BEAT_MS);
    const attempt = {};
    request.current = attempt;
    const saved = pendingQuick();
    const resume = saved && (!saved.base || saved.base === server) ? saved : null;
    const since = resume?.at ?? Date.now();
    setDisplay("expanded");
    update({ phase: resume?.cancelling ? "cancelling" : "connecting", since });
    void serverFeatures(server).then((features) => {
      if (request.current !== attempt) return;
      if (!features.quickMatch) {
        request.current = null;
        stopBeat();
        return update({ phase: "error", code: "UNAVAILABLE", message: "빠른 대전을 사용할 수 없어요." });
      }
      let queuedAt = since;
      transport.current = new QuickMatch(server, { name, spectate: true, resume, background: features.backgroundMatch }, {
        onQueued(at) {
          queuedAt = at;
          update({ phase: "waiting", since: at });
        },
        onReconnect() {
          if (!transport.current?.pending.cancelling) update({ phase: "reconnecting", since: queuedAt });
        },
        onPairing() {
          update({ phase: "pairing", since: queuedAt });
        },
        onMatched(match) {
          // A cancel that crossed the pairing loses: the server already made the room (C3), so it is entered.
          playSfx("join");
          window.dispatchEvent(new CustomEvent("yachtlab-match-found", { detail: { code: match.code, opponent: match.opponent } }));
          paired(match);
        },
        onEnd(code, message, room) {
          request.current = null;
          transport.current = null;
          stopBeat();
          channel.current?.post({ t: "ended", from: tab.current });
          if (code === "CANCELLED") {
            update({ phase: "idle" });
            setDisplay("hidden");
          } else {
            update({ phase: "error", code, message, room });
          }
        },
      });
      transport.current.start();
    });
  };

  const reconnect = () => {
    // A6: a reload during the countdown enters the same match (its seat was saved when it was paired).
    const note = matchedNotEntered(Date.now());
    const seat = note ? savedSeat(note.code) : null;
    if (note && seat && !request.current) {
      request.current = {};
      return paired({ code: note.code, playerId: seat.playerId, token: seat.token, name: seat.name ?? "", opponent: note.opponent, public: true }, Date.now(), 0);
    }
    const saved = pendingQuick();
    if (saved && (!saved.base || saved.base === serverRef.current)) start(saved.name);
    else if (state.phase === "error" && state.code === "NETWORK") {
      update({ phase: "idle" });
      setDisplay("hidden");
    }
  };

  useEffect(() => {
    channel.current = tabChannel((m: TabMessage) => {
      if (m.from === tab.current) return;
      // The owner of the wait cancels when another tab asks (the user pressed "매칭 취소" there).
      if (m.t === "cancel-request" && transport.current) cancelRef.current();
      if ((m.t === "ended" || m.t === "matched") && !request.current) {
        update((cur) => (cur.phase === "elsewhere" ? { phase: "idle" } : cur));
      }
    });
    reconnect();
    return () => {
      request.current = null;
      transport.current?.stop();
      transport.current = null;
      clearTimeout(entryTimer.current);
      stopBeat();
      channel.current?.close();
      channel.current = null;
    };
  }, [server]);
  // "elsewhere" clears itself when the other tab's lock goes stale (closed without a goodbye).
  useEffect(() => {
    if (state.phase !== "elsewhere") return;
    const t = setInterval(() => {
      if (!otherTabWaiting(tab.current, Date.now())) {
        update({ phase: "idle" });
        setDisplay("hidden");
      }
    }, LOCK_BEAT_MS);
    return () => clearInterval(t);
  }, [state.phase]);

  const cancel = () => {
    if (state.phase === "elsewhere") {
      update({ phase: "idle" });
      return setDisplay("hidden");
    }
    if (!transport.current) {
      if (request.current && state.phase === "connecting") {
        request.current = null;
        stopBeat();
        update({ phase: "idle" });
        setDisplay("hidden");
      }
      return;
    }
    if ("since" in state) update({ phase: "cancelling", since: state.since });
    transport.current.cancel();
  };
  cancelRef.current = cancel;

  return {
    state, display, setDisplay, start, reconnect, cancel,
    enterNow() {
      if (state.phase === "matched") go(state.match);
    },
    cancelOther() {
      channel.current?.post({ t: "cancel-request", from: tab.current });
    },
    entered() {
      request.current = null;
      forgetMatched();
      update({ phase: "idle" });
      setDisplay("hidden");
    },
    entryFailed(message, room) {
      request.current = null;
      forgetMatched();
      setDisplay("expanded");
      update({ phase: "error", code: "ENTRY_FAILED", message, room });
    },
  };
}
