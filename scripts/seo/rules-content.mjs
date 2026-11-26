/**
 * Rules (guide/) and FAQ (faq/) pages — 2026-11-26 redesign. Static HTML: readable and crawlable
 * without JavaScript. Every example score is computed with `scoreOf`, a copy of the game engine's
 * scoring (src/engine.ts score); tests/seo-rules.test.ts checks the two agree on all 7,776 rolls.
 */

export const CATEGORIES = [
  ["aces", "에이스 (1)"], ["deuces", "듀스 (2)"], ["threes", "트리플 (3)"], ["fours", "쿼드 (4)"], ["fives", "펜타 (5)"], ["sixes", "헥사 (6)"],
  ["choice", "초이스"], ["four", "포커"], ["full", "풀 하우스"], ["small", "스몰 스트레이트"], ["large", "라지 스트레이트"], ["yacht", "요트"],
];

/** Same rules as src/engine.ts `score` (12-category Yacht, not US Yahtzee). */
export function scoreOf(values, category) {
  const counts = Array(7).fill(0);
  values.forEach((v) => counts[v]++);
  const sum = values.reduce((a, b) => a + b, 0);
  const index = CATEGORIES.findIndex(([id]) => id === category);
  if (index < 6) return counts[index + 1] * (index + 1);
  switch (category) {
    case "choice": return sum;
    case "four": return Math.max(...counts) >= 4 ? sum : 0;
    case "full": return counts.includes(3) && counts.includes(2) ? sum : 0;
    case "small": return [1, 2, 3].some((s) => [0, 1, 2, 3].every((n) => counts[s + n] > 0)) ? 15 : 0;
    case "large": return [1, 2].some((s) => [0, 1, 2, 3, 4].every((n) => counts[s + n] > 0)) ? 30 : 0;
    case "yacht": return counts.includes(5) ? 50 : 0;
  }
  return 0;
}

const PIPS = { 1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]], 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]], 6: [[28, 25], [72, 25], [28, 50], [72, 50], [28, 75], [72, 75]] };
/** One die face as inline SVG. `hit` marks a die that makes the combination. */
export const die = (v, hit = false) =>
  `<svg class="d${hit ? " hit" : ""}" viewBox="0 0 100 100" aria-hidden="true"><rect x="4" y="4" width="92" height="92" rx="20"/>${PIPS[v].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9"/>`).join("")}</svg>`;
/** A roll: five dice with an accessible label. */
export const roll = (values, hits = []) => `<span class="roll" role="img" aria-label="주사위 ${values.join(", ")}">${values.map((v, i) => die(v, hits.includes(i))).join("")}</span>`;

const EXAMPLES = [
  ["aces", [1, 1, 1, 4, 6], [0, 1, 2], "1의 개수 × 1", "1이 3개 → 3점"],
  ["deuces", [2, 2, 5, 2, 3], [0, 1, 3], "2의 개수 × 2", "2가 3개 → 6점"],
  ["threes", [3, 3, 3, 3, 1], [0, 1, 2, 3], "3의 개수 × 3", "3이 4개 → 12점"],
  ["fours", [4, 4, 4, 2, 6], [0, 1, 2], "4의 개수 × 4", "4가 3개 → 12점"],
  ["fives", [5, 5, 1, 5, 2], [0, 1, 3], "5의 개수 × 5", "5가 3개 → 15점"],
  ["sixes", [6, 6, 6, 6, 2], [0, 1, 2, 3], "6의 개수 × 6", "6이 4개 → 24점"],
  ["choice", [6, 5, 5, 4, 3], [0, 1, 2, 3, 4], "다섯 눈의 합 (조건 없음)", "6+5+5+4+3"],
  ["four", [5, 5, 5, 5, 2], [0, 1, 2, 3, 4], "같은 눈 4개 이상이면 다섯 눈의 합", "5 네 개 + 2"],
  ["full", [3, 3, 3, 6, 6], [0, 1, 2, 3, 4], "같은 눈 3개 + 다른 같은 눈 2개면 다섯 눈의 합", "3 세 개 + 6 두 개"],
  ["small", [1, 2, 3, 4, 6], [0, 1, 2, 3], "연속한 눈 4개(1-2-3-4, 2-3-4-5, 3-4-5-6)면 15점", "1-2-3-4"],
  ["large", [2, 3, 4, 5, 6], [0, 1, 2, 3, 4], "연속한 눈 5개(1-2-3-4-5, 2-3-4-5-6)면 30점", "2-3-4-5-6"],
  ["yacht", [4, 4, 4, 4, 4], [0, 1, 2, 3, 4], "다섯 눈이 모두 같으면 50점", "4 다섯 개"],
];
const MISS = { four: [5, 5, 5, 2, 2], full: [3, 3, 3, 3, 3], small: [1, 2, 3, 5, 6], large: [1, 2, 3, 4, 6], yacht: [6, 6, 6, 6, 1] };

const catCard = ([id, values, hits, rule, why]) => {
  const name = CATEGORIES.find(([c]) => c === id)[1];
  const miss = MISS[id];
  return `<li class="cat" id="cat-${id}">
          <h3>${name}</h3>
          <p class="rule">${rule}</p>
          <p class="ex">${roll(values, hits)} <b>${scoreOf(values, id)}점</b> <small>${why}</small></p>${miss ? `
          <p class="ex miss">${roll(miss)} <b>${scoreOf(miss, id)}점</b> <small>${id === "full" ? "같은 눈 5개는 풀 하우스가 아니에요" : id === "four" ? "같은 눈이 3개뿐" : id === "yacht" ? "하나가 달라요" : "연속이 끊겼어요"}</small></p>` : ""}
        </li>`;
};

export const GUIDE = {
  path: "guide/",
  crumb: "규칙과 족보",
  title: "요트다이스 규칙과 족보, 확률, 초보 전략 · Online Yacht",
  ogTitle: "요트다이스 규칙과 족보 · Online Yacht",
  description: "온라인 요트다이스의 12개 족보, 점수 계산과 63점 상단 보너스, 첫 굴림 확률, 친구·AI 대전 방법을 알아보세요.",
  jsonld: [{ "@type": "HowTo", name: "요트다이스 한 차례 진행", step: [
    { "@type": "HowToStep", text: "주사위 5개를 굴립니다." },
    { "@type": "HowToStep", text: "남길 주사위를 눌러 킵하고, 나머지를 최대 두 번 더 굴립니다." },
    { "@type": "HowToStep", text: "비어 있는 칸 하나를 골라 점수를 기록합니다." },
  ] }],
  body: `
    <article class="rules">
      <h1>요트다이스 규칙과 족보</h1>
      <p class="lead">주사위 5개를 최대 세 번 굴려 12칸의 점수판을 채우는 게임입니다. 12라운드가 끝났을 때 총점이 높은 사람이 이깁니다.</p>
      <nav class="toc" aria-label="이 페이지에서">
        <a href="#turn">진행 순서</a><a href="#keep">굴림과 킵</a><a href="#scores">12개 족보</a><a href="#bonus">상단 보너스</a><a href="#total">점수 계산</a><a href="#odds">확률</a><a href="#strategy">초보 전략</a><a href="#play">대전 시작</a><a href="#faq">질문</a>
      </nav>
      <section id="turn">
        <h2>한 차례 진행 순서</h2>
        <ol class="steps">
          <li><b>굴리기</b><span>주사위 5개를 모두 굴립니다.</span></li>
          <li><b>킵하기</b><span>남길 주사위를 눌러 고정합니다.</span></li>
          <li><b>다시 굴리기</b><span>고정하지 않은 주사위만 굴립니다. 한 차례에 굴림은 최대 3번.</span></li>
          <li><b>기록하기</b><span>비어 있는 칸 하나에 점수를 적습니다. 조건이 맞지 않으면 0점으로도 적을 수 있어요.</span></li>
        </ol>
        <p>모든 플레이어가 12칸을 다 채우면(12라운드) 경기가 끝납니다. 같은 총점은 공동 순위입니다.</p>
      </section>
      <section id="keep">
        <h2>굴림과 킵</h2>
        <div class="keep-demo">
          <p><span class="tag">1번째 굴림</span>${roll([6, 6, 2, 5, 6], [0, 1, 4])}<small>6 세 개를 킵</small></p>
          <p><span class="tag">2번째 굴림</span>${roll([6, 6, 6, 6, 3], [0, 1, 2, 3])}<small>2개만 다시 굴려 6이 하나 더</small></p>
          <p><span class="tag">기록</span>${roll([6, 6, 6, 6, 3], [0, 1, 2, 3])}<small>포커 ${scoreOf([6, 6, 6, 6, 3], "four")}점 · 헥사 ${scoreOf([6, 6, 6, 6, 3], "sixes")}점 · 초이스 ${scoreOf([6, 6, 6, 6, 3], "choice")}점 중 하나</small></p>
        </div>
        <p>킵한 주사위도 다음 굴림 전에 다시 눌러 해제할 수 있습니다. 세 번을 다 쓰지 않고 바로 기록해도 됩니다.</p>
      </section>
      <section id="scores">
        <h2>12개 족보와 점수</h2>
        <p>강조된 주사위가 족보를 만드는 눈입니다. 아래 점수는 게임과 같은 계산 규칙으로 구했습니다.</p>
        <h3 class="group">상단 (숫자 칸)</h3>
        <ul class="cats">
        ${EXAMPLES.slice(0, 6).map(catCard).join("\n        ")}
        </ul>
        <h3 class="group">하단 (조합 칸)</h3>
        <ul class="cats">
        ${EXAMPLES.slice(6).map(catCard).join("\n        ")}
        </ul>
        <p class="note">한 굴림으로는 한 칸에만 기록합니다. 같은 굴림이 여러 칸에 맞으면 남은 칸과 보너스를 생각해 고르세요.</p>
      </section>
      <section id="bonus">
        <h2>63점 상단 보너스</h2>
        <p>에이스부터 헥사까지 여섯 칸의 합이 <b>63점 이상</b>이면 총점에 <b>35점</b>을 더합니다.</p>
        <div class="bonus-bar" role="img" aria-label="각 눈을 세 개씩 적으면 63점">
          ${[1, 2, 3, 4, 5, 6].map((v) => `<span>${die(v)}<i>× 3 = ${v * 3}</i></span>`).join("")}
        </div>
        <p>각 눈을 세 개씩 적으면 정확히 63점입니다. 헥사를 4개(24점) 적으면 6점 여유가 생겨 다른 칸의 부족분을 채울 수 있어요.</p>
      </section>
      <section id="total">
        <h2>총점 계산</h2>
        <table>
          <caption>총점 = 상단 합 + 상단 보너스 + 하단 합</caption>
          <thead><tr><th scope="col">구간</th><th scope="col">예시</th></tr></thead>
          <tbody>
            <tr><th scope="row">상단 합</th><td>3 + 6 + 12 + 12 + 15 + 24 = 72</td></tr>
            <tr><th scope="row">상단 보너스</th><td>72 ≥ 63 이므로 +35</td></tr>
            <tr><th scope="row">하단 합</th><td>초이스 23 + 포커 22 + 풀 하우스 21 + 스몰 15 + 라지 30 + 요트 50 = 161</td></tr>
            <tr><th scope="row">총점</th><td><b>72 + 35 + 161 = 268</b></td></tr>
          </tbody>
        </table>
        <p class="note">미국식 Yahtzee와 달리 추가 요트 보너스와 조커 규칙이 없고, 풀 하우스는 다섯 눈의 합, 스몰 15점·라지 30점입니다.</p>
      </section>
      <section id="odds">
        <h2>첫 굴림에서 족보가 나올 확률</h2>
        <p>공정한 주사위 5개를 한 번 굴리는 7,776가지 결과를 게임 규칙으로 셌습니다. 라지 스트레이트는 스몰에도, 요트는 포커에도 포함됩니다.</p>
        <table>
          <caption>굴림 1회 기준</caption>
          <thead><tr><th scope="col">족보</th><th scope="col">경우의 수</th><th scope="col">확률</th></tr></thead>
          <tbody>
            <tr><th scope="row">포커</th><td>156</td><td>2.006%</td></tr>
            <tr><th scope="row">풀 하우스</th><td>300</td><td>3.858%</td></tr>
            <tr><th scope="row">스몰 스트레이트</th><td>1,200</td><td>15.432%</td></tr>
            <tr><th scope="row">라지 스트레이트</th><td>240</td><td>3.086%</td></tr>
            <tr><th scope="row">요트</th><td>6</td><td>0.077%</td></tr>
          </tbody>
        </table>
        <p>킵과 재굴림을 포함한 확률은 <a href="../probability/">확률 계산기</a>에서 직접 확인할 수 있습니다.</p>
      </section>
      <section id="strategy">
        <h2>초보자 전략</h2>
        <ul>
          <li>4·5·6이 여러 개 모이면 상단 보너스까지 남은 점수를 확인하세요. 헥사 4개는 세 개씩 기록하는 기준보다 6점 높습니다.</li>
          <li>2·3·4·5를 킵하면 한 자리에서 1 또는 6으로 라지를 노릴 수 있습니다. 재굴림이 한 번 남았다면 성공 확률은 2/6입니다.</li>
          <li>원하는 족보가 나오지 않았다면 초이스나 낮은 상단 칸을 고려하세요. 요트·에이스 칸을 0점으로 비우는 것도 흔한 선택입니다.</li>
        </ul>
        <p>더 자세한 선택 기준은 <a href="../strategy/">초보 전략</a>에서, 실제 주사위로 할 때는 <a href="../scores/">점수판</a>을 쓰세요.</p>
      </section>
      <section id="play">
        <h2>AI 대전과 친구 대전</h2>
        <p><a href="../#offline">오프라인 대전</a>에서 다섯 단계 <a href="../ai/">AI</a>와 대결하거나 한 기기에서 함께 할 수 있습니다. 굴림부터 기록까지 익히려면 <strong>한 차례 연습하기</strong>를 누르세요.</p>
        <p><a href="../#online">온라인 대전</a>에서 빠른 대전을 시작하거나 <a href="../multiplayer/">친구 대전</a> 방을 열어 초대 링크나 코드를 공유하세요.</p>
        <p class="cta"><a class="button" href="../#online">지금 무료로 플레이</a> <a class="button ghost" href="../#offline">AI와 연습하기</a></p>
      </section>
      <section id="faq">
        <h2>자주 묻는 질문</h2>
        <details><summary>킵한 주사위도 다시 굴릴 수 있나요?</summary><p>네. 재굴림 전에 킵을 해제하면 그 주사위도 함께 굴러갑니다.</p></details>
        <details><summary>요트가 두 번 나오면 어떻게 하나요?</summary><p>요트 칸은 경기당 한 번만 쓸 수 있습니다. 이미 썼다면 포커, 초이스 또는 해당 눈의 상단 칸 등 남은 칸을 고르세요. 추가 보너스는 없습니다.</p></details>
        <details><summary>같은 눈 5개는 풀 하우스인가요?</summary><p>아니요. 풀 하우스는 서로 다른 두 눈이 3개와 2개일 때만 인정됩니다. 같은 눈 5개는 요트·포커·초이스·상단 칸에 적을 수 있습니다.</p></details>
        <p>다른 질문은 <a href="../faq/">자주 묻는 질문</a>에 있습니다.</p>
      </section>
    </article>`,
};

/** FAQ by category (question, answer HTML-free text, optional link). */
export const FAQ_GROUPS = [
  ["게임 플레이", [
    ["요트다이스와 야추는 같은 게임인가요?", "국내에서는 주사위 5개를 최대 세 번 굴려 족보 칸에 점수를 적는 게임을 요트다이스, 요트 다이스, 야추라고 부릅니다. Online Yacht는 12칸 규칙(에이스~헥사, 초이스, 포커, 풀 하우스, 스몰·라지 스트레이트, 요트)과 63점 상단 보너스 35점을 씁니다.", ["../guide/", "규칙과 족보"]],
    ["야찌(Yahtzee)와 무엇이 다른가요?", "미국식 Yahtzee®는 13칸(3 of a kind 포함)이고 풀 하우스 25점, 스몰 스트레이트 30점, 라지 스트레이트 40점, 추가 요트 보너스와 조커 규칙이 있습니다. Online Yacht의 요트다이스는 12칸이며 풀 하우스는 다섯 눈의 합, 스몰 15점, 라지 30점이고 추가 요트 보너스가 없습니다. Online Yacht는 Hasbro의 Yahtzee 공식 제품이 아닙니다."],
    ["요트가 두 번 나오면 어떻게 하나요?", "요트 칸은 한 번만 씁니다. 이미 채웠다면 포커, 초이스, 해당 눈의 상단 칸 등 남은 칸에 적으세요. 추가 요트 보너스는 없습니다."],
    ["0점을 적어도 되나요?", "네. 조건이 맞지 않는 칸에도 0점으로 기록할 수 있습니다. 남은 칸이 나쁠 때 요트나 에이스 칸을 0점으로 쓰는 것도 흔한 선택입니다."],
    ["키보드로 플레이할 수 있나요?", "PC에서는 Space로 굴리고, 1~5로 주사위를 킵하고, ↑·↓로 족보를 고른 뒤 Enter로 기록합니다. 게임 중 ?를 누르면 전체 단축키가 보입니다."],
    ["실제 주사위로 할 때 점수를 적을 곳이 있나요?", "있습니다. 점수판 페이지에서 인원을 정하고 점수를 입력하면 상단 보너스와 합계, 승자를 자동으로 계산합니다. 기록은 이 기기에만 저장됩니다.", ["../scores/", "점수판"]],
  ]],
  ["온라인 대전", [
    ["친구와 어떻게 같이 하나요?", "온라인 대전에서 친구 대전을 고르고 방을 만든 뒤 초대 링크나 6자리 코드를 보내면 됩니다. 2명부터 최대 20명까지 한 방에서 플레이할 수 있습니다.", ["../multiplayer/", "친구 대전 안내"]],
    ["연결이 끊기면 경기는 어떻게 되나요?", "잠시 끊긴 경우 같은 기기로 다시 접속하면 이어서 플레이합니다. 정해진 시간 안에 돌아오지 않으면 기권으로 처리됩니다."],
    ["다른 사람 경기를 볼 수 있나요?", "방 주인이 관전을 허용하면 관전 링크로 경기를 볼 수 있습니다. 관전자는 게임에 영향을 줄 수 없습니다."],
  ]],
  ["AI 대전", [
    ["AI는 얼마나 강한가요?", "다섯 단계가 있습니다. 매우 어려움은 1:1 승리를 목표로 학습·계산한 AI입니다. 혼자 최고 점수를 노리는 기대점수 최적 AI(DP Expert)의 평균은 정확 계산으로 약 191.8점입니다.", ["../ai/", "AI 난이도"]],
    ["AI가 주사위를 미리 알고 있나요?", "아니요. AI는 사람과 같이 현재 보이는 주사위와 점수판만 보고 선택합니다. 주사위 결과는 AI 난이도와 관계없이 같은 방식으로 정해집니다."],
    ["경기가 끝난 뒤 내 선택을 돌아볼 수 있나요?", "네. 결과 화면의 게임 리뷰에서 각 선택과 AI 추천을 비교할 수 있습니다. 키보드 ←·→로 행동을 넘기고 Space로 자동 재생합니다."],
  ]],
  ["계정", [
    ["설치나 회원가입이 필요한가요?", "아니요. 브라우저에서 바로 AI 대전, 한 기기 대전, 친구 초대 대전을 할 수 있습니다. 계정 기록·재화·친구 목록 같은 회원 기능만 로그인이 필요합니다."],
    ["게스트로 한 기록도 옮겨지나요?", "로그인 전 이 기기에 저장된 기록은 계정에 참고용으로 가져올 수 있지만, 재화 보상은 소급되지 않습니다."],
  ]],
  ["상점 및 재화", [
    ["코인과 보석은 어떻게 얻나요?", "회원으로 온라인 대전(무작위·친구·서버 AI)을 마치면 코인을 받고, 일일·주간 퀘스트와 업적에서 코인과 보석을 받습니다. 하루 보상 경기 수에는 상한이 있습니다."],
    ["아이템이 승패에 영향을 주나요?", "아니요. 주사위·보드판·이모티콘 같은 꾸미기 아이템은 모양과 소리만 바꿉니다. 주사위 결과, 물리, 점수, 승패에는 영향이 없습니다."],
    ["강화하면 무엇이 달라지나요?", "Lv.2는 움직임이나 환경 효과, Lv.3은 충돌·착지·족보 반응 같은 효과와 전용 효과음이 더해집니다. 상점에서 단계별로 미리 볼 수 있고, 강화 후에도 낮은 단계를 골라 쓸 수 있습니다."],
  ]],
  ["모바일", [
    ["휴대폰에서도 되나요?", "네. PC·휴대폰·태블릿 브라우저를 지원하고, 홈 화면에 추가하면 앱처럼 열 수 있습니다. 오프라인 AI 대전은 한 번 연 뒤 인터넷 없이도 열립니다."],
    ["휴대폰이 느리거나 뜨거워져요.", "설정 → 화면에서 효과 품질을 낮음으로, 주사위 애니메이션 품질을 성능 우선이나 간단(2.5D)으로 바꾸세요. 기기의 동작 줄이기 설정도 존중합니다."],
  ]],
  ["문제 해결", [
    ["소리가 나지 않아요.", "브라우저는 화면을 한 번 누르기 전에는 소리를 막습니다. 설정에서 전체 음소거가 꺼져 있는지, 효과음·배경 음악 음량을 확인하세요. PC에서는 M으로 음소거, B로 배경 음악을 켜고 끕니다."],
    ["새 버전이 나왔다는 안내가 떠요.", "새로고침하면 최신 화면을 불러옵니다. 진행 중인 온라인 경기는 서버에 저장되어 다시 접속하면 이어집니다."],
  ]],
];
export const FAQ_ITEMS = FAQ_GROUPS.flatMap(([, items]) => items);
