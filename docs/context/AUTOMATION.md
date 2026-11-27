# 맥락 자동 갱신 설명

## 원칙

GitHub에 있는 정보를 다음 채팅에서 다시 설명할 필요 없이 읽을 수 있도록 **문서를 원본으로 고정하고, 변경되는 사실은 자동으로 인덱싱**한다.

## 자동 갱신되는 항목

- ✅ src/ai.ts에서 선언된 AI 이름
- ✅ src/engine.ts의 점수 카테고리 및 관련 코드
- ✅ package.json의 빌드/테스트 명령과 런타임
- ✅ Git 커밋 기록 중 최근 실제 변경 사항 (맥락 자동 커밋은 제외)
- ✅ 저장소에 존재하는 보고서·워크플로 목록
- ✅ GitHub Actions의 최근 실행 상태 (API 응답을 가져올 수 있는 환경에서만; 실패하면 누락했다고 표시)
- ✅ git에 커밋된 신규 문서/연구 코드가 있으면 링크 갱신

자동 출력은 [CURRENT_STATE.md](./_generated/CURRENT_STATE.md)와 [manifest.json](./_generated/manifest.json)에 저장된다.

## 자동으로 할 수 없는 일

- ❌ 새 ChatGPT 채팅의 대화 내용을 허락 없이 자동 열람/수집하거나 GitHub로 보내기
- ❌ 실험이 성공했는지 논문적으로 해석해, 검증되지 않은 성능 향상을 자동 확정하기
- ❌ 별도 Actions 아티팩트의 내용이 만료된 뒤 내용을 자동 복원하기
- ❌ README/TECHNIQUES/ROADMAP의 새로운 연구적 판단을 신뢰성 있게 자동 생성하기

새 채팅에서 중요한 결정이 추가되면 AI에게 **GitHub의 DECISIONS/RESULTS/ROADMAP에도 커밋하도록** 지시한다. 이 내용은 git 기록으로 보존되고, 다음 Actions 실행에서 자동 인덱싱된다.

## 구현

- [동기화 스크립트](../../scripts/update-context.mjs) · [PR 게시 스크립트](../../scripts/ci/publish-generated.mjs)
- [Context sync](../../.github/workflows/context-sync.yml) · [Context wiki](../../.github/workflows/context-wiki.yml)
- 이벤트: main Push(생성물만 바뀐 병합은 제외) / 매일 00:20 UTC / 수동 workflow_dispatch.
- Push/Schedule: 스크립트가 코드·Git 기록에서 현재 상태 문서를 생성하고, **main에 push하지 않고** `automation/context-sync` 브랜치의 단일 PR로 올린다(CI-1, D-CI1-1). 변경이 없으면 아무것도 하지 않고, 열린 PR이 있으면 갱신한다. 그 PR의 필수 체크 `ci-result`는 `deploy.yml`을 workflow_dispatch로 시작해 만든다.
- PR: 문법 및 문서 링크 검증.
- GitHub Wiki: `Context wiki` 워크플로가 **병합된 main**의 docs/context를 미러한다. Wiki 저장소가 초기화되지 않았거나 쓰기가 막히면 이 워크플로가 실패로 표시된다(원본 docs/context는 영향 없음).
- 권한·보호 규칙·복구 절차: [CI-1 운영 가이드](../operations/CI-1-CONTEXT-SYNC-PROTECTION.md).

## 새 채팅 진입점

- GitHub [CONTEXT.md](../../CONTEXT.md): 바로가기
- GitHub [AGENTS.md](../../AGENTS.md): 코딩 에이전트의 작업 원칙
- GitHub [docs/context/README.md](./README.md): 종합 목차
- Wiki: https://github.com/oyueo-mm/YachtLab/wiki (페이지가 실제로 생성된 경우만 이용)

## 오작동·충돌 대응

1. Actions → Context sync / Context wiki 확인. 원인별 조치는 [CI-1 가이드 §6](../operations/CI-1-CONTEXT-SYNC-PROTECTION.md)을 따른다.
2. generated 파일은 직접 수정하지 않는다(다음 자동 생성 시 덮어씀). 자동화 브랜치에도 직접 커밋하지 않는다.
3. Wiki 동기화가 실패하면 우선 repo의 docs/context 링크를 사용한다.
4. 자동화 브랜치는 `--force-with-lease`로만 갱신하며 main에는 어떤 push도 하지 않는다. 동시 실행은 워크플로 concurrency와 lease가 막고, 실패하면 재실행이 안전하다.
5. 생성물만 바뀐 병합 커밋에 대해서는 Context sync가 다시 실행되지 않도록 paths-ignore를 적용한다.
6. 시험에 사용한 미사용 시드 결과는 RESULTS.md와 정확한 워크플로 링크를 함께 갱신한다.
