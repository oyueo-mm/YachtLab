import { useId, type ReactNode } from "react";
import { ArrowLeft, Minus, Play, Plus } from "lucide-react";
import { ModelPicker } from "./ModelPicker";
import { gameDifficulties } from "../GameDifficulty";
import { rulesets } from "../rulesets";
import {
  MAX_LOCAL_PLAYERS,
  DEFAULT_HUMAN_NAME,
  defaultLocalName,
  duplicateNames,
  updateAiSetup,
  updateLocalSetup,
  useAiSetup,
  useLocalSetup,
  type AiSpeed,
  type FirstPlayer,
  type LocalOrder,
} from "../setup";

/* -------------------------------------------------------------- primitives -------------------------------------------------------------- */

function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T | null; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const name = useId();
  return (
    <fieldset className="setup-field">
      <legend>{label}</legend>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <label key={String(o.value)} className={value === o.value ? "checked" : ""}>
            <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RulesField() {
  const name = useId();
  return (
    <fieldset className="setup-field">
      <legend>게임 규칙</legend>
      <div className="rule-options">
        {rulesets.map((r) => (
          <label key={r.id} className={"rule-option" + (r.available ? "" : " unavailable") + (r.id === "yacht-12" ? " checked" : "")}>
            <input type="radio" name={name} checked={r.id === "yacht-12"} disabled={!r.available} readOnly />
            <span>
              <strong>{r.name}</strong>
              <small>{r.summary}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SetupLayout({ title, onBack, onStart, children }: { title: string; onBack: () => void; onStart: () => void; children: ReactNode }) {
  return (
    <form
      className="setup"
      aria-labelledby="setup-title"
      onSubmit={(e) => {
        e.preventDefault();
        onStart();
      }}
    >
      <div className="setup-head">
        <button type="button" className="setup-back" onClick={onBack}>
          <ArrowLeft size={17} /> 뒤로
        </button>
        <h1 id="setup-title">{title}</h1>
      </div>
      <div className="setup-body">{children}</div>
      <div className="setup-footer">
        <button type="submit" className="primary setup-start">
          <Play size={17} /> 게임 시작
        </button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- AI setup ---------------------------------------------------------------- */

export function AiSetupScreen({ onBack, onStart }: { onBack: () => void; onStart: () => void }) {
  const setup = useAiSetup();
  const levelName = useId();
  return (
    <SetupLayout title="사람 vs AI" onBack={onBack} onStart={onStart}>
      <fieldset className="setup-field" disabled={setup.research}>
        <legend>AI 난이도</legend>
        <div className="level-options" role="radiogroup" aria-label="AI 난이도">
          {gameDifficulties.map((level) => (
            <label key={level.algorithm} className={"level-option" + (!setup.research && setup.difficulty === level.algorithm ? " checked" : "")}>
              <input type="radio" name={levelName} value={level.algorithm} checked={setup.difficulty === level.algorithm} onChange={() => updateAiSetup({ difficulty: level.algorithm })} />
              <strong>{level.name}</strong>
              <small>{level.hint}</small>
            </label>
          ))}
        </div>
        {setup.research && <p className="setup-note">고급 설정의 연구용 알고리즘을 사용 중이에요.</p>}
      </fieldset>
      <label className="setup-field setup-text">
        <span className="setup-label">내 이름</span>
        <input aria-label="내 이름" value={setup.name} placeholder={DEFAULT_HUMAN_NAME} maxLength={24} autoComplete="nickname" onChange={(e) => updateAiSetup({ name: e.target.value })} />
      </label>
      <Segmented<FirstPlayer>
        label="선공"
        value={setup.first}
        options={[
          { value: "random", label: "무작위" },
          { value: "me", label: "내가 먼저" },
          { value: "ai", label: "AI 먼저" },
        ]}
        onChange={(first) => updateAiSetup({ first })}
      />
      <RulesField />
      <details className="setup-advanced">
        <summary>고급 설정</summary>
        <Segmented<AiSpeed>
          label="AI 행동 속도"
          value={setup.speed}
          options={[
            { value: "slow", label: "느리게" },
            { value: "normal", label: "보통" },
            { value: "fast", label: "빠르게" },
          ]}
          onChange={(speed) => updateAiSetup({ speed })}
        />
        <div className="setup-field">
          <label className="setup-check">
            <input type="checkbox" checked={setup.research} onChange={(e) => updateAiSetup({ research: e.target.checked })} />
            <span>
              <strong>연구용 알고리즘 직접 선택</strong>
              <small>난이도 대신 지금까지 개발한 AI·연구 모델 중 하나를 상대로 지정해요. 끄면 위의 5단계 난이도로 돌아가요.</small>
            </span>
          </label>
          {setup.research && <ModelPicker value={setup.researchAlgorithm} onChange={(researchAlgorithm) => updateAiSetup({ researchAlgorithm })} />}
        </div>
      </details>
    </SetupLayout>
  );
}

/* -------------------------------------------------------------- local setup -------------------------------------------------------------- */

function NameInputs({ from, to }: { from: number; to: number }) {
  const setup = useLocalSetup();
  return (
    <div className="name-grid">
      {Array.from({ length: to - from }, (_, k) => from + k).map((i) => (
        <label key={i}>
          <span>P{i + 1}</span>
          <input
            aria-label={`플레이어 ${i + 1} 이름`}
            value={setup.names[i]}
            placeholder={defaultLocalName(i)}
            maxLength={24}
            onChange={(e) => {
              const names = [...setup.names];
              names[i] = e.target.value;
              updateLocalSetup({ names });
            }}
          />
        </label>
      ))}
    </div>
  );
}

export function LocalSetupScreen({ onBack, onStart }: { onBack: () => void; onStart: () => void }) {
  const setup = useLocalSetup();
  const many = setup.count > 4;
  const setCount = (n: number) => updateLocalSetup({ count: Math.min(MAX_LOCAL_PLAYERS, Math.max(2, Math.trunc(n) || 2)) });
  return (
    <SetupLayout title="사람 vs 사람" onBack={onBack} onStart={onStart}>
      <Segmented<number>
        label="참가 인원"
        value={many ? null : setup.count}
        options={[2, 3, 4].map((n) => ({ value: n, label: `${n}명` }))}
        onChange={setCount}
      />
      {many && <p className="setup-note">고급 설정에서 {setup.count}명으로 설정했어요.</p>}
      {!many && (
        <fieldset className="setup-field">
          <legend>플레이어 이름</legend>
          <NameInputs from={0} to={setup.count} />
        </fieldset>
      )}
      {duplicateNames(setup.names, setup.count) && <p className="setup-note">같은 이름은 “이름 (2)”처럼 구분해서 표시해요.</p>}
      <Segmented<LocalOrder>
        label="시작 순서"
        value={setup.order}
        options={[
          { value: "input", label: "입력한 순서" },
          { value: "random", label: "무작위" },
        ]}
        onChange={(order) => updateLocalSetup({ order })}
      />
      <RulesField />
      <details className="setup-advanced" open={many || undefined}>
        <summary>고급 설정 · 5~50명</summary>
        <div className="setup-field">
          <span className="setup-label" id="count-label">
            참가 인원 (2~{MAX_LOCAL_PLAYERS}명)
          </span>
          <div className="count-stepper">
            <button type="button" className="icon-button" aria-label="인원 줄이기" disabled={setup.count <= 2} onClick={() => setCount(setup.count - 1)}>
              <Minus size={16} />
            </button>
            <input
              type="number"
              aria-label="참가 인원 직접 입력"
              min={2}
              max={MAX_LOCAL_PLAYERS}
              value={setup.count}
              onChange={(e) => {
                if (e.target.value !== "") setCount(Number(e.target.value));
              }}
            />
            <button type="button" className="icon-button" aria-label="인원 늘리기" disabled={setup.count >= MAX_LOCAL_PLAYERS} onClick={() => setCount(setup.count + 1)}>
              <Plus size={16} />
            </button>
          </div>
        </div>
        {many && (
          <div className="setup-field">
            <div className="setup-row">
              <span className="setup-label">플레이어 이름</span>
              <button type="button" className="text-button" onClick={() => updateLocalSetup({ names: setup.names.map(() => "") })}>
                모두 기본 이름으로
              </button>
            </div>
            <div className="name-scroll">
              <NameInputs from={0} to={setup.count} />
            </div>
          </div>
        )}
        <p className="setup-note">인원을 줄였다가 다시 늘려도 입력한 이름은 유지돼요.</p>
      </details>
    </SetupLayout>
  );
}
