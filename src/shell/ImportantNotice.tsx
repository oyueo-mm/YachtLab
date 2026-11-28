import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useServerFeatures } from "./entries";

/**
 * ADMIN-1 "중요" notices as one dismissible banner (UI-1 slot for H-06-2). Shown only when the server
 * reports `features.notices === true`; reads the public `GET /api/notices` (ADMIN-1 #141 contract:
 * `{ notices: { id, title, important, kind, publishAt }[] }`). Never shown during a game (the caller
 * decides), never more than one notice, and a dismissal is remembered per notice on this device.
 */
type Notice = { id: string; title: string; important?: boolean; kind?: string };
const KEY = "yachtlab.notice-dismissed.v1";
const dismissed = (): string[] => {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
};

export function ImportantNotice({ server, onOpen }: { server: string | null; onOpen?: () => void }) {
  const features = useServerFeatures(server) as { notices?: unknown } | null;
  const enabled = features?.notices === true;
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    if (!server || !enabled) return setNotice(null);
    let live = true;
    fetch(server.replace(/\/$/, "") + "/api/notices", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { notices?: Notice[] } | null) => {
        if (!live) return;
        const gone = dismissed();
        setNotice(body?.notices?.find((n) => n.important && !gone.includes(n.id)) ?? null);
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [server, enabled]);
  if (!notice) return null;
  const close = () => {
    try { localStorage.setItem(KEY, JSON.stringify([...dismissed(), notice.id].slice(-50))); } catch { /* storage off */ }
    setNotice(null);
  };
  return (
    <div className="ui1-notice" role="status">
      <strong>{notice.kind === "maintenance" ? "점검" : "공지"}</strong>
      {onOpen ? <button type="button" className="text-button ui1-notice-title" onClick={onOpen}>{notice.title}</button> : <span className="ui1-notice-title">{notice.title}</span>}
      <button type="button" className="icon-button" aria-label="공지 닫기" onClick={close}><X size={16} aria-hidden="true" /></button>
    </div>
  );
}
