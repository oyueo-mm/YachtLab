import { useEffect, useRef, useState } from "react";

/** True for `ms` right after `achieved` flips from false to true while mounted (never on first render). */
export function useJustAchieved(achieved: boolean, ms = 2800) {
  const prev = useRef(achieved);
  const [just, setJust] = useState(false);
  useEffect(() => {
    if (achieved && !prev.current) {
      setJust(true);
      prev.current = achieved;
      const timer = window.setTimeout(() => setJust(false), ms);
      return () => window.clearTimeout(timer);
    }
    prev.current = achieved;
    if (!achieved) setJust(false);
  }, [achieved, ms]);
  return just;
}
