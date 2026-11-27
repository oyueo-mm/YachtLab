# C1 경제 v2 검증 자료

| 자료 | 입력과 의미 |
|---|---|
| [E8](E8) | 가격 탐색 및 패키지 탐색, 개발 시드 |
| [E9](E9) | 4시간 예산, Rev.1/2와 모드별 지급 |
| [E10](E10) | 연차·선호·초기자산·Rev.1/2·채팅 38종 민감도 |
| [E11](E11) | C1-PRICE 위 부스터, 할인권과 무료 뽑기권 |
| [E12](E12) | 기권·반복 상대·장시간 활동·재가입 민감도 |
| [E13](E13) | 180일 신규 및 수집형 소진·강화 |
| [H1](H1) | 고정 홀드아웃 4개 시드, 후보별 집계·대응 원시표본·Pareto |
| [replay](replay) | E0~E7 역사적 정의 재실행과 원본 대조 상태 |
| [설정](candidates.json) | 후보별 전체 수치와 서브정책 |
| [카탈로그와 뽑기](catalog-and-draw.json) | 코드 기준선과 제안별 가격 및 품목별 확률 |
| [상한](capacity.json) | 계정 상한과 공유 용량을 따로 계산한 이론 상한 |
| [공유 방 용량](shared-capacity.json) | KST 계정 시작 제한 및 UTC 공용 할당의 이벤트 스트레스 |
| [지급 내역·부스터 매칭](sources-and-booster-traffic.json) | 저트래픽 업적 분해, 동일 30분 신규 세션 조건 대조 |
| [강화 뒤 거래 흐름](upgrade-progression.json) | Lv.2/Lv.3 도달과 그 이후 구매 간격 |
| [가상 모집단](population.json) | 저·고활동 가정, 발행·잔액·고정가치 집중도 |
| [가상 구매자 원장](synthetic-ledger.json.gz) | SKU, 통화, 유형, 단계, 가상 계정별 이전 비용 추정 |
| [그림](figures) | 원시 H1/E9 및 정확 뽑기 모형으로 생성한 SVG |

[한국어 최종 보고서](../../ECONOMY-V2-RESEARCH.md) · [C5 인수인계](../HANDOFF-C5-ECONOMY-V2.md)

## 재현

Node.js 24, npm 잠금 파일 기준으로 설치한다. 그림에 Python matplotlib 3.10을 사용했다. 원시 과거 결과를 덮어쓰지 않게 출력 폴더를 명시한다.

```bash
npm ci
node --import tsx scripts/economy/v2/run.ts --workers 2 --out /tmp/yachtlab-c1-replay
python3 scripts/economy/v2/compare-replay.py docs/economy/v2 /tmp/yachtlab-c1-replay /tmp/yachtlab-c1-replay/comparison.json
node --import tsx scripts/economy/v2/run.ts --exp H1 --workers 2 --out /tmp/yachtlab-c1/H1
node --import tsx scripts/economy/v2/audit-summary.ts /tmp/yachtlab-c1/H1
node --import tsx scripts/economy/v2/audit-analytics.ts /tmp/yachtlab-c1
```

추가 블록은 `--exp E8` 식으로 선택한다. `--candidate` 및 `--exp`는 반복 지정할 수 있다. `--seed`는 개발 블록 시드를 바꾸며 H1은 사전 고정값을 사용한다. 완료 Job은 체크포인트 JSON에 원자적으로 저장되고, 코드·Node·카탈로그·Job 옵션이 같은 재실행에서 자동으로 읽힌다. 파일 경로가 다른 출력에는 재계산이 발생한다. 결과 셀과 E1 CSV는 완료 순서와 무관하게 정렬한다. BASE E1 소규모 체크에서 12개 Job을 재개해 두 번째 실행에서 0개 워커, 바이트 동일 결과를 확인했다. [재개 로그](logs/checkpoint-resume.log) `meta.json`은 설정·코드 해시를 담는다. E8~E13과 H1의 `job-settings.json.gz`는 각 셀의 후보, 시드, 모델 옵션을 담는다.

정수 견적 교정 후 H1, E8, E10~E13은 `5f55fb0`, 전 품목 Rev.1 대조 후 현행 가격만 쓰는 E9는 `25bbcbd`에서 실행했다. 실제 사용 시드는 `meta.json`과 셀별 Job 설정에 있다. 역사 재실행은 `024268a` 및 동치성 확인 후 최적화한 `616f2ca`를 사용했다. 최초 470개 사용자·후보 실행과 이후 워밍업 캐시 141개 실행의 전 결과를 원본 엔진 및 동일 옵션 실행과 독립적으로 비교했다.
