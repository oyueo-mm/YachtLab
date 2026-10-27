import { useEffect, useRef, type MutableRefObject } from "react";
import { createDecisionSession, runJob } from "./client";
import { names, score, type Action, type Game } from "./engine";
import type { Algorithm, Decision } from "./ai";
import { humanAITiming as T, playbackDelay } from "./playback";
export function useHumanTurn({
  stateRef,
  algorithm,
  trigger,
  retry,
  generation,
  session,
  job,
  commit,
  setBusy,
  setError,
  setLast,
  setCaption,
  paused,
  pausedRef,
}: {
  stateRef: MutableRefObject<Game>;
  algorithm: Algorithm;
  trigger: number;
  retry: number;
  generation: MutableRefObject<number>;
  session: MutableRefObject<ReturnType<typeof createDecisionSession> | null>;
  job: MutableRefObject<ReturnType<typeof runJob<Decision>> | null>;
  commit: (a: Action, d?: Decision) => Game;
  setBusy: (v: boolean) => void;
  setError: (v: string) => void;
  setLast: (d: Decision) => void;
  setCaption: (v: string) => void;
  paused: boolean;
  pausedRef: MutableRefObject<boolean>;
}) {
  const pendingRoll = useRef(false),
    previousGeneration = useRef(generation.current);
  useEffect(() => {
    if (previousGeneration.current !== generation.current) {
      previousGeneration.current = generation.current;
      pendingRoll.current = false;
    }
    if (paused) return;
    if (stateRef.current.player !== 1 || stateRef.current.done) {
      setBusy(false);
      return;
    }
    const controller = new AbortController(),
      signal = controller.signal,
      gen = generation.current;
    const valid = () =>
      !signal.aborted && !pausedRef.current && gen === generation.current;
    setBusy(true);
    (async () => {
      try {
        await playbackDelay(T.start, signal);
        if (pendingRoll.current) {
          if (!valid()) return;
          commit({ type: "roll" });
          pendingRoll.current = false;
          setCaption("나머지 주사위를 다시 굴렸습니다");
          await playbackDelay(T.reroll, signal);
        }
        if (!stateRef.current.rolls) {
          commit({ type: "roll" });
          setCaption("주사위를 굴렸습니다");
          await playbackDelay(T.firstRoll, signal);
        }
        while (
          valid() &&
          !stateRef.current.done &&
          stateRef.current.player === 1
        ) {
          if (!session.current) session.current = createDecisionSession();
          const active = session.current;
          job.current = {
            promise: active.decide(stateRef.current, algorithm),
            cancel: () => {
              active.cancel();
              if (session.current === active) session.current = null;
            },
          };
          const d = await job.current.promise;
          await playbackDelay(1, signal);
          if (!valid()) return;
          setLast(d);
          if (d.type === "reroll") {
            commit({ type: "hold", ids: d.ids }, d);
            pendingRoll.current = true;
            const values = d.ids.map(
              (id) => stateRef.current.dice.find((x) => x.id === id)!.value,
            );
            setCaption(
              values.length
                ? `${values.join("·")} 주사위 ${values.length}개를 고정했습니다`
                : "모든 주사위를 다시 굴립니다",
            );
            await playbackDelay(T.hold, signal);
            if (!valid()) return;
            commit({ type: "roll" });
            pendingRoll.current = false;
            setCaption("나머지 주사위를 다시 굴렸습니다");
            await playbackDelay(T.reroll, signal);
          } else {
            const points = score(
              stateRef.current.dice.map((x) => x.value),
              d.category,
            );
            commit({ type: "score", category: d.category }, d);
            setCaption(`${names[d.category]}에 ${points}점 기록`);
            await playbackDelay(T.score, signal);
            break;
          }
        }
      } catch (e) {
        if (valid()) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (valid()) setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [trigger, retry, algorithm, paused]);
}
