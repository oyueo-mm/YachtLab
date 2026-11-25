import { useState, type ComponentType } from "react";
import type { ReviewSource } from "./sources";

type DialogProps = { source: ReviewSource; close: () => void };

export default function ReviewLauncher({ source }: { source: () => ReviewSource | Promise<ReviewSource> }) {
  const [opened, open] = useState<{ source: ReviewSource; Dialog: ComponentType<DialogProps> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  async function show() {
    setLoading(true);
    setFailed(false);
    try {
      const { default: Dialog } = await import("./ReviewDialog");
      let match: ReviewSource;
      try { match = await source(); }
      catch { match = "기보를 읽을 수 없어요. 원본 경기 기록은 그대로 저장돼 있어요."; }
      open({ source: match, Dialog });
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <button type="button" className="secondary" disabled={loading} onClick={() => void show()}>AI 복기</button>
      {loading && <span role="status">복기 화면을 불러오는 중…</span>}
      {failed && <span role="alert">복기 화면을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.</span>}
      {opened && <opened.Dialog source={opened.source} close={() => open(null)} />}
    </>
  );
}
