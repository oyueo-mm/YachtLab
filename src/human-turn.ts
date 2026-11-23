import { useEffect, useRef, type MutableRefObject } from "react";
import { createDecisionSession, runJob } from "./client";
import { names, score, type Action, type Category, type Game } from "./engine";
import type { Decision } from "./ai";
import type { ModelId } from "./ai-models";
import { humanAITiming, playbackDelay } from "./playback";
import { waitForDice } from "./dice-motion";
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
  setPreviewScore,
  paused,
  pausedRef,
  aiSeat = 1,
  speed = 1,
}: {
  stateRef: MutableRefObject<Game>;
  algorithm: ModelId;
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
  setPreviewScore: (v: Category | null) => void;
  paused: boolean;
  pausedRef: MutableRefObject<boolean>;
  /** Seat the AI plays (0 when the AI moves first). */
  aiSeat?: 0 | 1;
  /** Pacing multiplier for AI playback delays (setup option). */
  speed?: number;
}) {
  const T = Object.fromEntries(Object.entries(humanAITiming).map(([k, v]) => [k, Math.round(v * speed)])) as Record<keyof typeof humanAITiming, number>;
  const pendingRoll = useRef(false),
    previousGeneration = useRef(generation.current);
  useEffect(() => {
    if (previousGeneration.current !== generation.current) {
      previousGeneration.current = generation.current;
      pendingRoll.current = false;
    }
    if (paused) return;
    if (stateRef.current.player !== aiSeat || stateRef.current.done) {
      setBusy(false);
      return;
    }
    const controller = new AbortController(),
      signal = controller.signal,
      gen = generation.current;
    const valid = () =>
      !signal.aborted && !pausedRef.current && gen === generation.current;
    setBusy(true);
    setPreviewScore(null);
    (async () => {
      try {
        await playbackDelay(T.start, signal);
        await waitForDice(signal); // let a score effect finish before the AI throws
        if (pendingRoll.current) {
          if (!valid()) return;
          commit({ type: "roll" });
          pendingRoll.current = false;
          setCaption("나머지 주사위를 다시 굴렸습니다");
          await playbackDelay(T.reroll, signal);
          await waitForDice(signal);
        }
        if (!stateRef.current.rolls) {
          commit({ type: "roll" });
          setCaption("주사위를 굴렸습니다");
          await playbackDelay(T.firstRoll, signal);
          await waitForDice(signal);
        }
        while (
          valid() &&
          !stateRef.current.done &&
          stateRef.current.player === aiSeat
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
            await waitForDice(signal);
          } else {
            setPreviewScore(d.category);
            await playbackDelay(260, signal);
            if (!valid()) return;
            const points = score(
              stateRef.current.dice.map((x) => x.value),
              d.category,
            );
            commit({ type: "score", category: d.category }, d);
            setPreviewScore(null);
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
  }, [trigger, retry, algorithm, paused, aiSeat]);
}
