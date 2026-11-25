import { useEffect, useState, useSyncExternalStore } from "react";
import { LogIn } from "lucide-react";
import { GUEST_LOOK } from "../economy/live/catalog";
import { session } from "../identity/account-client";
import { economy, type Snapshot } from "../identity/economy-client";
import { useNickname } from "../identity/display-name";
import { PlayerTag } from "../play/Looks";
import { WalletBar } from "./EconomyPages";
import "./home-profile.css";

function subscribeSession(notify: () => void) {
  window.addEventListener("yachtlab-session", notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener("yachtlab-session", notify);
    window.removeEventListener("storage", notify);
  };
}

export function useProfileEconomy(server: string | null) {
  const account = useSyncExternalStore(subscribeSession, session);
  const [result, setResult] = useState<{ account: string; server: string; snapshot: Snapshot } | null>(null);
  useEffect(() => {
    if (!account || !server) {
      setResult(null);
      return;
    }
    let active = true;
    void economy(server)
      .then((snapshot) => {
        if (active) setResult({ account, server, snapshot });
      })
      .catch(() => {
        if (active) setResult(null);
      });
    return () => { active = false; };
  }, [account, server]);
  return {
    signedIn: !!account,
    snapshot: result?.account === account && result.server === server ? result.snapshot : null,
  };
}

export default function HomeProfile({ signedIn, snapshot, onProfile }: { signedIn: boolean; snapshot: Snapshot | null; onProfile: () => void }) {
  const name = useNickname();
  return (
    <section className="home-profile" aria-label="내 계정">
      <div className="home-profile-summary">
        <PlayerTag name={name} look={snapshot?.look ?? GUEST_LOOK} me />
        <span className={"profile-badge" + (signedIn ? " member" : "")}>{signedIn ? "회원" : "게스트"}</span>
        {signedIn && snapshot && <WalletBar snap={snapshot} />}
      </div>
      <button type="button" className="secondary home-profile-link" onClick={onProfile}>
        {!signedIn && <LogIn size={16} aria-hidden="true" />}
        {signedIn ? "내 프로필" : "로그인 안내"}
      </button>
    </section>
  );
}
