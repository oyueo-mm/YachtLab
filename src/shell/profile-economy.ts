import { useEffect, useState, useSyncExternalStore } from "react";
import { session } from "../identity/account-client";
import { economy, type Snapshot } from "../identity/economy-client";

function subscribeSession(notify: () => void) {
  window.addEventListener("yachtlab-session", notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener("yachtlab-session", notify);
    window.removeEventListener("storage", notify);
  };
}

export function useProfileEconomy(server: string | null, atHome: boolean) {
  const account = useSyncExternalStore(subscribeSession, session);
  const [result, setResult] = useState<{ account: string; server: string; snapshot: Snapshot } | null>(null);
  useEffect(() => {
    if (!account || !server) {
      setResult(null);
      return;
    }
    let active = true;
    let changed = false;
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ server: string; account: string; snapshot: Snapshot }>).detail;
      if (detail.server !== server || detail.account !== account) return;
      changed = true;
      setResult(detail);
    };
    window.addEventListener("yachtlab-economy", update);
    void economy(server)
      .then((snapshot) => {
        if (active && !changed) setResult({ account, server, snapshot });
      })
      .catch(() => {
        if (active && !changed) setResult(null);
      });
    return () => {
      active = false;
      window.removeEventListener("yachtlab-economy", update);
    };
  }, [account, server, atHome]);
  return {
    signedIn: !!account,
    snapshot: result?.account === account && result.server === server ? result.snapshot : null,
  };
}

