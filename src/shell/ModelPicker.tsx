import { useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { familyLabels, modelInfo, modelRegistry, type ModelFamily, type ModelId, type ModelStatus } from "../model-catalog";

const statusLabel: Record<ModelStatus, string> = { playable: "대전 가능", conditional: "조건부", research: "연구 전용" };
const families = Object.keys(familyLabels) as ModelFamily[];

/**
 * Every AI the project has: searchable, grouped by algorithm family, with availability.
 * Research-only entries are listed (with the reason) but cannot be selected.
 * Groups describe the algorithm type, not strength — no ranking is implied.
 */
export function ModelPicker({ value, onChange }: { value: ModelId; onChange: (id: ModelId) => void }) {
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<ModelFamily | "all">("all");
  const name = useId();
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return modelRegistry.filter(
      (m) =>
        (family === "all" || m.family === family) &&
        (!q || [m.name, m.description, familyLabels[m.family], m.condition ?? "", m.reason ?? ""].join(" ").toLowerCase().includes(q)),
    );
  }, [query, family]);
  const selected = modelInfo(value);
  const counts = useMemo(() => {
    const c = { playable: 0, conditional: 0, research: 0 } as Record<ModelStatus, number>;
    modelRegistry.forEach((m) => c[m.status]++);
    return c;
  }, []);
  return (
    <div className="model-picker">
      <p className="setup-note">
        전체 {modelRegistry.length}개 · 대전 가능 {counts.playable} · 조건부 {counts.conditional} · 연구 전용 {counts.research}. 분류는 알고리즘 유형이며 강함 순서가 아니에요.
      </p>
      <label className="model-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" aria-label="모델 검색" placeholder="이름·설명으로 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="model-families" role="group" aria-label="알고리즘 유형">
        {(["all", ...families] as const).map((f) => (
          <button type="button" key={f} aria-pressed={family === f} onClick={() => setFamily(f)}>
            {f === "all" ? "전체" : familyLabels[f]}
          </button>
        ))}
      </div>
      <div className="model-list" role="radiogroup" aria-label="연구용 알고리즘">
        {list.length === 0 && <p className="setup-note">검색 결과가 없어요.</p>}
        {list.map((m) => {
          const disabled = m.status === "research";
          return (
            <label key={m.id} className={"model-item" + (m.id === value ? " checked" : "") + (disabled ? " disabled" : "")} data-status={m.status}>
              <input type="radio" name={name} value={m.id} aria-label={m.name} checked={m.id === value} disabled={disabled} onChange={() => onChange(m.id as ModelId)} />
              <span className="model-item-head">
                <strong>{m.name}</strong>
                <span className={"model-badge model-badge-" + m.status}>{statusLabel[m.status]}</span>
              </span>
              <span className="model-item-meta">{familyLabels[m.family]}</span>
              <span className="model-item-desc">{m.description}</span>
              {disabled && m.reason && <span className="model-item-reason">선택 불가: {m.reason}</span>}
            </label>
          );
        })}
      </div>
      {selected && (
        <section className="model-detail" aria-label="선택한 모델">
          <strong>{selected.name}</strong>
          <span className={"model-badge model-badge-" + selected.status}>{statusLabel[selected.status]}</span>
          <p>{selected.description}</p>
          {selected.condition && (
            <p>
              <b>사용 조건</b> {selected.condition}
            </p>
          )}
          {selected.fallback && (
            <p>
              <b>조건 밖에서는</b> {selected.fallback} 정책이 결정해요.
            </p>
          )}
          <p className="model-detail-meta">
            계산 비용 {selected.cost} · {selected.loading}
            {selected.checkpoint ? ` · 체크포인트 ${selected.checkpoint}` : ""} · 규칙 12칸
          </p>
        </section>
      )}
    </div>
  );
}
