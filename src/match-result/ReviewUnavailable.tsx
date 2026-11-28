import { Search } from "lucide-react";

/**
 * A disabled "게임 리뷰" slot with its reason (UI-1). Shown when this screen has no reviewable record:
 * the event log was lost (reload mid-match) or the mode has no review yet (3+ players).
 */
export function ReviewUnavailable({ reason = "이 기기에 이번 경기의 진행 기록이 없어 리뷰할 수 없어요" }: { reason?: string }) {
  return (
    <button type="button" className="secondary a3-review-unavailable" disabled title={reason} aria-describedby={undefined}>
      <Search size={16} aria-hidden="true" /> 리뷰 기록 없음<span className="sr-only"> · {reason}</span>
    </button>
  );
}
