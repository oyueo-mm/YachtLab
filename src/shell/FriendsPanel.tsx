import { UsersRound } from "lucide-react";
import { Sheet } from "../ui/kit";
import type { Route } from "../routes";
import { FriendsPage, useInbox } from "./Friends";
import "./friends-panel.css";

/**
 * Header 친구 button + panel (UI-1, 2026-11-28). The panel is a modal <dialog> in the top layer —
 * a right-hand drawer on PC, a bottom sheet on phones — so opening it never moves the page.
 * Content is the existing friends screen (list, requests, add by code, status from the server's
 * inbox check); nothing is invented client-side. Spectating a friend's game and invite-from-panel
 * wait for the friends/rooms server contract (track 04).
 */
export function FriendsButton({ open, onOpen, signedIn, current = false }: { open: boolean; onOpen: () => void; signedIn: boolean; current?: boolean }) {
  const box = useInbox();
  const alerts = signedIn ? box.requests + box.invites.filter((invite) => invite.expires > Date.now()).length : 0;
  return (
    <button type="button" className="header-shop header-friends icon-button shell-icon" aria-label={alerts > 0 ? `친구 (새 알림 ${alerts}개)` : "친구"} title="친구"
      aria-haspopup="dialog" aria-expanded={open} aria-current={current ? "page" : undefined} onClick={onOpen}>
      <UsersRound size={19} aria-hidden="true" /><span>친구</span>
      {alerts > 0 && <b className="header-badge" aria-hidden="true">{alerts > 9 ? "9+" : alerts}</b>}
    </button>
  );
}

export function FriendsPanel({ open, onClose, server, navigate }: { open: boolean; onClose: () => void; server: string | null; navigate: (route: Route) => void }) {
  const go = (route: Route) => {
    onClose();
    navigate(route);
  };
  return (
    <Sheet open={open} onClose={onClose} title="친구" className="ui1-friends-panel">
      {open && <div className="ui1-friends-content"><FriendsPage server={server} go={go} /></div>}
      <button type="button" className="text-button ui1-friends-more" onClick={() => go("friends")}>친구 화면에서 크게 보기</button>
    </Sheet>
  );
}
