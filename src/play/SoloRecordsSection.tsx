import { useEffect, useMemo, useState } from "react";
import { soloStats } from "../solo/records";
import { soloSyncText, syncSoloRecords, type SoloSync } from "../solo/sync";
import { useSoloRecords } from "./SoloGame";
import { SoloStatsPanel } from "./SoloStats";
import "./solo.css";

/** 내 기록 / 프로필: 1인 플레이 personal records with the account-sync status said plainly. */
export function SoloRecordsSection({ server, compact = false }: { server: string | null; compact?: boolean }) {
  const records = useSoloRecords();
  const stats = useMemo(() => soloStats(records), [records]);
  const [sync, setSync] = useState<SoloSync | null>(null);
  useEffect(() => {
    let live = true;
    void syncSoloRecords(server).then((s) => live && setSync(s));
    return () => {
      live = false;
    };
  }, [server]);
  return <SoloStatsPanel stats={stats} compact={compact} syncNote={sync ? soloSyncText[sync] : undefined} />;
}
