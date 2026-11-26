/**
 * Content of the static search pages (D-062). Numbers come from the exact calculator in
 * public/tools/yacht-odds.js (tests/yacht-odds.test.ts) and from docs/context/RESULTS.md.
 * Each page answers one search intent; 요트다이스·야추 are the same game here, so they share pages
 * instead of duplicate copies.
 */
const play = (label = "지금 무료로 플레이") => `<p class="cta"><a class="button" href="../#online">${label}</a> <a class="button ghost" href="../#offline">AI와 연습하기</a></p>`;

const faqItems = [
  ["요트다이스와 야추는 같은 게임인가요?", "국내에서는 주사위 5개를 최대 세 번 굴려 족보 칸에 점수를 적는 게임을 요트다이스, 요트 다이스, 야추라고 부릅니다. Online Yacht는 12칸 규칙(에이스~헥사, 초이스, 포커, 풀 하우스, 스몰·라지 스트레이트, 요트)과 63점 상단 보너스 35점을 씁니다."],
  ["야찌(Yahtzee)와 무엇이 다른가요?", "미국식 Yahtzee®는 13칸(3 of a kind 포함)이고 풀 하우스 25점, 스몰 스트레이트 30점, 라지 스트레이트 40점, 추가 요트 보너스와 조커 규칙이 있습니다. Online Yacht의 요트다이스는 12칸이며 풀 하우스는 다섯 눈의 합, 스몰 15점, 라지 30점이고 추가 요트 보너스가 없습니다. Online Yacht는 Hasbro의 Yahtzee 공식 제품이 아닙니다."],
  ["설치나 회원가입이 필요한가요?", "아니요. 브라우저에서 바로 AI 대전, 한 기기 대전, 친구 초대 대전을 할 수 있습니다. 계정 기록·재화·친구 목록 같은 회원 기능만 로그인이 필요합니다."],
  ["휴대폰에서도 되나요?", "네. PC·휴대폰·태블릿 브라우저를 지원하고, 홈 화면에 추가하면 앱처럼 열 수 있습니다. 오프라인 AI 대전은 한 번 연 뒤 인터넷 없이도 열립니다."],
  ["친구와 어떻게 같이 하나요?", "온라인 대전에서 친구 대전을 고르고 방을 만든 뒤 초대 링크나 6자리 코드를 보내면 됩니다. 2명부터 최대 20명까지 한 방에서 플레이할 수 있습니다."],
  ["AI는 얼마나 강한가요?", "다섯 단계가 있습니다. 매우 어려움은 1:1 승리를 목표로 학습·계산한 AI입니다. 혼자 최고 점수를 노리는 기대점수 최적 AI(DP Expert)의 평균은 정확 계산으로 약 191.8점입니다."],
  ["요트가 두 번 나오면 어떻게 하나요?", "요트 칸은 한 번만 씁니다. 이미 채웠다면 포커, 초이스, 해당 눈의 상단 칸 등 남은 칸에 적으세요. 추가 요트 보너스는 없습니다."],
  ["0점을 적어도 되나요?", "네. 조건이 맞지 않는 칸에도 0점으로 기록할 수 있습니다. 남은 칸이 나쁠 때 요트나 에이스 칸을 0점으로 쓰는 것도 흔한 선택입니다."],
  ["실제 주사위로 할 때 점수를 적을 곳이 있나요?", "있습니다. 족보·점수판 페이지에서 인원을 정하고 점수를 입력하면 상단 보너스와 합계, 승자를 자동으로 계산합니다. 기록은 이 기기에만 저장됩니다."],
];

export const PAGES = [
  {
    path: "faq/",
    crumb: "자주 묻는 질문",
    title: "요트다이스·야추 자주 묻는 질문 | 야찌와 차이 · Online Yacht",
    description: "요트다이스와 야추, 야찌(Yahtzee)의 차이, 무료 플레이·휴대폰·친구 대전·AI 난이도·점수 규칙에 대한 질문과 답.",
    jsonld: [{ "@type": "FAQPage", mainEntity: faqItems.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }],
    body: `
    <article>
      <h1>요트다이스·야추 자주 묻는 질문</h1>
      <p class="lead">Online Yacht에서 자주 받는 질문을 모았습니다. 규칙 전체는 <a href="../guide/">규칙과 족보</a>에 있습니다.</p>
      ${faqItems.map(([q, a]) => `<details open><summary>${q}</summary><p>${a}</p></details>`).join("\n      ")}
      <h2>미국식 Yahtzee와 규칙 비교</h2>
      <table>
        <caption>점수 규칙 비교</caption>
        <thead><tr><th scope="col">항목</th><th scope="col">Online Yacht (요트다이스·야추)</th><th scope="col">미국식 Yahtzee</th></tr></thead>
        <tbody>
          <tr><th scope="row">칸 수</th><td>12칸</td><td>13칸 (3 of a kind 포함)</td></tr>
          <tr><th scope="row">상단 보너스</th><td>63점 이상이면 +35</td><td>63점 이상이면 +35</td></tr>
          <tr><th scope="row">포커 / 4 of a kind</th><td>같은 눈 4개 이상이면 다섯 눈의 합</td><td>다섯 눈의 합</td></tr>
          <tr><th scope="row">풀 하우스</th><td>다섯 눈의 합</td><td>25점</td></tr>
          <tr><th scope="row">스몰 / 라지 스트레이트</th><td>15점 / 30점</td><td>30점 / 40점</td></tr>
          <tr><th scope="row">요트 / Yahtzee</th><td>50점, 추가 보너스 없음</td><td>50점, 추가 시 보너스 100점·조커</td></tr>
        </tbody>
      </table>
      ${play()}
    </article>`,
  },
  {
    path: "ai/",
    crumb: "AI 대전",
    title: "요트다이스 AI 대전 | 야추 인공지능과 무료 대결 · Online Yacht",
    description: "매우 쉬움부터 매우 어려움까지 다섯 단계 요트다이스(야추) AI와 무료로 대결하세요. 각 난이도의 특징과 AI가 고르는 방식을 설명합니다.",
    body: `
    <article>
      <h1>요트다이스 AI 대전</h1>
      <p class="lead">혼자서도 바로 시작할 수 있습니다. 다섯 단계 AI 중 하나를 골라 1:1로 대결하고, 경기가 끝나면 게임 리뷰에서 내 선택과 AI 추천을 비교해 보세요.</p>
      ${play("AI와 대결하기").replace("../#online", "../#offline")}
      <h2>난이도별 상대</h2>
      <table>
        <caption>Online Yacht AI 난이도</caption>
        <thead><tr><th scope="col">난이도</th><th scope="col">AI</th><th scope="col">특징</th></tr></thead>
        <tbody>
          <tr><th scope="row">매우 쉬움</th><td>무작위</td><td>규칙만 지키며 무작위로 고릅니다. 처음 배울 때 좋습니다.</td></tr>
          <tr><th scope="row">쉬움</th><td>강화학습(PPO)</td><td>대국 경험으로 학습한 정책입니다.</td></tr>
          <tr><th scope="row">보통</th><td>탐욕 정책</td><td>지금 적을 수 있는 높은 점수를 우선합니다.</td></tr>
          <tr><th scope="row">어려움</th><td>기대값 탐색</td><td>다시 굴렸을 때 나올 수 있는 결과의 확률을 계산합니다.</td></tr>
          <tr><th scope="row">매우 어려움</th><td>승률 중심 AI</td><td>상대 점수까지 고려해 1:1 승리를 목표로 선택합니다.</td></tr>
        </tbody>
      </table>
      <h2>기대점수 최대화와 승리 최대화는 다릅니다</h2>
      <p>혼자 최고 점수를 노리는 AI와 상대를 이기려는 AI는 같은 상황에서 다른 선택을 할 수 있습니다. 앞서 있을 때는 안정적인 칸을, 뒤처져 있을 때는 요트처럼 큰 점수를 노리는 편이 승리에 더 유리할 수 있습니다.</p>
      <ul>
        <li>기대점수 최적 AI(DP Expert)는 모든 상태를 정확히 계산하며 평균 최종 점수는 약 <strong>191.8점</strong>입니다.</li>
        <li>승률 중심 AI 계열(Win DP v2)은 이 기대점수 AI와 2만 경기를 겨뤄 50.63%의 승리점수율(무승부 0.5, 근사 95% 신뢰구간 50.41~50.85%)을 기록했습니다. 주사위 운이 큰 게임이라 강한 AI끼리의 차이는 작습니다.</li>
      </ul>
      <p>측정 방법과 신뢰구간은 공개 저장소의 <a href="https://github.com/oyueo-mm/YachtLab/blob/main/docs/context/RESULTS.md">실험 결과</a>에 있습니다.</p>
      <h2>AI에게 배우기</h2>
      <p>경기가 끝나면 <strong>게임 리뷰</strong>에서 큰 실수와 좋은 선택, AI가 추천한 킵과 점수 칸을 볼 수 있습니다. 혼자 계산해 보고 싶다면 <a href="../probability/">족보 확률 계산기</a>를 써 보세요.</p>
    </article>`,
  },
  {
    path: "multiplayer/",
    crumb: "친구 대전",
    title: "요트다이스 친구 대전 | 야추 멀티·2인용 무료 온라인 · Online Yacht",
    description: "설치 없이 링크 하나로 친구와 요트다이스(야추)를 하세요. 2인 대전부터 최대 20명 방, 빠른 대전과 관전, 재대결까지 지원합니다.",
    body: `
    <article>
      <h1>요트다이스 친구 대전</h1>
      <p class="lead">방을 만들고 링크를 보내면 친구가 브라우저에서 바로 들어옵니다. 앱 설치나 회원가입은 필요하지 않습니다.</p>
      ${play("친구 대전 방 만들기")}
      <h2>시작하는 방법</h2>
      <ol>
        <li><a href="../#online">온라인 대전</a>에서 <strong>친구 대전</strong>을 고릅니다.</li>
        <li>인원과 진행 방식(차례대로 또는 동시에)을 정하고 방을 만듭니다.</li>
        <li>초대 링크를 카카오톡·디스코드 등으로 보내거나 6자리 코드를 알려 줍니다.</li>
        <li>모두 준비되면 방장이 게임을 시작합니다.</li>
      </ol>
      <h2>지원하는 대전</h2>
      <ul>
        <li><strong>빠른 대전</strong>: 접속한 다른 플레이어와 1:1로 자동 매칭합니다.</li>
        <li><strong>친구 대전</strong>: 2명부터 최대 20명까지 한 방에서 플레이합니다.</li>
        <li><strong>관전</strong>: 공개된 방은 관전방 목록에서 볼 수 있습니다.</li>
        <li><strong>재대결</strong>: 경기가 끝나면 같은 방에서 바로 한 번 더 할 수 있고 선공이 바뀝니다.</li>
        <li><strong>한 기기 대전</strong>: 오프라인 대전에서 휴대폰 하나를 돌려 가며 플레이합니다.</li>
      </ul>
      <h2>공정한 진행</h2>
      <p>온라인 경기의 주사위와 점수는 서버가 결정하고 확인합니다. 연결이 잠시 끊겨도 같은 자리로 돌아올 수 있으며, 오래 돌아오지 않으면 기권으로 처리됩니다. 채팅은 정해진 문장과 이모티콘만 보낼 수 있습니다.</p>
      <h2>실제 주사위로 할 때</h2>
      <p>모여서 실제 주사위로 할 때는 <a href="../scores/">족보·점수판</a>으로 점수를 기록하세요. 합계와 보너스를 자동으로 계산합니다.</p>
    </article>`,
  },
  {
    path: "strategy/",
    crumb: "전략",
    title: "요트다이스 전략·공략 | 야추 확률로 보는 킵 선택 · Online Yacht",
    description: "정확한 확률 계산으로 정리한 요트다이스(야추) 전략: 상단 보너스, 요트 도전 시점, 스트레이트·풀 하우스 킵, 흔한 실수.",
    body: `
    <article>
      <h1>요트다이스 전략과 공략</h1>
      <p class="lead">아래 숫자는 공정한 주사위를 기준으로 모든 경우를 정확히 계산한 값입니다. 각 칸을 따로 노릴 때의 확률이므로 서로 겹칩니다. 직접 상황을 넣어 보려면 <a href="../probability/">확률 계산기</a>를 쓰세요.</p>
      <h2>한 차례(세 번 굴림)에 노릴 때 성공 확률</h2>
      <table>
        <caption>그 칸만 노리고 최선으로 킵할 때</caption>
        <thead><tr><th scope="col">목표</th><th scope="col">성공 확률</th><th scope="col">기대 점수</th></tr></thead>
        <tbody>
          <tr><th scope="row">스몰 스트레이트</th><td>61.54%</td><td>9.23점</td></tr>
          <tr><th scope="row">풀 하우스</th><td>36.29%</td><td>6.97점</td></tr>
          <tr><th scope="row">특정 눈 3개 이상 (상단)</th><td>35.48%</td><td>헥사 12.64점</td></tr>
          <tr><th scope="row">포커</th><td>29.08%</td><td>5.61점</td></tr>
          <tr><th scope="row">라지 스트레이트</th><td>26.11%</td><td>7.83점</td></tr>
          <tr><th scope="row">요트</th><td>4.60%</td><td>2.30점</td></tr>
        </tbody>
      </table>
      <h2>상단 보너스 63점</h2>
      <p>각 눈을 3개씩 적으면 정확히 63점입니다. 그래서 상단 칸은 "3개 기준보다 몇 점 앞서 있는가"로 생각하면 쉽습니다. 헥사 4개는 +6, 펜타 2개는 −5입니다. 앞서 있는 점수는 뒤에서 낮은 칸을 0점이나 1~2개로 메울 여유가 됩니다.</p>
      <ul>
        <li>헥사·펜타·쿼드는 3개 이상일 때 상단에 적는 것을 먼저 검토하세요.</li>
        <li>에이스·듀스는 점수가 작아 보너스 계산에 영향이 적습니다. 늦은 라운드의 실패 칸으로 쓰기 좋습니다.</li>
      </ul>
      <h2>킵 선택 예시</h2>
      <table>
        <caption>남은 굴림에 따른 확률</caption>
        <thead><tr><th scope="col">상황</th><th scope="col">목표</th><th scope="col">재굴림 1번</th><th scope="col">재굴림 2번</th></tr></thead>
        <tbody>
          <tr><th scope="row">2·3·4·5 킵</th><td>라지 스트레이트</td><td>33.33%</td><td>55.56%</td></tr>
          <tr><th scope="row">1·2·3·4 킵</th><td>라지 스트레이트</td><td>16.67%</td><td>30.56%</td></tr>
          <tr><th scope="row">같은 눈 4개 킵</th><td>요트</td><td>16.67%</td><td>30.56%</td></tr>
          <tr><th scope="row">같은 눈 3개 킵</th><td>요트</td><td>2.78%</td><td>9.34%</td></tr>
          <tr><th scope="row">두 쌍(예: 3·3·2·2) 킵</th><td>풀 하우스</td><td>33.33%</td><td>55.56%</td></tr>
          <tr><th scope="row">3·4·5 킵</th><td>스몰 스트레이트</td><td>55.56%</td><td>80.25%</td></tr>
        </tbody>
      </table>
      <p>양쪽이 열린 2·3·4·5는 1·2·3·4보다 라지 스트레이트 확률이 두 배입니다.</p>
      <h2>요트 도전은 언제?</h2>
      <p>세 번 굴림을 모두 요트에 써도 성공 확률은 4.60%입니다. 같은 눈 3개가 나왔고 굴림이 두 번 남았다면 9.34%, 4개라면 30.56%입니다. 초반에 요트 칸을 비워 두면 이후 차례마다 기회가 생기므로, 일찍 0점으로 버리기보다 다른 칸과 비교해 판단하세요.</p>
      <h2>점수 차이에 따라 전략이 달라집니다</h2>
      <p>혼자 기대점수를 최대화하는 선택과 상대를 이기는 선택은 다를 수 있습니다. 크게 앞서 있으면 안정적인 칸을, 뒤처져 있으면 요트·라지 스트레이트 같은 큰 점수를 노리는 편이 이길 가능성을 높일 때가 있습니다. <a href="../ai/">AI 대전</a>의 매우 어려움 AI는 이런 승리 중심 판단을 합니다.</p>
      <h2>흔한 실수</h2>
      <ul>
        <li>초이스 칸을 초반 높은 합계가 아닌데 써 버리기 — 초이스는 나중의 안전한 실패 칸입니다.</li>
        <li>스트레이트를 노리며 같은 눈 두 개를 모두 킵하기 — 중복된 눈은 한 개만 남기세요.</li>
        <li>상단 보너스를 계산하지 않고 낮은 상단 칸을 일찍 채우기.</li>
      </ul>
      ${play()}
    </article>`,
  },
  {
    path: "scores/",
    crumb: "족보·점수판",
    title: "요트다이스 족보·점수판 | 야추 점수 계산기 (실제 주사위용) · Online Yacht",
    description: "요트다이스(야추) 12개 족보와 점수 계산법, 실제 주사위로 할 때 쓰는 무료 다인용 점수판. 상단 보너스와 합계, 승자를 자동 계산합니다.",
    jsonld: [{ "@type": "WebApplication", name: "요트다이스 점수판", url: "https://oyueo-mm.github.io/YachtLab/scores/", applicationCategory: "GameApplication", operatingSystem: "Any", isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "KRW" } }],
    body: `
    <article>
      <h1>요트다이스 족보와 점수판</h1>
      <p class="lead">실제 주사위로 할 때 아래 점수판에 적으세요. 상단 보너스와 합계, 승자를 자동으로 계산하고 이 기기에 저장합니다. 회원가입은 필요 없습니다.</p>
      <section class="scorepad" id="scorepad" aria-label="점수판">
        <div class="pad-tools">
          <label>인원 <select id="pad-count" aria-label="인원">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option${n === 2 ? " selected" : ""}>${n}</option>`).join("")}</select></label>
          <button type="button" id="pad-reset" class="button ghost">새 게임</button>
        </div>
        <div class="pad-scroll"><table id="pad" class="pad"><caption class="sr-only">플레이어별 점수 입력</caption></table></div>
        <p id="pad-winner" class="pad-winner" role="status"></p>
        <noscript><p>점수판은 자바스크립트가 필요합니다. 족보 표는 아래에서 볼 수 있습니다.</p></noscript>
      </section>
      <h2>12개 족보</h2>
      <table>
        <caption>점수 계산</caption>
        <thead><tr><th scope="col">족보</th><th scope="col">점수</th><th scope="col">예</th></tr></thead>
        <tbody>
          <tr><th scope="row">에이스~헥사</th><td>해당 눈의 합</td><td>6·6·6·2·1 → 헥사 18</td></tr>
          <tr><th scope="row">초이스</th><td>다섯 눈의 합</td><td>6·5·5·4·3 → 23</td></tr>
          <tr><th scope="row">포커</th><td>같은 눈 4개 이상이면 다섯 눈의 합</td><td>5·5·5·5·2 → 22</td></tr>
          <tr><th scope="row">풀 하우스</th><td>3개+2개면 다섯 눈의 합</td><td>4·4·4·2·2 → 16</td></tr>
          <tr><th scope="row">스몰 스트레이트</th><td>연속 4개 이상이면 15점</td><td>1·2·3·4·6 → 15</td></tr>
          <tr><th scope="row">라지 스트레이트</th><td>연속 5개면 30점</td><td>2·3·4·5·6 → 30</td></tr>
          <tr><th scope="row">요트</th><td>5개 모두 같으면 50점</td><td>3·3·3·3·3 → 50</td></tr>
        </tbody>
      </table>
      <p>에이스~헥사 합계가 63점 이상이면 35점을 더합니다. 자세한 진행은 <a href="../guide/">규칙</a>을 보세요.</p>
      ${play("온라인으로 플레이")}
    </article>
    <script>
    (() => {
      const KEY = "yachtlab.scorepad.v1";
      const rows = [["aces","에이스 (1)"],["deuces","듀스 (2)"],["threes","트리플 (3)"],["fours","쿼드 (4)"],["fives","펜타 (5)"],["sixes","헥사 (6)"],["choice","초이스"],["four","포커"],["full","풀 하우스"],["small","스몰 스트레이트"],["large","라지 스트레이트"],["yacht","요트"]];
      const max = { aces: 5, deuces: 10, threes: 15, fours: 20, fives: 25, sixes: 30, choice: 30, four: 30, full: 30, small: 15, large: 30, yacht: 50 };
      const fixed = { small: [0, 15], large: [0, 30], yacht: [0, 50] };
      let state;
      try { state = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { state = null; }
      if (!state || !Array.isArray(state.players)) state = { players: [{ name: "플레이어 1", s: {} }, { name: "플레이어 2", s: {} }] };
      const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
      const table = document.getElementById("pad"), count = document.getElementById("pad-count"), winner = document.getElementById("pad-winner");
      const upper = (p) => rows.slice(0, 6).reduce((t, [k]) => t + (Number(p.s[k]) || 0), 0);
      const total = (p) => rows.reduce((t, [k]) => t + (Number(p.s[k]) || 0), 0) + (upper(p) >= 63 ? 35 : 0);
      const cell = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
      function render() {
        count.value = String(state.players.length);
        [...table.querySelectorAll("thead,tbody,tfoot")].forEach((n) => n.remove());
        const head = table.createTHead().insertRow();
        head.appendChild(cell("th", "족보"));
        state.players.forEach((p, i) => {
          const th = cell("th"); th.scope = "col";
          const input = cell("input"); input.value = p.name; input.setAttribute("aria-label", (i + 1) + "번 플레이어 이름"); input.maxLength = 12;
          input.addEventListener("input", () => { p.name = input.value; save(); summary(); });
          th.appendChild(input); head.appendChild(th);
        });
        const body = table.createTBody();
        rows.forEach(([k, label], r) => {
          if (r === 6) {
            const bonus = body.insertRow(); bonus.className = "pad-bonus";
            const th = cell("th", "상단 보너스 (+35)"); th.scope = "row"; bonus.appendChild(th);
            state.players.forEach((p, i) => { const td = cell("td"); td.dataset.bonus = String(i); bonus.appendChild(td); });
          }
          const tr = body.insertRow();
          const th = cell("th", label); th.scope = "row"; tr.appendChild(th);
          state.players.forEach((p, i) => {
            const td = cell("td"), input = cell("input");
            input.type = "number"; input.inputMode = "numeric"; input.min = "0"; input.max = String(max[k]);
            if (fixed[k]) input.step = String(fixed[k][1]);
            input.value = p.s[k] ?? ""; input.setAttribute("aria-label", (p.name || (i + 1) + "번") + " " + label);
            input.addEventListener("input", () => {
              const v = input.value === "" ? undefined : Math.max(0, Math.min(max[k], Math.round(Number(input.value))));
              if (v === undefined || Number.isNaN(v)) delete p.s[k]; else p.s[k] = v;
              save(); summary();
            });
            td.appendChild(input); tr.appendChild(td);
          });
        });
        const foot = table.createTFoot().insertRow(); foot.className = "pad-total";
        const th = cell("th", "합계"); th.scope = "row"; foot.appendChild(th);
        state.players.forEach((p, i) => { const td = cell("td"); td.dataset.total = String(i); foot.appendChild(td); });
        summary();
      }
      function summary() {
        state.players.forEach((p, i) => {
          const u = upper(p);
          table.querySelector('[data-bonus="' + i + '"]').textContent = u >= 63 ? "+35 (" + u + ")" : u + " / 63";
          table.querySelector('[data-total="' + i + '"]').textContent = String(total(p));
        });
        const done = state.players.every((p) => rows.every(([k]) => p.s[k] !== undefined));
        if (!done || state.players.length < 2) { winner.textContent = done ? "합계 " + total(state.players[0]) + "점" : ""; return; }
        const best = Math.max(...state.players.map(total));
        const top = state.players.filter((p) => total(p) === best).map((p) => p.name || "이름 없음");
        winner.textContent = (top.length > 1 ? "공동 1위: " : "승자: ") + top.join(", ") + " (" + best + "점)";
      }
      count.addEventListener("change", () => {
        const n = Number(count.value);
        while (state.players.length < n) state.players.push({ name: "플레이어 " + (state.players.length + 1), s: {} });
        state.players.length = n; save(); render();
      });
      document.getElementById("pad-reset").addEventListener("click", () => {
        if (!confirm("모든 점수를 지우고 새 게임을 시작할까요?")) return;
        state.players.forEach((p) => (p.s = {})); save(); render();
      });
      render();
    })();
    </script>`,
  },
  {
    path: "probability/",
    crumb: "확률 계산기",
    title: "요트다이스 확률 계산기 | 야추 족보 확률·킵 추천 · Online Yacht",
    description: "현재 주사위와 킵, 남은 굴림 횟수를 넣으면 요트다이스(야추) 각 족보의 달성 확률과 기대 점수, 최적 킵을 정확히 계산합니다.",
    jsonld: [{ "@type": "WebApplication", name: "요트다이스 확률 계산기", url: "https://oyueo-mm.github.io/YachtLab/probability/", applicationCategory: "UtilitiesApplication", operatingSystem: "Any", isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "KRW" } }],
    body: `
    <article>
      <h1>요트다이스 족보 확률 계산기</h1>
      <p class="lead">주사위 눈을 누르면 바뀌고, 아래 체크로 킵을 정합니다. 남은 재굴림 횟수에 따라 각 족보를 노릴 때의 확률을 정확히 계산합니다.</p>
      <section class="calc" aria-label="계산기">
        <div class="dice-input" id="dice" role="group" aria-label="현재 주사위"></div>
        <fieldset class="rolls"><legend>남은 재굴림</legend>
          <label><input type="radio" name="rolls" value="2" checked> 2번 (첫 굴림 직후)</label>
          <label><input type="radio" name="rolls" value="1"> 1번</label>
          <label><input type="radio" name="rolls" value="0"> 0번 (지금 기록)</label>
        </fieldset>
        <div class="calc-actions"><button type="button" class="button ghost" id="random">무작위 굴림</button></div>
        <table id="odds" class="odds">
          <caption>족보별 결과</caption>
          <thead><tr><th scope="col">족보</th><th scope="col">지금 점수</th><th scope="col">표시한 킵으로</th><th scope="col">최선의 킵으로</th><th scope="col">추천 킵</th></tr></thead>
          <tbody></tbody>
        </table>
        <p class="note" id="calc-note">표의 확률은 그 족보 하나만 노릴 때입니다. 상단(에이스~헥사)은 해당 눈 3개 이상(보너스 기준), 초이스는 24점 이상을 성공으로 셉니다.</p>
        <noscript><p>계산기는 자바스크립트가 필요합니다. 첫 굴림 확률과 전략 표는 <a href="../strategy/">전략</a> 페이지에 있습니다.</p></noscript>
      </section>
      <h2>계산 방법</h2>
      <ul>
        <li>공정한 주사위 6면, 다섯 개 주사위의 모든 경우(순서 무관 252가지)를 정확히 열거합니다. 시뮬레이션이 아닙니다.</li>
        <li>"최선의 킵"은 남은 모든 재굴림에서 그 족보의 확률이 가장 높아지도록 킵을 고르는 동적 계획법 결과입니다.</li>
        <li>"표시한 킵으로"는 지금 체크한 주사위를 남기고 한 번 굴린 뒤, 남은 굴림은 최선으로 이어 갈 때의 값입니다.</li>
        <li>점수와 족보 판정은 게임 엔진과 같은 규칙으로 7,776가지 굴림 전체를 대조해 검증했습니다.</li>
      </ul>
      <p>이 계산기는 족보 하나만 봅니다. 남은 칸과 상대 점수까지 고려한 판단은 게임의 <a href="../ai/">AI</a>와 게임 리뷰에서 확인할 수 있습니다.</p>
      ${play()}
    </article>
    <script type="module">
      import { CATEGORIES, NAMES, score, hit, afterKeep, bestKeep } from "../tools/yacht-odds.js";
      const box = document.getElementById("dice"), body = document.querySelector("#odds tbody");
      let dice = [2, 3, 4, 5, 5], kept = [true, true, true, true, false];
      const pips = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
      const pct = (v) => (100 * v).toFixed(v > 0 && v < 0.001 ? 3 : 1) + "%";
      function draw() {
        box.replaceChildren(...dice.map((v, i) => {
          const wrap = document.createElement("div"); wrap.className = "die" + (kept[i] ? " kept" : "");
          const b = document.createElement("button"); b.type = "button"; b.textContent = pips[v]; b.setAttribute("aria-label", (i + 1) + "번 주사위 " + v + ", 눌러서 바꾸기");
          b.addEventListener("click", () => { dice[i] = (dice[i] % 6) + 1; draw(); });
          const l = document.createElement("label"); const c = document.createElement("input"); c.type = "checkbox"; c.checked = kept[i];
          c.addEventListener("change", () => { kept[i] = c.checked; draw(); });
          l.append(c, " 킵");
          wrap.append(b, l); return wrap;
        }));
        compute();
      }
      function compute() {
        const rolls = Number(document.querySelector('input[name="rolls"]:checked').value);
        const keepDice = dice.filter((_, i) => kept[i]);
        body.replaceChildren(...CATEGORIES.map((c) => {
          const tr = document.createElement("tr");
          const th = document.createElement("th"); th.scope = "row"; th.textContent = NAMES[c];
          const now = document.createElement("td"); now.textContent = score(dice, c) + "점" + (hit(dice, c) ? " ✓" : "");
          const mine = document.createElement("td"), best = document.createElement("td"), rec = document.createElement("td");
          if (rolls === 0 || keepDice.length === 5) mine.textContent = hit(dice, c) ? "100%" : "0%";
          else mine.textContent = pct(afterKeep(keepDice, rolls, "hit", c)) + " · " + afterKeep(keepDice, rolls, "score", c).toFixed(1) + "점";
          const b = bestKeep(dice, rolls, "hit", c);
          best.textContent = pct(b.value) + " · " + (rolls ? bestKeep(dice, rolls, "score", c).value.toFixed(1) : String(score(dice, c))) + "점";
          rec.textContent = rolls === 0 ? "—" : b.kept.length === 5 ? "그대로" : b.kept.length ? b.kept.join("·") : "모두 다시";
          tr.append(th, now, mine, best, rec); return tr;
        }));
      }
      document.querySelectorAll('input[name="rolls"]').forEach((r) => r.addEventListener("change", compute));
      document.getElementById("random").addEventListener("click", () => { dice = dice.map(() => 1 + Math.floor(Math.random() * 6)); kept = [false, false, false, false, false]; draw(); });
      draw();
    </script>`,
  },
];
