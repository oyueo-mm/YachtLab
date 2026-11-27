# CI-1.1 — 연구 워크플로의 브랜치 보호 호환 (운영 가이드)

> 상태: 구현 완료, **병합·관리자 설정 적용 전**. 선행: [CI-1 가이드](./CI-1-CONTEXT-SYNC-PROTECTION.md)(#128). 이 문서는 #128의 §10("main에 직접 push하는 연구 워크플로 26개")을 해소합니다.
> 근거 코드: `scripts/ci/publish-generated.mjs`(`--scope-to-allow`, `--preserve-history`), 26개 연구 워크플로의 게시 단계, `scripts/ci/audit-workflows.mjs`, 테스트 `tests/ci-publish-generated.test.ts`(research publish), `tests/ci-context-flow.test.ts`(정적 계약).

## 1. 무엇이 바뀌었나

| | 전 | 후 |
|---|---|---|
| 게시 방식 | 보고서 파일을 `[skip ci]` 커밋으로 `git push origin HEAD:main` (재시도 루프) | 워크플로(잡)별 자동화 브랜치 `automation/research-…`의 **PR 1개**로 게시, 필수 `ci-result`를 실행 |
| 허용 파일 | `git add`에 적힌 파일 | 같은 파일을 `--allow "<정확한 파일>"`로 명시(디렉터리 허용 없음). 그 밖의 파일(내려받은 아티팩트·`training/`·다른 연구의 보고서)은 **무시**되어 커밋되지 않음 |
| 권한 | `contents: write`(+`actions: read`) | `contents: write` + `pull-requests: write` + `actions: write` — 게시 잡 한정 |
| 실험 | — | **변경 없음**: 알고리즘·설정·시드·경기 수·평가 기준·결과·아티팩트 업로드(90일 보존)는 그대로. 제거된 줄은 옛 `git config/add/commit/pull/push` 단계와 권한 줄뿐 |
| `audit-workflows.mjs --strict` | 26개 발견, exit 1 | **0개, exit 0** |

게시 단계 하나는 두 스텝으로 바뀌었습니다: `Publish …`(id `publish`, 기존 단계 이름 유지)와 `Start the required CI on the research report PR`(`ensure-ci`). 기존 `if: github.event_name != 'pull_request'` 조건은 두 스텝에 그대로 복사했습니다.

### 게시 브랜치와 허용 파일 (잡 30개)

| 워크플로 | 브랜치 | 허용 파일 (`docs/context/_generated/` 아래) |
|---|---|---|
| `algorithm-zoo.yml` | `automation/research-algorithm-zoo` | `zoo-summary.json`, `LATEST_EXPERIMENT.md` |
| `br-error-enumeration.yml` | `automation/research-br-error-enumeration` | `BR-ERRORS-LATEST.md` |
| `br-research.yml` | `automation/research-br-research` | `BR-RESEARCH-LATEST.md` |
| `discovered-external.yml` | `automation/research-discovered-external` | `NEW-EXTERNAL-RESEARCH-LATEST.md` |
| `external-championship.yml` | `automation/research-external-championship` | `EXTERNAL-CHAMPIONSHIP-LATEST.md` |
| `followup-ablations.yml` | `automation/research-followup-ablations-v33` | `FOLLOWUP-V33-LATEST.md` |
| `followup-ablations.yml` | `automation/research-followup-ablations-v34` | `FOLLOWUP-V34-LATEST.md` |
| `followup-ablations.yml` | `automation/research-followup-ablations-v4` | `FOLLOWUP-V4-LATEST.md` |
| `foundation-v4-tournament.yml` | `automation/research-foundation-v4-tournament` | `FOUNDATION-4WAY-50K-LATEST.md` |
| `frontier-200k.yml` | `automation/research-frontier-200k` | `FRONTIER-*.md` |
| `full-selfplay.yml` | `automation/research-full-selfplay` | `SELFPLAY-LATEST.md` |
| `native12-dqn.yml` | `automation/research-native12-dqn` | `NATIVE12-DQN-LATEST.md` |
| `neural-selfplay.yml` | `automation/research-neural-selfplay` | `NEURAL-SELFPLAY-LATEST.md` |
| `offpolicy-ppo-expanded.yml` | `automation/research-offpolicy-ppo-expanded` | `FULLGAME-RL-ZOO-LATEST.md`, `PPO-HIGH-BUDGET-0.md`, `PPO-HIGH-BUDGET-1.md`, `PPO-HIGH-BUDGET-2.md`, `PPO-HIGH-BUDGET-LATEST.md` |
| `psro-extended.yml` | `automation/research-psro-extended` | `PSRO-ORACLE-AUDIT.md`, `SCORECARD-PMF-LATEST.md`, `PPO-MULTISEED-0.md`, `PPO-MULTISEED-1.md`, `PPO-MULTISEED-2.md`, `PPO-MULTISEED-LATEST.md` |
| `psro-ppo.yml` | `automation/research-psro-ppo` | `PSRO-LATEST.md`, `PMF-LATEST.md`, `PPO-LATEST.md` |
| `qr-20k.yml` | `automation/research-qr-20k` | `QR-20K-LATEST.md` |
| `qr-autoresearch.yml` | `automation/research-qr-autoresearch` | `QR-AUTORESEARCH-LATEST.md` |
| `qr-deep-research.yml` | `automation/research-qr-deep-research` | `QR-SUITE-LATEST.md` |
| `qr-followup.yml` | `automation/research-qr-followup` | `QR-FOLLOWUP-LATEST.md` |
| `qr-four-pillars.yml` | `automation/research-qr-four-pillars` | `QR-FOUR-PILLARS-LATEST.md` |
| `research-50k-league.yml` | `automation/research-50k-league-budget` | `RESEARCH-50K-BUDGET-LATEST.md` |
| `research-50k-league.yml` | `automation/research-50k-league` | `RESEARCH-50K-LEAGUE-LATEST.md` |
| `sota-attack-lab.yml` | `automation/research-sota-attack-lab-attack` | `SOTA-ATTACK-LATEST.md` |
| `sota-attack-lab.yml` | `automation/research-sota-attack-lab-qr-retrain` | `SOTA-QR-RETRAIN-LATEST.md` |
| `sota-independent-confirm.yml` | `automation/research-sota-independent-confirm` | `SOTA-CONFIRM-LATEST.md` |
| `v31-large.yml` | `automation/research-v31-large` | `V31-LARGE-LATEST.md` |
| `v31-research.yml` | `automation/research-v31-research` | `V31-LATEST.md` |
| `v32-research.yml` | `automation/research-v32-research` | `V32-LATEST.md` |
| `yahtzeerl-transfer.yml` | `automation/research-yahtzeerl-transfer` | `YAHTZEERL-TRANSFER-LATEST.md` |

한 파일은 정확히 한 브랜치에서만 게시됩니다(테스트가 중복을 막음). 따라서 서로 다른 연구의 PR끼리는 같은 파일을 건드리지 않습니다.

## 2. 미병합 결과가 유실·덮어쓰기 되지 않는 방식

연구 PR은 사람이 바로 병합하지 않을 수 있어 같은 브랜치에 다음 실행이 닿을 수 있습니다. 그래서 CI-1의 Context sync(항상 main에서 재생성하는 "순수 함수" 브랜치)와 달리 **기록을 보존하는 방식**을 씁니다.

- **강제 푸시 없음.** 매 실행이 기존 브랜치 끝 위에 새 커밋을 얹고(최신 main을 병합), 일반 `git push`(fast-forward만)로 올립니다.
- **같은 워크플로의 연속 실행.** 두 번째 실행의 보고서가 같은 파일명을 갱신하면 PR의 최종 내용은 최신 값이 되고, **첫 번째 실행의 커밋은 PR 기록에 남습니다**(`git show <첫 커밋>:<파일>`로 복구). 원본 실행 링크는 PR 본문에, 원본 결과 파일은 실행 아티팩트(90일)에 있습니다.
- **서로 다른 연구의 동시 실행.** 브랜치·PR·허용 파일이 서로 달라 간섭이 없습니다.
- **같은 브랜치에 동시에 두 잡이 쓸 때.** 한쪽의 push가 non-fast-forward로 실패하면 다시 가져와 상대의 커밋 위에서 병합한 뒤 재시도합니다(최대 6회, 지수 대기). 두 보고서가 모두 남습니다.
- **최신 main 갱신.** main이 앞서 있으면 이번 실행이 그 main을 브랜치에 병합 커밋으로 합칩니다. 이때 3-way 병합(main, 브랜치) + 이번 실행의 파일로 트리를 만들며, **main과 미병합 브랜치가 같은 파일을 서로 다르게 바꿨다면** 아무것도 덮어쓰지 않고 중단합니다(브랜치 불변, 오류 메시지 안내). 열린 PR을 병합하거나 닫은 뒤 재실행하세요.
- **병합 뒤.** 남아 있는 옛 브랜치는 병합본이 main에 포함돼 있으면(merge commit이든 squash든) 변경 없음으로 처리되고, 새 실험이 오면 그 위에 fast-forward로 새 커밋이 쌓입니다.
- **main이 앞서간 뒤 새 실행이 없을 때.** 열린 연구 PR은 "최신 base" 규칙에서 뒤처진 상태로 남을 수 있습니다. PR의 **Update branch** 버튼(사람이 누르면 일반 PR처럼 CI가 시작됨)을 쓰거나 해당 워크플로를 다시 실행하세요. 자동 재작성은 하지 않습니다(새 연구 결과가 없는 브랜치를 건드리지 않기 위해).

## 3. 필수 CI

각 게시 단계 뒤의 `ensure-ci`가 그 커밋에 대한 `deploy.yml` 실행이 없으면 `workflow_dispatch`로 시작합니다(CI-1과 동일). 변경이 `_generated`뿐이므로 scope=`docs`이고 `ci-result`는 곧 통과합니다. 실행이 보이지 않으면 단계가 실패해 PR이 조용히 병합 불가가 되지 않습니다. `[skip ci]`는 쓰지 않습니다.

## 4. 권한

게시 잡 30개에 `contents: write`(자동화 브랜치 push; 스크립트가 `automation/…` 외 브랜치를 거부), `pull-requests: write`(PR 생성·갱신), `actions: write`(`deploy.yml` dispatch; 아티팩트 읽기 포함, 기존 `actions: read` 대체). 시크릿·PAT·GitHub App 추가 없음. 관리자 설정은 #128과 동일한 1개(`Allow GitHub Actions to create and approve pull requests`)입니다.

## 5. 검증 결과

| 시나리오 | 방식 |
|---|---|
| 첫 게시: main 기반 브랜치, 허용 파일만, 나머지 작업 트리 변경 무시 | 모의(임시 git + 가짜 `gh`) |
| 같은 워크플로 연속 실행: fast-forward, 이전 결과 보존 | 모의 |
| 서로 다른 연구: 별도 브랜치·PR | 모의 |
| main이 앞섬: main 병합, 미병합 결과·새 파일·main 변경 모두 보존 | 모의 |
| 같은 브랜치 동시 push 경쟁: 재시도 후 두 결과 모두 보존 | 모의(경쟁 쓰기 시뮬레이션) |
| main·브랜치 같은 파일 충돌: 중단, 브랜치 불변 | 모의 |
| 병합 뒤 재사용(squash 동일 내용 → 무변경, 새 내용 → fast-forward) | 모의 |
| shallow checkout(연구 잡의 기본)에서 동작 | 모의 |
| 와일드카드(`FRONTIER-*.md`)와 허용 경로 규칙 | 단위 |
| 30개 단계의 정적 계약: 고유 브랜치, 정확한 허용 파일, 권한 3종, `ensure-ci`, main push·`[skip ci]` 없음 | 정적 테스트 |
| 26개 YAML 파싱, `audit-workflows.mjs --strict` exit 0 | 실제(로컬) |
| 필수 CI(`ci-result`) | 최종 커밋은 GitHub CI(PR Checks). 자동 연구 PR에서의 `ensure-ci`는 **병합 뒤 첫 연구 실행**에서 확인해야 함 |
| 대규모 연구 26개 실제 실행 | **하지 않음**(요구사항). 실제 연구 실행으로 PR이 만들어지는 흐름은 미검증 |

모의 통과를 운영 검증으로 보지 마세요. 같은 이유로 CI-1과 마찬가지로 PR 생성 설정이 꺼져 있으면 실제 연구 PR은 만들어지지 않습니다(브랜치는 push되고 재실행이 PR만 만듭니다).

## 6. 적용 절차 (Work)

### 6.1 병합 순서와 base 변경
이 PR의 base는 `#128`(`claude/ci-1-context-sync-protection`)입니다. 이 브랜치는 #128의 마지막 커밋 `dff4bfb` 위에 쌓여 있습니다.

1. #128 병합(필요 설정 포함, CI-1 §8 선행 작업).
2. 이 PR의 base를 `main`으로 변경: PR 화면 → **Edit** → base branch `main`. #128이 **merge commit**이나 **rebase**로 병합되었다면 이 PR의 diff는 자동으로 CI-1.1 변경만 남습니다.
3. #128을 **squash**로 병합했다면 기록이 달라 이 PR에 #128의 커밋이 중복되어 보입니다. 이때는 아래로 정리합니다(강제 푸시가 필요한 작업이므로 이 브랜치에 한해 담당자와 합의 후):
   ```bash
   git fetch origin
   git rebase --onto origin/main dff4bfb claude/ci-1-1-research-publish
   git push --force-with-lease origin claude/ci-1-1-research-publish
   ```
   (`dff4bfb`는 #128의 마지막 커밋, 즉 이 브랜치의 분기점.)
4. base 변경과 재푸시 후 PR의 `ci-result`를 확인합니다.

### 6.2 이 PR을 병합할 때 — 연구 워크플로 25개가 push로 시작됩니다
이 PR은 26개 워크플로 파일을 모두 바꾸고, 그 파일들은 각자의 `push(main)`·`pull_request` `paths`에 들어 있습니다. 그래서
- **PR을 열고 갱신할 때마다** 그 워크플로가 `pull_request`로 시작합니다(`duel` 같은 대형 잡은 이미 `!= pull_request` 조건으로 제외되지만, 일부 워크플로는 PR에서도 실험 잡을 실행하도록 만들어져 있음). 이 PR에서는 불필요한 대규모 실행을 만들지 않도록 실행 직후 취소했습니다(보고서의 "최종 CI" 참고).
- **main에 병합되면** `push(main)` 필터에 걸린 **25개**(`qr-deep-research.yml`만 제외)가 실제 연구 실험으로 시작될 수 있습니다.

권장: 병합 커밋(또는 스쿼시) 메시지에 **`[skip ci]`** 를 넣어 병합 push로는 워크플로가 시작되지 않게 합니다. 이 PR의 필수 CI는 이미 PR에서 통과한 상태이고, 병합 변경은 사이트·Pages에 영향이 없습니다. 이를 지키지 못했다면 Actions 탭에서 시작된 연구 실행을 취소(Cancel)하세요. 병합 뒤 실제 연구는 평소처럼 `workflow_dispatch`로 실행합니다.

### 6.3 보호 규칙을 켜기 전 확인
```bash
node scripts/ci/audit-workflows.mjs --strict   # exit 0 이어야 함
```
그 다음 CI-1 가이드 §8의 ruleset을 적용합니다. 자동화 브랜치(`automation/**`)에는 별도 규칙이 필요 없고, 연구 브랜치는 강제 푸시를 쓰지 않으므로 "강제 푸시 금지"를 적용해도 됩니다(브랜치 삭제는 PR이 불필요해질 때 `gh pr close --delete-branch`가 사용하므로 `automation/**`에는 삭제 금지를 걸지 마세요).

### 6.4 병합 뒤 첫 확인
1. 가벼운 연구 워크플로 하나(예: 사용자 판단)를 `workflow_dispatch`로 실행 → `automation/research-…` PR이 생기고 `ci-result`가 PR에 붙는지 확인 → 병합.
2. 병합 후 재실행 시 "변경 없음"(noop) 또는 새 내용 fast-forward인지 확인.

## 7. 실패 시 복구·롤백

| 증상 | 원인 | 조치 |
|---|---|---|
| `PR 생성이 거부됨…` | PR 생성 허용 설정 꺼짐 | 설정 후 해당 워크플로의 게시 잡만 재실행(Re-run) — 브랜치는 이미 push됨 |
| `…같은 파일을 서로 다르게 바꿨음…중단` | main과 미병합 브랜치의 같은 파일 충돌 | 열린 PR 병합/닫기 후 게시 잡 재실행. 결과는 아티팩트(90일)에도 있음 |
| `push가 6번 모두 실패` | 장시간 경쟁·권한 | 게시 잡 재실행(재실행은 안전: 기존 브랜치에 병합) |
| `필수 체크 없이는 병합할 수 없으므로…` | `deploy.yml` 실행이 안 보임 | 게시 잡 재실행 또는 PR에서 Update branch |
| 보고서가 PR에 없음 | 허용 파일 목록에 없는 이름 | 워크플로의 `--allow`를 점검(테스트가 정확한 이름을 강제) |

롤백: 이 PR 병합 커밋을 `git revert -m 1`(보호 규칙을 켠 뒤라면 PR로). 되돌리면 옛 직접 push 방식으로 복귀하며 **보호 규칙과 양립하지 않습니다**(CI-1 §10). 자동화 브랜치·PR은 닫고 삭제해도 안전하며 결과는 아티팩트/PR 기록에서 복구할 수 있습니다.

## 8. 잔여 위험·미검증

- 실제 연구 실행으로 PR을 만드는 흐름과 `ensure-ci` 결과는 병합 후 확인 전까지 **모의**입니다.
- 연구 PR이 쌓이면 사람이 병합해야 `main`에 반영됩니다(이전에는 자동 반영). 병합하지 않은 보고서는 `main` 문서에서 보이지 않습니다.
- PR 병합 시 워크플로 push 트리거(§6.2) — 운영 절차(`[skip ci]` 또는 취소)에 의존합니다.
- 서로 다른 두 연구가 나중에 같은 보고서 파일을 게시하도록 바뀌면 PR 병합 시 충돌합니다(테스트가 현재 중복을 막음).
