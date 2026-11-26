# Claude 연구 세션 인수인계

2026-11-26 KST. 공개 main `31c66e3`과 v6 연구 `e78a06f`, v7 연구 `3cc01c1`을 읽기 전용으로 대조했다. v6·v7 Actions 런 16개에서 첫·끝 샤드 아카이브 32개를 확인했다. 새 대국·학습은 실행하지 않았다. [감사 코드](audit-v6-v7.py) · [감사 출력](research-audit.json) · [CI 표본 목록](ci-sample.tsv)

## 확인한 기록

- **v7 교사 자료 family 9106에서 시드 60개를 두 세션이 실제로 사용했다.** 보존된 `teacher/`의 116경기와 `teacher-v72/`의 200경기에서 `(shard, game, seed)`를 대조했다. shard 0은 33개, shard 1은 27개가 동일했다. 두 세션을 독립 표본으로 합산하거나 서로를 홀드아웃으로 쓰면 검증 독립성이 깨진다. 1,160개와 2,000개 국면은 경기별로 군집화된다. [v7 운영 기록](../../context/V7-APEX-RESEARCH.md#92-개발-계획-개발-family-9107--제품-트랙-개발-대국-전용-홀드아웃-아님)
- **v7 개발 대국 family 9107의 shard 1이 네 대진에서 두 번 로그에 남았다.** 각 대진의 승·무·패 및 쌍별 승점 모멘트는 일치하고, elapsed/판단 시간은 달랐다. 남아 있는 원본은 대진별 5샤드·5,000쌍이다. 원본으로 다시 계산한 승리점수율 50.390%, 49.905%, 50.250%, 49.865%가 공개 요약과 각각 일치했다. `shards.log`를 그대로 합산하면 대진마다 1,000쌍을 중복 계산한다. [중복 로그](../../../training/results/v7/dev-9107/shards.log) · [공개 집계](../../../training/results/v7/dev-9107/summary.md)
- **확인한 대국 원본에서 의도하지 않은 시드 주소 중복, 점수 불일치, 다른 입력의 캐시 결과가 섞인 흔적은 발견하지 못했다.** 저장소 69개 샤드와 CI 표본 96개 샤드, 합계 218,600쌍의 시드·승·무·패를 재계산했다. 동일 family 내 다른 비교 대진의 공통 난수 사용과 좌석 교대는 실험 설계의 일부다. 요약 153행 중 81행은 원본과 대조했다. 요약만 확인된 72행의 실제 시드와 해시, CI 중간 샤드, 중단 당시 로컬 캐시, 그리고 커밋 메타데이터가 없는 v6 family 9011의 6개 파일은 실행 입력 전체를 소급 검증할 수 없다. [v6 연구 기록](../../context/V6-APEX-RESEARCH.md) · [v7 연구 기록](../../context/V7-APEX-RESEARCH.md)
- **래퍼는 덜 실행한 캐시를 완료로 인식할 수 있다.** 이전 격리 감사에서 1쌍을 계산한 뒤 같은 경로에 2쌍을 요청하자 기존 1쌍 파일을 재사용했다. 파일 이름에 대진·family·shard만 있고 존재 여부만 본다. 벤치마크가 gzip을 최종 경로에 직접 쓰므로 중단 시 부분 파일도 통과할 수 있다. 이전 감사에서 확인한 선형 시드 주소 충돌 사례는 `9099/s50/i0`과 `9100/s0/i547`이다. 보존된 자료에서 실제 중복을 확인한 범위는 위의 교사 자료 및 중복 로그다. [래퍼](../../../scripts/research-v7/run-jobs.sh) · [실행기와 시드](../../../scripts/research-v5/bench.ts#L28) · [이전 재현](https://github.com/oyueo-mm/YachtLab/blob/codex/independent-audit-followup-20261126/docs/audits/followup-2026-11-26/research.md)

## 다음 실행에 적용할 순서

1. 실험 매니페스트를 해시한다. 규칙과 스키마, 고정된 Git 커밋과 dirty diff, 실행기와 전이 의존성, 양쪽 정책·옵션, 모델·DP/PMF 자산의 SHA-256, 런타임, family·shard·절대 pair 시작·목표 길이를 포함한다. 동시 세션은 쓰기 전에 매니페스트와 예약 범위를 공유하고 일치하는 산출물만 재사용한다.
2. 새 확증 계획은 기존 시드 등록부와 대조한다. 레거시 실험의 seed 값을 유지한다. 새 계획에는 전역에서 겹치지 않는 pair 범위 또는 역함수가 있는 32비트 순열과 검증된 주소 인코딩을 사전등록한다. 비교용 공통 난수 사용은 매니페스트에 의도를 기록한다.
3. 두 좌석의 결과가 모두 들어간 pair를 100–500개 단위로 체크포인트에 저장한다. 범위·체크섬을 검사한 뒤 원자적으로 게시하고 누락 범위만 재개한다. 게시된 같은 범위와 내용은 재사용하고, 내용이 다른 경우 충돌로 기록한다. 프로세스 종료 코드는 보존하고 작업 실패를 집계 작업에 전달한다.
4. 중간 집계에는 완료된 고유 pair 수, 승점 합·제곱합, 미완료 범위 및 실행 ID를 남긴다. 확증 판정은 사전등록한 표본과 종료 규칙을 따른다. 교사 데이터의 평가는 게임 시드별로 학습·검증을 나눈다. 기존 원본과 요약은 보관하고, 중복 제외가 필요한 경우 별도의 파생 보고서를 만든다.

[독립 체크포인트 프로토타입](../followup-2026-11-26/checkpoints.mjs) · [프로토타입 테스트](../followup-2026-11-26/checkpoints.test.mjs)

## 읽기 전용 재현

저장소 루트에서 해당 리비전을 fetch한 뒤 실행한다. CI 표본까지 확인하려면 `ci-sample.tsv`의 아카이브를 `<dir>/<run>/<artifact>/`에 압축 해제하고 두 번째 명령을 실행한다.

```sh
python docs/audits/release-hardening-2026-11-26/audit-v6-v7.py 31c66e3 e78a06f 3cc01c1
python docs/audits/release-hardening-2026-11-26/audit-v6-v7.py 31c66e3 e78a06f 3cc01c1 \
  --artifact-dir /tmp/yachtlab-research-archives \
  --artifact-plan docs/audits/release-hardening-2026-11-26/ci-sample.tsv
node --test docs/audits/followup-2026-11-26/checkpoints.test.mjs
```
