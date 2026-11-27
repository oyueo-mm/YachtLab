# CI-1 — Context sync·Wiki·CI의 브랜치 보호 호환 (운영 가이드)

> 상태: 구현 완료, **main 병합·관리자 설정 적용 전** (Work·운영자 승인 대기). 이 문서는 Work가 그대로 따라 할 수 있는 절차서입니다.
> 근거 코드: `.github/workflows/context-sync.yml`, `context-wiki.yml`, `deploy.yml`, `scripts/ci/publish-generated.mjs`, `scripts/ci/sync-wiki.mjs`, `scripts/ci/audit-workflows.mjs`, 테스트 `tests/ci-publish-generated.test.ts`, `tests/ci-context-flow.test.ts`.

## 1. 한 줄 요약

생성 문서는 이제 **main에 직접 push하지 않고** 자동화 전용 브랜치 `automation/context-sync`의 **단 하나의 PR**로만 들어옵니다. 그 PR에는 실제 `ci-result` 체크가 실행되며(`workflow_dispatch`), 병합되면 Wiki가 별도 워크플로로 갱신됩니다. 따라서 main에 "PR 필수 + `ci-result` 필수" 규칙을 켜도 Context sync·Wiki·CI·Pages가 동작합니다. 단, **연구 실험 워크플로 26개는 아직 main에 직접 push**하므로 §10을 먼저 보세요.

## 2. 변경 전 → 후

**전**
```
main push / 매일 00:20 UTC / 수동
 └ Context sync(sync 잡, contents: write)
     ├ node scripts/update-context.mjs --write
     ├ 변경되면 git commit "[skip ci]" → git push origin HEAD:main      ← 보호 규칙에서 거부됨
     └ 같은 잡에서 Wiki push (continue-on-error)                       ← 실제로는 매번 "Repository not found"로 실패 중이었음(2026-11-27 run 46038105975 로그)
```
**후**
```
main push(생성물 외 변경) / 매일 00:20 UTC / 수동
 └ Context sync · sync 잡 (contents/pull-requests/actions: write — 잡 한정)
     1. update-context.mjs --write                      (작업 트리에만 쓴다)
     2. publish-generated.mjs publish
          · 허용 경로(docs/context/_generated/) 밖의 변경 → 즉시 실패
          · 현재 origin/main 위에 커밋 1개를 만들어 automation/context-sync 에 force-with-lease push
          · 같은 PR이 열려 있으면 갱신, 없으면 생성, main과 같아졌으면 PR을 닫고 브랜치 삭제
     3. publish-generated.mjs ensure-ci                 (그 커밋에 대한 deploy.yml 실행이 없으면 workflow_dispatch로 시작)
 PR 병합(main push, _generated만 변경) → Context sync는 paths-ignore로 실행되지 않음
 └ Context wiki(별도 워크플로): 병합된 main의 docs/context를 Wiki로 미러
```

## 3. 필요한 권한

| 대상 | 권한 | 이유 |
|---|---|---|
| Context sync `check` (PR) | `contents: read` | 검증만. 시크릿 없음 |
| Context sync `sync` 잡 | `contents: write` | `automation/*` 브랜치 push (스크립트가 그 외 브랜치를 거부) |
| | `pull-requests: write` | 자동화 PR 생성·수정·닫기 |
| | `actions: write` | `deploy.yml`을 `workflow_dispatch`로 시작 (GITHUB_TOKEN이 새 실행을 만들 수 있는 유일한 이벤트) |
| Context wiki `mirror` 잡 | `contents: write` | Wiki 저장소(`<repo>.wiki.git`)는 contents 권한으로 접근. 이 잡은 main 저장소에 push하지 않음 |
| 그 외 모든 워크플로 | 변경 없음 | `deploy.yml`의 `pages: write` / `id-token: write`는 deploy 잡 한정 그대로 |

시크릿 추가·변경 없음. 광범위 PAT·GitHub App·유료 기능 도입 없음. `pull_request_target`은 저장소 어디에도 없으며(테스트가 확인), PR 코드는 쓰기 토큰·시크릿에 접근하지 못합니다.

### 필요한 관리자 설정 (1개, **적용하지 않았음**)

`Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and approve pull requests"` 체크.
- 꺼져 있으면 `gh pr create`가 실패하고 sync 잡이 빨갛게 됩니다(브랜치는 이미 push되어 있고, 재실행하면 PR만 만듭니다).
- 이 값은 이 환경의 토큰으로 조회할 수 없어(`/actions/permissions/workflow` 403) **현재 값은 미확인**입니다. 조직 정책으로 막혀 있다면 §4의 대안 B(GitHub App)가 필요하며 별도 승인을 받겠습니다.
- 워크플로 기본 권한(Read repository contents)은 그대로 둬도 됩니다. 필요한 권한은 모두 잡 단위로 선언합니다.

## 4. `GITHUB_TOKEN`으로 만든 PR의 필수 CI

GitHub 정책상 `GITHUB_TOKEN`으로 push/PR을 만들면 `push`·`pull_request` 워크플로가 **시작되지 않습니다**(예외: `workflow_dispatch`, `repository_dispatch`). 그대로 두면 `ci-result`가 영원히 안 나타나 PR이 병합 불가가 됩니다.

채택안 **A — `workflow_dispatch`로 진짜 deploy.yml 실행**: `ensure-ci`가 자동화 브랜치에서 `deploy.yml`을 시작합니다. 체크 런은 PR head 커밋에 붙으므로 PR의 필수 체크 `ci-result`가 됩니다. 같은 잡들이 같은 정의로 실행되며(우회·`[skip ci]` 없음) 변경이 docs뿐이면 scope가 `docs`라 `ci-result`만 수 초에 통과합니다. 실행이 보이지 않으면 `ensure-ci`가 실패해 조용한 병합 불가 상태를 만들지 않습니다.
- `deploy.yml`의 `scope`는 수동 실행에서 base가 없어 `full`로 떨어지던 것을, **main이 아닌 브랜치의 수동 실행은 main과의 merge-base 기준**으로 판단하도록 한 줄 추가했습니다(찾지 못하면 기존처럼 `full`).
- `deploy` 잡은 `github.ref == 'refs/heads/main'`일 때만 실행됩니다(기존에는 아무 브랜치의 `workflow_dispatch`도 배포 후보였음). #123과 **동일한 줄**이라 어느 쪽이 먼저 병합돼도 충돌하지 않습니다(§9).

| 대안 | 평가 |
|---|---|
| A. workflow_dispatch (채택) | 추가 자격 증명 없음, 필수 체크가 실제로 실행. 한계: GitHub 동작에 의존(§13 미검증 항목), Actions 탭의 실행 이벤트가 `workflow_dispatch`로 표시됨 |
| B. GitHub App 토큰 | PR이 일반 PR처럼 `pull_request`를 시작. 앱 생성·키 시크릿 필요 → **별도 승인 필요**, 지금은 미도입 |
| C. PAT | 광범위 권한·만료·개인 계정 의존 → 금지 사항이라 미채택 |
| D. 닫았다 다시 열기 / 빈 커밋 | 사람 개입·불안정, 운영 규칙(빈 커밋 금지)과 충돌 |
| E. 같은 이름의 commit status를 직접 게시 | 필수 체크를 흉내내는 우회. 미채택 |

## 5. 중복·무한 반복 방지

| 위험 | 방지 방식 | 검증 |
|---|---|---|
| 병합이 새 생성물을 만들고 또 PR… | 병합 커밋이 `_generated`만 바꾸므로 `push`의 `paths-ignore`로 Context sync가 실행되지 않음 | 정적 테스트 |
| 병합 커밋 자체가 "최근 커밋" 목록에 들어가 스냅샷이 또 바뀜 | `update-context.mjs`가 `chore(context):`뿐 아니라 `automation/context-sync`(머지 커밋 제목)도 제외. 이 저장소는 merge commit 병합을 씀 | `ci-context-flow` 테스트(머지/스쿼시 두 제목) |
| push마다 커밋 SHA·Actions 상태만 바뀌어 PR이 잦게 생김 | push 실행은 구조 항목(알고리즘·카테고리·워크플로 목록·npm 스크립트·문서 목록)이 바뀐 경우에만 새 PR을 만들고, `recentSourceCommits`·`recentWorkflowRuns`·`workflowQuery`만 바뀐 경우는 건너뜀. 매일 00:20 UTC/수동 실행이 갱신. 이미 열린 PR이 있으면 항상 최신 main으로 재작성 | `skip-volatile-only` 테스트 |
| 같은 목적 PR 중복 | 브랜치 고정 + `gh pr list --head`로 열린 PR 조회, 2개 이상이면 실패 | 테스트(생성 1회, 이후 edit) |
| 변경 없음 | 결과 트리가 main과 같으면 커밋·push·PR 호출 모두 생략, 열린 PR이 있으면 닫고 브랜치 삭제 | 테스트 |
| 동일 재실행 | 브랜치 트리·부모가 같으면 push 생략(`unchanged`) | 테스트 |
| 동시 실행 | 워크플로 `concurrency: context-sync-automation`(대기 중 실행은 최신으로 교체, 진행 중은 취소 안 함) + 브랜치는 "현재 main + 생성물"의 순수 함수라 다시 만들어도 유실 없음 + `--force-with-lease`로 다른 작성자가 끼어들면 실패 | 테스트(경쟁 쓰기 시뮬레이션) |
| 생성기 버그가 사람 문서를 덮어씀 | 허용 경로(`docs/context/_generated/`) 밖 변경은 커밋 전 실패, 브랜치는 `automation/*`만 허용 | 테스트 |

주의: 자동화 브랜치는 매번 main 위에서 다시 만들어지므로 **그 브랜치에 직접 커밋하지 마세요**(덮어써집니다). 이 브랜치에는 force push 금지·삭제 금지 규칙을 적용하지 마세요(§8 표).

## 6. 실패 시 원인 확인과 재실행

1. Actions → *Context sync* → 실패한 실행의 **Summary**와 `::error::` 주석을 봅니다.
2. 흔한 원인과 조치

| 증상 | 원인 | 조치 |
|---|---|---|
| `GitHub Actions is not permitted to create or approve pull requests` | §3의 관리자 설정 꺼짐 | 설정 후 *Run workflow*(재실행). 브랜치는 이미 있으니 PR만 생성됨 |
| `허용 경로 ... 밖의 파일이 변경되어 중단` | 생성기 변경이 범위를 넘음 | 생성기를 고침. 아무것도 커밋되지 않음 |
| `stale info` / `rejected` (force-with-lease) | 누군가 자동화 브랜치를 동시에 갱신 | *Run workflow* 재실행(안전) |
| `필수 체크 없이는 병합할 수 없으므로…` | deploy.yml 실행이 안 보임 | *Run workflow* 재실행: 이미 실행이 없으면 다시 시작, 있으면 그대로 둠 |
| `deploy.yml` 실행이 실패 | 일반 CI 실패 | 실행에서 *Re-run failed jobs* 또는 Context sync 수동 실행(`--force-redispatch`가 실패한 실행만 다시 시작) |

3. 수동 실행: *Run workflow* 의 `branch`(기본 `automation/context-sync`, `automation/`으로 시작해야 함), `run_ci`(기본 true). 시험 때만 바꾸세요.

## 7. Wiki가 반영하는 시점

- **병합된 main**의 `docs/context`(생성 문서 `CURRENT_STATE.md` 포함)를 반영합니다. 미병합 PR 브랜치는 반영하지 않습니다.
- `Context wiki` 워크플로(`push` main의 `docs/context/*.md`·`_generated/CURRENT_STATE.md`·관련 스크립트 변경, 매일 00:50 UTC, 수동). 자동화 PR 병합은 Context sync를 건너뛰지만 Wiki는 이 경로로 갱신됩니다.
- Wiki 단계는 **더 이상 조용히 실패하지 않습니다**. 전에는 `continue-on-error`로 감춰져 매 실행이 "Repository not found"로 실패하고 있었습니다(2026-11-27 로그). 이제 실패하면 `Context wiki` 실행이 빨갛게 되며 필수 체크에는 영향이 없습니다.
- **관리자 1회 작업(미적용)**: 저장소 Wiki 탭에서 첫 페이지를 한 번 저장해 Wiki 저장소를 초기화합니다(`has_wiki`는 true이지만 `.wiki.git`이 없음). 그 전까지 `Context wiki`는 실패합니다.

## 8. Work용 관리자 설정 가이드 (적용하지 않았음)

1회성 선행: (a) §3의 PR 생성 허용, (b) Wiki 첫 페이지 생성, (c) **§10 연구 워크플로 이전 또는 위험 수용**, (d) 이 PR 병합 후 *Context sync*를 수동 실행해 자동화 PR이 생기고 `ci-result`가 PR에 붙는지 확인.

메뉴: `Settings → Rules → Rulesets → New ruleset → New branch ruleset`

| 항목 | 값 |
|---|---|
| Ruleset Name / Enforcement status | `main protection` / Active (먼저 *Evaluate*로 시험 가능) |
| Bypass list | **비워 둠**(관리자 우회 제한). 긴급 시에는 Enforcement를 일시 Disabled로 바꾸고 기록 |
| Target branches | Include default branch (`main`) |
| Restrict deletions | ✔ (브랜치 삭제 금지) |
| Block force pushes | ✔ (강제 푸시 금지) |
| Require a pull request before merging | ✔, **Required approvals = 0**(운영자 1명이므로 독립 리뷰어 승인 규칙 없음), 코드 오너 리뷰 ✘ |
| Require status checks to pass | ✔ `ci-result` 추가(소스: GitHub Actions). 목록에 안 보이면 최근 7일 내 한 번이라도 실행돼야 함 |
| Require branches to be up to date before merging | ✔ (최신 base 기준 검증). 자동화 PR은 main이 앞서가면 워크플로가 다시 만들어 주므로 "Update branch"가 필요 없음 |
| Merge queue / Require signed commits / Linear history | **켜지 않음** (자동화·현 운영에 맞지 않음. 병합 방식은 merge commit·squash·rebase 모두 호환) |
| `automation/**` 브랜치 | 별도 ruleset을 만들지 않거나, 만든다면 force push·삭제를 **허용**(스크립트가 force-with-lease로 재작성하고 닫을 때 삭제) |

규칙 적용 후 `main`에 직접 push하는 것은 모두 거부됩니다. 이를 쓰는 워크플로 목록이 §10입니다. `node scripts/ci/audit-workflows.mjs --strict`가 0을 반환하면 규칙을 켜도 됩니다.

## 9. 기존 열린 PR과의 호환·권장 병합 순서

2026-11-27 기준 `main`(31dbc50)에서 각 PR 헤드와 CI-1을 `git merge-tree`로 병합 시뮬레이션: **9개 모두 CI-1과 충돌 없음**(`deploy.yml`은 #123과 동일 줄이라 합쳐지고 #126의 단계와도 분리됨). 아래 충돌은 CI-1과 무관하게 **다른 PR끼리** 존재하며 CI-1에서 고치지 않았습니다.

| 쌍 | 충돌 파일 | 안전한 통합 방안 |
|---|---|---|
| #120·#121·#124·#125·#126 상호 | `docs/context/DECISIONS.md` | 같은 위치(파일 끝)에 항목을 추가해서 생김. 병합 순서대로 각 담당자가 최신 main을 합치며 항목을 모두 남김 |
| #118×#121, #126×#127 | `docs/context/ROADMAP.md` | 동일(행 추가). 양쪽 행을 모두 유지 |
| #118×#125 | `src/review/ReviewPage.tsx` | **코드 충돌**. 먼저 병합되는 쪽 기준으로 나중 PR 담당자(#125 A5 → 리뷰 화면)가 합치고 `tests/ui` 재확인 |

**결정 번호 중복**(발견만 기록, 수정 안 함): `D-091` — #121·#125·#127 세 곳, `D-092`·`D-093` — #126·#127 두 곳, `D-094`/`D-095` — #118, `D-096` — #126. #120은 `D-A3-n`, #124는 `D-C42-n` 형식이라 충돌 없음. 병합 순서에 따라 번호가 겹치는 PR 담당자가 병합 직전에 다음 빈 번호로 재부여해야 하며, CI-1 자신은 번호 경쟁을 피하려 **`D-CI1-1`** 을 씁니다.

권장 병합 순서(각 병합 뒤 `ci-result` 확인, 마지막 PR이 최신 main을 합친 뒤):
1. **CI-1** — 이후 모든 병합이 새 자동화 구조를 쓰고, 병합 전에 한 번 더 검증된 구조에서 보호 규칙을 켤 수 있음. 단독으로 충돌 없음.
2. **#123 C4.1** (Worker 배포 통제; `deploy.yml`·`classify-changes.mjs` 변경은 CI-1과 호환, Worker 배포 입력 가드 그대로)
3. **#126 C4.3** (정책 공개 게이트 — `deploy.yml`의 "No unreleased policy drafts" 단계가 `build` 잡에 그대로 남음) · 필요하면 draft 해제는 운영자가 결정
4. **#124 C4.2** → **#118 C3** → **#120 A3** → **#125 A5**(ReviewPage 충돌 해소) → **#127 A4** → **#121 C4 감사** → **#122 문서**
   (문서 전용 PR은 `docs` 범위라 가볍게 통과; DECISIONS/ROADMAP 충돌은 위 표대로 순서대로 해소)

#123의 Worker 배포 통제(`deploy-online-worker.yml`의 `free_plan_confirmed` 등)와 #126의 정책 공개 게이트는 CI-1이 건드리지 않습니다.

## 10. main에 직접 push하는 연구 워크플로 (보호 규칙과 충돌)

`node scripts/ci/audit-workflows.mjs` 결과 — **26개 워크플로가 `git push origin HEAD:main`** 으로 연구 보고서를 올립니다(`[skip ci]`). 모두 `docs/context/_generated/` 아래 파일만 `git add`합니다. 보호 규칙이 켜지면 이 push 단계가 거부되고, **보고서는 90일 보존되는 아티팩트에만 남습니다**(실험 자체는 성공).

이번 PR은 **이 워크플로를 변경하지 않았습니다**(실행 비용이 크고 이 환경에서 실행·검증할 수 없어 임의 수정 금지). 대신 같은 구조로 옮길 수 있게 `publish-generated.mjs`를 일반화해 두었습니다(분기별 `--branch automation/<이름>`, 같은 허용 경로 `docs/context/_generated/`). 후속(CI-1.1)에서 각 `git push origin HEAD:main` 단계를 `node scripts/ci/publish-generated.mjs publish --branch automation/research-<워크플로> --allow docs/context/_generated/ ...` 로 바꾸는 것을 권장합니다. **그 전에 보호 규칙을 켜려면** 연구 보고 push 실패를 감수하거나(아티팩트에서 복구) 규칙을 켜지 않는 쪽을 선택하세요. 권한 우회(ruleset bypass)는 이 작업의 금지 사항이라 제안하지 않습니다.

| 워크플로 | 직접 push 단계 수 |
|---|---|
| `algorithm-zoo.yml` | 1 |
| `br-error-enumeration.yml` | 1 |
| `br-research.yml` | 1 |
| `discovered-external.yml` | 1 |
| `external-championship.yml` | 1 |
| `followup-ablations.yml` | 3 |
| `foundation-v4-tournament.yml` | 1 |
| `frontier-200k.yml` | 1 |
| `full-selfplay.yml` | 1 |
| `native12-dqn.yml` | 1 |
| `neural-selfplay.yml` | 1 |
| `offpolicy-ppo-expanded.yml` | 1 |
| `psro-extended.yml` | 1 |
| `psro-ppo.yml` | 1 |
| `qr-20k.yml` | 1 |
| `qr-autoresearch.yml` | 1 |
| `qr-deep-research.yml` | 1 |
| `qr-followup.yml` | 1 |
| `qr-four-pillars.yml` | 1 |
| `research-50k-league.yml` | 2 |
| `sota-attack-lab.yml` | 2 |
| `sota-independent-confirm.yml` | 1 |
| `v31-large.yml` | 1 |
| `v31-research.yml` | 1 |
| `v32-research.yml` | 1 |
| `yahtzeerl-transfer.yml` | 1 |

그 밖에 `seo-indexnow.yml`은 `seo-state` 브랜치(main 아님), `deploy-online-worker.yml`은 push 없음 → 영향 없음.

## 11. 검증 결과

실제 GitHub·git 동작으로 확인한 것과 모의로 확인한 것을 구분합니다. **모의 테스트 통과를 운영 환경 검증으로 보고하지 않습니다.**

(검증 표는 실행 후 채움)

## 12. 롤백

- **코드**: 이 PR 병합 커밋을 `git revert -m 1 <병합 커밋>`로 되돌리면 이전 구조(직접 push + 같은 잡 Wiki)로 복귀합니다. 보호 규칙을 켠 뒤라면 되돌림도 PR로 해야 합니다.
- **보호 규칙**: ruleset의 Enforcement를 Disabled로 바꾸면 즉시 해제(변경 이력은 Settings → Rules에 남음).
- **자동화 산출물**: `automation/context-sync` 브랜치와 열린 PR은 닫고 삭제해도 안전합니다(다음 실행이 다시 만듦). 생성 문서는 `docs/context/_generated/`만이라 손으로 되돌릴 것이 없습니다.
- **Wiki**: Wiki 저장소는 git이므로 `Sync YachtLab context docs` 커밋을 되돌릴 수 있습니다.

## 13. 잔여 위험·미검증

(작성 중)
