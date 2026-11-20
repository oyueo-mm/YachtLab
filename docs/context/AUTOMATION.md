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

- [동기화 스크립트](../../scripts/update-context.mjs)
- [GitHub Actions](../../.github/workflows/context-sync.yml)
- 이벤트: main Push / 매일 00:20 UTC / 수동 workflow_dispatch.
- Push/Schedule: 스크립트가 코드·Git 기록에서 현재 상태 문서를 생성하고, **실제 내용이 바뀌었을 때만** git commit/push 한다.
- PR: 문법 및 문서 링크 검증; 자동 문서 생성물은 main에만 저장한다.
- GitHub Wiki: Wiki가 초기화되어 쓰기 권한이 있는 경우에만 별도 Wiki 페이지로 **best-effort 미러**한다. 실패해도 원본 docs/context는 유지하고 CI에 실패 기록을 남긴다.

## 새 채팅 진입점

- GitHub [CONTEXT.md](../../CONTEXT.md): 바로가기
- GitHub [AGENTS.md](../../AGENTS.md): 코딩 에이전트의 작업 원칙
- GitHub [docs/context/README.md](./README.md): 종합 목차
- Wiki: https://github.com/oyueo-mm/YachtLab/wiki (페이지가 실제로 생성된 경우만 이용)

## 오작동·충돌 대응

1. Actions → Context sync 확인. 출처/입력 오류가 있으면 맥락 생성 코드를 고치고 PR 검증.
2. generated 파일은 직접 수정하지 않는다(다음 자동 생성 시 덮어씀).
3. GitHub Wiki 동기화 실패가 생기면 우선 repo의 docs/context 링크를 사용한다.
4. GitHub 저장소 main에 동시 push가 있었다면 auto commit은 fast-forward 및 정상 pull/rebase만 수행하며 강제 push를 허용하지 않는다.
5. 생성물만 바뀐 커밋에 대해서는 Context sync 워크플로가 다시 실행되지 않도록 paths-ignore을 적용한다.
6. 시험에 사용한 미사용 시드 결과는 RESULTS.md와 정확한 워크플로 링크를 함께 갱신한다.
