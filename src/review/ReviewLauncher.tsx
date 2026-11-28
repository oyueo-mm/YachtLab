import { useContext, useState, type ComponentType } from "react";
import { ActivityVisible } from "../shell/activity-visible";
import type { ReviewSource } from "./sources";

type DialogProps = { source: ReviewSource; close: () => void; position: { current: number } };

export default function ReviewLauncher({ source }: { source: () => ReviewSource | Promise<ReviewSource> }) {
  const visible = useContext(ActivityVisible);
  const [opened, open] = useState<{ source: ReviewSource; Dialog: ComponentType<DialogProps>; position: { current: number } } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  async function show() {
    setLoading(true);
    setFailed(false);
    try {
      const { default: Dialog } = await import("./ReviewPage");
      let match: ReviewSource;
      try { match = await source(); }
      catch { match = "기보를 읽을 수 없어요. 원본 경기 기록은 그대로 저장돼 있어요."; }
      open({ source: match, Dialog, position: { current: 0 } });
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <button type="button" className="secondary" disabled={loading} onClick={() => void show()}>게임 리뷰</button>
      {loading && <span role="status">리뷰 화면을 불러오는 중…</span>}
      {failed && <span role="alert">리뷰 화면을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.</span>}
      {visible && opened && <opened.Dialog position={opened.position} source={opened.source} close={() => open(null)} />}
    </>
  );
}
