import { useEffect, useState } from "react";
import { saveName, savedName } from "../online/client";
import { me, session, setNickname } from "./account-client";

/**
 * One nickname for every screen (quick match, friend rooms, invites, AI match). It is edited only on
 * the profile page.
 *  - Guests: stored on this device (`savedName`, generated "요트러0000" style default when missing).
 *  - Members: the account nickname on the server is the source of truth. On sign-in / app start it is
 *    copied to this device; an account without a nickname receives the device's current name (so an
 *    existing guest name is kept when signing in for the first time). The server also uses the account
 *    nickname for a signed-in seat whatever the page sends.
 */
export function useNickname(): string {
  const [name, setName] = useState(savedName);
  useEffect(() => {
    const sync = () => setName(savedName());
    window.addEventListener("yachtlab-nickname", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("yachtlab-nickname", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return name;
}

let syncing: Promise<string | null> | null = null;
/** Members: bring the device's nickname in line with the account (once per call site; errors are ignored). */
export function syncAccountNickname(server: string | null): Promise<string | null> {
  if (!server || !session()) return Promise.resolve(null);
  syncing ??= (async () => {
    try {
      const p = await me(server);
      if (p.nickname) {
        if (p.nickname !== savedName()) saveName(p.nickname);
        return p.nickname;
      }
      const r = await setNickname(server, savedName());
      saveName(r.nickname);
      return r.nickname;
    } catch {
      return null;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}
