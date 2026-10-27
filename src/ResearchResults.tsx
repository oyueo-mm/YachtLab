import research from "./research-summary.json";
export default function ResearchResults() {
  return (
    <details className="panel research-results">
      <summary>DP 정책 증류 · 실제 학습과 평가 결과</summary>
      <p>
        학습 상태 {research.trainingStates.toLocaleString("ko-KR")}개 · 검증{" "}
        {research.validationStates.toLocaleString("ko-KR")}개 · {research.width}
        ×{research.width} 신경망
      </p>
      <p>
        동등 최적 행동 일치율 {(research.accuracy * 100).toFixed(2)}% · Top-3{" "}
        {(research.top3 * 100).toFixed(2)}% · 평균 DP 가치 손실{" "}
        {research.regret.toFixed(3)}점
      </p>
      <p>
        모방학습 체크포인트 {research.gradientUpdates.toLocaleString("ko-KR")}회
        업데이트. PPO 추가 학습 {research.ppoSteps.toLocaleString("ko-KR")}스텝
        중 검증 점수로 선택한 체크포인트는{" "}
        {research.ppoCheckpointSteps.toLocaleString("ko-KR")}스텝입니다.
      </p>
      <div className="table-scroll">
        <table>
          <caption>
            새로운 미사용 시드 · 각{" "}
            {research.gamesPerAlgorithm.toLocaleString("ko-KR")}경기
          </caption>
          <thead>
            <tr>
              <th>AI</th>
              <th>평균 총점</th>
              <th>95% 신뢰구간</th>
            </tr>
          </thead>
          <tbody>
            {research.algorithms.map((r) => (
              <tr key={r.algorithm}>
                <th>{r.algorithm}</th>
                <td>{r.mean.toFixed(2)}</td>
                <td>{r.ci95.map((v) => v.toFixed(2)).join(" ~ ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small-note">
        PPO 추가 학습의 평균 점수는 모방학습 모델보다 낮았습니다. 기존 PPO와 DP
        Expert는 보존했습니다. 최종 평가 세트는 학습·검증 및 v0.3 평가와
        분리했습니다.
      </p>
      <div className="research-links">
        <a
          href={`${import.meta.env.BASE_URL}research/learning-curves.svg`}
          target="_blank"
          rel="noreferrer"
        >
          실제 학습 곡선
        </a>
        <a
          href="https://github.com/oyueo-mm/YachtLab/blob/main/benchmarks/v04/REPORT.md"
          target="_blank"
          rel="noreferrer"
        >
          실험 설정·전체 결과
        </a>
      </div>
    </details>
  );
}
