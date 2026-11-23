import { algorithms, type Algorithm } from "./ai";
import { researchModelIds, type ResearchModelId } from "./model-ids";

/**
 * One registry for every AI the project has built — what it is, whether it can play a full
 * 12-category game against a human, what it needs, and what happens outside its specialty.
 *
 * Classification is evidence-based (see docs/ai/MODEL-REGISTRY.md and tests/ai-models.test.ts):
 *  - "playable":    plays complete games through `decideModel`, verified by full-game tests.
 *  - "conditional": plays complete games, but its special logic only applies in stated situations;
 *                   elsewhere the listed fallback policy decides (shown to the user).
 *  - "research":    no browser-runnable full-game policy (training code only, missing checkpoint,
 *                   sub-problem or component). Listed for reference, never selectable.
 * A file existing in the repo never makes a model playable by itself; only a registered decision
 * function that passes the full-game tests does.
 */
export type { ResearchModelId };
export { researchModelIds };
export type ModelId = Algorithm | ResearchModelId;

export type ModelFamily = "basic" | "dp" | "win" | "search" | "rl" | "distill" | "external" | "experimental";
export const familyLabels: Record<ModelFamily, string> = {
  basic: "기본",
  dp: "DP / 기대점수",
  win: "승률 최적화",
  search: "탐색",
  rl: "강화학습",
  distill: "정책 증류",
  external: "외부 공개 AI 이식",
  experimental: "실험 모델",
};
export type ModelStatus = "playable" | "conditional" | "research";
export type ModelInfo = {
  id: string;
  name: string;
  family: ModelFamily;
  status: ModelStatus;
  description: string;
  /** Only the 12-category ruleset exists; every runnable model is limited to it. */
  rules: readonly ["yacht-12"];
  /** When the model's own logic applies (conditional models). */
  condition?: string;
  /** Policy that decides outside the condition. */
  fallback?: string;
  /** Why a research entry is not selectable. */
  reason?: string;
  needsDP: boolean;
  checkpoint: string | null;
  cost: "낮음" | "보통" | "높음";
  loading: string;
  source: string;
  /** Part of the 5 public difficulty levels. */
  publicLevel?: boolean;
};

const R = ["yacht-12"] as const;
const shipped: Record<Algorithm, Omit<ModelInfo, "id" | "name" | "rules" | "status">> = {
  Random: { family: "basic", description: "합법적인 점수 선택과 재굴림을 무작위로 고르는 기준 정책.", needsDP: false, checkpoint: null, cost: "낮음", loading: "내장", source: "src/ai.ts", publicLevel: true },
  Greedy: { family: "basic", description: "지금 얻을 수 있는 점수와 간단한 기대값으로 고르는 휴리스틱.", needsDP: false, checkpoint: null, cost: "낮음", loading: "내장", source: "src/ai.ts", publicLevel: true },
  Expectimax: { family: "search", description: "남은 굴림의 확률을 한 턴 안에서 계산하는 기대값 탐색.", needsDP: false, checkpoint: null, cost: "보통", loading: "내장", source: "src/ai.ts", publicLevel: true },
  MCTS: { family: "search", description: "무작위 시뮬레이션으로 행동을 평가하는 몬테카를로 트리 탐색.", needsDP: false, checkpoint: null, cost: "보통", loading: "내장", source: "src/ai.ts" },
  PPO: { family: "rl", description: "PPO로 학습한 정책 신경망.", needsDP: false, checkpoint: "src/ppo-model.json", cost: "낮음", loading: "내장 가중치", source: "src/ppo.ts", publicLevel: true },
  "DP Expert": { family: "dp", description: "전체 게임 동적계획법으로 기대 최종점수를 최대화(초기 기대값 191.76점).", needsDP: true, checkpoint: "public/ai (DP 테이블)", cost: "보통", loading: "DP 테이블 지연 로드", source: "src/dp.ts" },
  "Win DP": { family: "win", description: "마지막 한 칸에서 상대 점수를 고려해 승리 확률을 최대화, 그 외는 DP Expert.", needsDP: true, checkpoint: "public/ai (DP 테이블)", cost: "보통", loading: "DP 테이블 지연 로드", source: "src/win-dp.ts" },
  "Win DP v2": { family: "win", description: "마지막 두 칸까지 승률 목적을 반영하는 경쟁형 DP, 그 외는 DP Expert.", needsDP: true, checkpoint: "public/ai (DP 테이블)", cost: "보통", loading: "DP 테이블 지연 로드", source: "src/competitive-v2.ts" },
  "Win DP v4-D": { family: "win", description: "자기대국 REINFORCE 잔차 정책 + 후반 v3.3 계열(고정 체크포인트).", needsDP: true, checkpoint: "training/research-archive/v4-reinforce-seed1-frozen.json", cost: "보통", loading: "DP 테이블 지연 로드", source: "src/research-v4.ts", publicLevel: true },
  "Distilled Policy": { family: "distill", description: "DP 정책을 작은 신경망으로 증류한 모델.", needsDP: false, checkpoint: "src/distilled-policy.json", cost: "낮음", loading: "가중치 지연 로드", source: "src/distilled.ts" },
  "Distilled PPO": { family: "distill", description: "증류 정책에서 시작해 PPO로 추가 학습한 모델.", needsDP: false, checkpoint: "src/distilled-ppo.json", cost: "낮음", loading: "가중치 지연 로드", source: "src/distilled.ts" },
};

const human = "상대가 사람이면 상대 모델을 'Other'(알 수 없음)로 가정합니다.";
const research: Record<ResearchModelId, Omit<ModelInfo, "id" | "name" | "rules">> = {
  "Win DP v3": { family: "win", status: "conditional", description: "남은 칸이 3개일 때 상대 점수 분포 예측으로 여러 턴 승률을 계산.", condition: "내 남은 칸이 3개일 때(예측 계획 가능 시)", fallback: "Win DP v2 → DP Expert", needsDP: true, checkpoint: null, cost: "보통", loading: "DP 테이블 지연 로드", source: "src/competitive-v3.ts" },
  "Win DP v3.1": { family: "win", status: "conditional", description: "v3의 3칸 예측 + 알려진 상대에 대한 마지막 턴 정확 최선응답.", condition: "상대가 Win DP v2/v3로 알려진 경우의 후반. " + human, fallback: "Win DP v2 → DP Expert", needsDP: true, checkpoint: null, cost: "보통", loading: "DP 테이블 지연 로드", source: "src/research-v31.ts" },
  "Win DP v3.2": { family: "win", status: "conditional", description: "상대가 DP Expert일 때 3칸 남은 정확 점수 분포 사용, 그 외 v3.1.", condition: "상대가 DP Expert로 알려지고 양쪽 3칸 남았을 때. " + human, fallback: "Win DP v3.1 → Win DP v2 → DP Expert", needsDP: true, checkpoint: null, cost: "보통", loading: "DP 테이블 지연 로드", source: "src/research-v32.ts" },
  "Win DP v3.3": { family: "win", status: "conditional", description: "상대별 점수 예측 팩(가우시안/조건부 PMF)으로 3칸 단계 승률 계산.", condition: "상대가 알려지고 예측 팩이 있을 때. 저장소에는 예측 팩(v33-forecast-locked)이 커밋되어 있지 않아 브라우저에서는 기준 단계만 사용", fallback: "Win DP v3.2 → v3.1 → Win DP v2", needsDP: true, checkpoint: "v33-forecast-locked (CI 아티팩트, 미포함)", cost: "보통", loading: "DP 테이블 지연 로드", source: "src/research-v33.ts" },
  "Win DP v3.3 Belief": { family: "win", status: "conditional", description: "상대 정책에 대한 베이지안 믿음을 섞어 3턴 승률을 계산.", condition: "관측으로 믿음을 갱신해야 하지만 게임 화면은 상대(사람)의 행동을 전달하지 않으므로 균등 사전분포로만 동작", fallback: "사전분포 혼합 예측", needsDP: true, checkpoint: null, cost: "높음", loading: "DP 테이블 지연 로드", source: "src/research-v33-belief.ts" },
  "Win DP v3.4": { family: "win", status: "conditional", description: "후반 2칸에서 상대 응답을 샘플링해 행동을 비교(시간 제한 탐색).", condition: "내 남은 칸이 2개 이하일 때. " + human, fallback: "Win DP v3.3 계열", needsDP: true, checkpoint: null, cost: "높음", loading: "DP 테이블 지연 로드", source: "src/research-v34.ts" },
  "Win DP v3.4 Adaptive": { family: "win", status: "conditional", description: "v3.4의 샘플 예산을 상황에 따라 조절하는 적응형 버전.", condition: "내 남은 칸이 2개 이하일 때. " + human, fallback: "Win DP v3.3 계열", needsDP: true, checkpoint: null, cost: "높음", loading: "DP 테이블 지연 로드", source: "src/research-v34-adaptive.ts" },
  "Win DP v4": { family: "win", status: "playable", description: "v4 원본 체크포인트(seed 0): 자기대국 REINFORCE 잔차 정책 + 후반 v3.3(v3.4 끔).", needsDP: true, checkpoint: "training/research-archive/v4-original-seed0.json", cost: "보통", loading: "DP 테이블 지연 로드", source: "src/research-v4.ts" },
  "DP-guided MCTS": { family: "search", status: "playable", description: "DP 가치로 안내되는 UCB 몬테카를로 탐색(64회).", needsDP: true, checkpoint: null, cost: "보통", loading: "DP 테이블 지연 로드", source: "src/research-guided-mcts.ts" },
  "Hybrid Conditional BR": { family: "experimental", status: "conditional", description: "알려진 Win DP v2 상대에게만 마지막 턴 정확 최선응답을 쓰는 하이브리드.", condition: "상대가 Win DP v2로 알려진 마지막 턴. " + human + " 따라서 사람과의 대전에서는 기준 정책과 같음", fallback: "Win DP v2 → DP Expert", needsDP: true, checkpoint: null, cost: "보통", loading: "DP 테이블 지연 로드", source: "src/research-sota-hybrids.ts" },
  "Hybrid Calibrated v3": { family: "experimental", status: "conditional", description: "남은 칸이 정확히 3개일 때만 v3 예측 계획을 쓰는 하이브리드.", condition: "내 남은 칸이 3개일 때", fallback: "Win DP v2 → DP Expert", needsDP: true, checkpoint: null, cost: "보통", loading: "DP 테이블 지연 로드", source: "src/research-sota-hybrids.ts" },
  "Hybrid DP-guided MCTS": { family: "experimental", status: "conditional", description: "남은 칸이 3개일 때만 DP-guided MCTS(48회)를 쓰는 하이브리드.", condition: "내 남은 칸이 3개일 때", fallback: "Win DP v2 → DP Expert", needsDP: true, checkpoint: null, cost: "보통", loading: "DP 테이블 지연 로드", source: "src/research-sota-hybrids.ts" },
  "Exact Last-Turn BR": { family: "win", status: "conditional", description: "마지막 한 칸에서 알려진 상대 정책에 대한 정확한 최선응답.", condition: "내 마지막 칸이고 정확 계산이 가능한 상태", fallback: "Win DP v2 → DP Expert", needsDP: true, checkpoint: null, cost: "보통", loading: "DP 테이블 지연 로드", source: "src/research-last-turn-br.ts" },
  RustHeuristic12: { family: "external", status: "playable", description: "공개 Rust Yahtzee 휴리스틱을 12칸 규칙으로 이식.", needsDP: false, checkpoint: null, cost: "낮음", loading: "내장", source: "src/external-challengers.ts" },
  RustOptimalEquivalent12: { family: "external", status: "playable", description: "공개 Rust '최적' 전략과 동등하게 이식한 12칸 버전(DP 기반).", needsDP: true, checkpoint: null, cost: "보통", loading: "DP 테이블 지연 로드", source: "src/external-challengers.ts" },
  PanchtWeighted12: { family: "external", status: "playable", description: "공개 가중치 휴리스틱(pancht)을 12칸으로 이식.", needsDP: false, checkpoint: null, cost: "낮음", loading: "내장", source: "src/external-challengers.ts" },
  BenjiWinObjective12: { family: "external", status: "playable", description: "승리 목적 공개 AI(benji)의 아이디어를 12칸으로 이식.", needsDP: true, checkpoint: null, cost: "보통", loading: "DP 테이블 지연 로드", source: "src/external-challengers.ts" },
  Z7DartHard12: { family: "external", status: "playable", description: "공개 Dart 구현(z7)의 어려움 난이도를 12칸으로 이식.", needsDP: false, checkpoint: null, cost: "낮음", loading: "내장", source: "src/discovered-external.ts" },
  Z7DartMedium12: { family: "external", status: "playable", description: "공개 Dart 구현(z7)의 보통 난이도를 12칸으로 이식.", needsDP: false, checkpoint: null, cost: "낮음", loading: "내장", source: "src/discovered-external.ts" },
};

/** Not selectable: no browser-runnable full-game policy in this repository. */
const researchOnly: Omit<ModelInfo, "rules" | "status" | "needsDP" | "cost" | "loading">[] = [
  { id: "rl-zoo-choice", name: "REINFORCE · A2C · DQN · Double DQN (Choice)", family: "rl", description: "Choice 칸 선택 하위 문제에서 4종 강화학습 비교.", reason: "하위 문제(점수 칸 선택)만 다루고 체크포인트는 CI 아티팩트로만 보관되어 저장소에 없음", checkpoint: null, source: "training/choice_rl_zoo.py" },
  { id: "qr-dqn-choice", name: "QR-DQN Choice", family: "rl", description: "분포형 Q 학습으로 Choice 선택을 학습한 파일럿.", reason: "하위 문제 전용, 정확 DP에 미달(RESULTS 기록), 체크포인트 미포함", checkpoint: null, source: "training/qr_dqn_choice.py" },
  { id: "tabular-zoo", name: "표 기반 강화학습 모음", family: "rl", description: "작은 상태공간에서 Q-learning 등 비교.", reason: "축소 문제 전용 실험 코드", checkpoint: null, source: "training/tabular_choice_zoo.py" },
  { id: "fullgame-offpolicy", name: "전체 게임 오프폴리시 5계열 (Dueling DQN+PER, QR-DQN, ExIt, Dyna-Q, Discrete SAC)", family: "rl", description: "12라운드 전체 게임 오프폴리시 학습 실험.", reason: "학습된 가중치가 GitHub Actions 아티팩트로만 존재하고 저장소·앱에 포함되지 않음", checkpoint: null, source: "src/research-offpolicy.ts, .github/workflows/offpolicy-ppo-expanded.yml" },
  { id: "ppo-multiseed", name: "PPO 3시드·2배 학습 실험", family: "rl", description: "PPO / PPO+DP teacher의 대규모 학습 비교.", reason: "결과 기록용 실험, 배포 PPO(src/ppo-model.json) 외 체크포인트 미포함", checkpoint: null, source: ".github/workflows/psro-extended.yml" },
  { id: "neural-selfplay", name: "신경망 자기대국 (REINFORCE / Actor-Critic)", family: "rl", description: "DP-Q 특징 기반 12→12→1 신경망 자기대국.", reason: "코드만 있고 학습된 가중치가 저장소에 없음", checkpoint: null, source: "src/neural-residual.ts" },
  { id: "selfplay-residual", name: "자기대국 잔차 정책 (v4 이전 단독)", family: "rl", description: "DP 행동 위에 잔차 가중치를 학습하는 정책.", reason: "단독 체크포인트 없음 — 학습 결과는 Win DP v4 / v4-D 체크포인트로만 사용됨", checkpoint: null, source: "src/selfplay-residual.ts" },
  { id: "native12-dqn", name: "Native12 DQN", family: "rl", description: "12칸 규칙 직접 학습 DQN(Python 브리지).", reason: "Python 런타임 필요, 브라우저 실행 불가, 체크포인트 미포함", checkpoint: null, source: "scripts/native12-dqn-bridge.py" },
  { id: "psro-meta", name: "PSRO 메타게임 솔버", family: "experimental", description: "정책 모집단의 Nash 혼합을 계산.", reason: "정책이 아니라 정책 혼합을 계산하는 구성요소", checkpoint: null, source: "src/psro-meta.ts" },
  { id: "score-pmf", name: "점수판 조건부 점수 분포(PMF)", family: "experimental", description: "상대 최종점수 분포 예측 모델.", reason: "예측 구성요소이며 행동을 고르지 않음", checkpoint: null, source: "src/conditional-score-pmf.ts" },
  { id: "qr-safety-gate", name: "QR 안전 게이트", family: "experimental", description: "제안 행동을 롤아웃으로 검사하는 안전장치.", reason: "다른 정책의 행동을 거르는 구성요소", checkpoint: null, source: "src/qr-safety-gate.ts" },
  { id: "technique-catalog", name: "기법 도감의 미구현 후보", family: "experimental", description: "CFR, AlphaZero, NEAT, CMA-ES, MAP-Elites 등.", reason: "docs/context/TECHNIQUES.md의 아이디어 목록 — 구현 없음", checkpoint: null, source: "docs/context/TECHNIQUES.md" },
];

const isAlgorithm = (id: string): id is Algorithm => (algorithms as readonly string[]).includes(id);
export const isModelId = (id: unknown): id is ModelId => typeof id === "string" && (isAlgorithm(id) || id in research);

export const modelRegistry: ModelInfo[] = [
  ...algorithms.map((id) => ({ id, name: id, rules: R, status: "playable" as const, ...shipped[id] })),
  ...researchModelIds.map((id) => ({ id, name: id, rules: R, ...research[id] })),
  ...researchOnly.map((m) => ({ ...m, rules: R, status: "research" as const, needsDP: false, cost: "낮음" as const, loading: "해당 없음" })),
];
export const modelInfo = (id: string) => modelRegistry.find((m) => m.id === id);
export const isSelectable = (id: string) => modelInfo(id)?.status !== "research" && isModelId(id);
export const modelNeedsDP = (id: string) => !!modelInfo(id)?.needsDP;

