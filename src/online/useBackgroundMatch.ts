import { useEffect, useRef, useState } from "react";
import { playSfx } from "../sound";
import { QuickMatch, pendingQuick, serverFeatures, type QuickMatched } from "./client";

export type MatchState =
  | { phase: "idle" }
  | { phase: "connecting" | "waiting" | "reconnecting" | "cancelling" | "pairing"; since: number }
  | { phase: "matched" | "entering"; match: QuickMatched }
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
};

export function useBackgroundMatch(server: string | null, onMatched: (match: QuickMatched) => void): MatchController {
  const [state, update] = useState<MatchState>({ phase: "idle" });
  const [display, setDisplay] = useState<MatchController["display"]>("hidden");
  const transport = useRef<QuickMatch | null>(null);
  const request = useRef<object | null>(null);
  const handoff = useRef(onMatched);
  handoff.current = onMatched;
  const serverRef = useRef(server);
  serverRef.current = server;

  const start = (name: string) => {
    if (!server || request.current) return;
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
          transport.current = null;
          playSfx("join");
          update({ phase: "matched", match });
          window.dispatchEvent(new CustomEvent("yachtlab-match-found", { detail: { code: match.code, opponent: match.opponent } }));
          handoff.current(match);
          update({ phase: "entering", match });
        },
        onEnd(code, message, room) {
          request.current = null;
          transport.current = null;
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
    const saved = pendingQuick();
    if (saved && (!saved.base || saved.base === serverRef.current)) start(saved.name);
  };

  useEffect(() => {
    reconnect();
    return () => {
      request.current = null;
      transport.current?.stop();
      transport.current = null;
    };
  }, [server]);

  return {
    state, display, setDisplay, start, reconnect,
    cancel() {
      if (!transport.current) {
        if (request.current && state.phase === "connecting") {
          request.current = null;
          update({ phase: "idle" });
          setDisplay("hidden");
        }
        return;
      }
      if ("since" in state) update({ phase: "cancelling", since: state.since });
      transport.current.cancel();
    },
    entered() {
      request.current = null;
      update({ phase: "idle" });
      setDisplay("hidden");
    },
    entryFailed(message, room) {
      request.current = null;
      setDisplay("expanded");
      update({ phase: "error", code: "ENTRY_FAILED", message, room });
    },
  };
}
