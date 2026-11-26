# PR #94 병합 전후 검증

[PR #94](https://github.com/oyueo-mm/YachtLab/pull/94)와 감사 브랜치의 파일 목록을 대조했다. 제품 후보와 테스트 변경 경로는 Claude의 변경 파일과 겹치지 않는다. PR #94의 실제 병합 커밋은 최신 main에 포함된 뒤 별도로 확인한다.

병합 전 검사는 GitHub 임시 merge ref `e84fe9f`에 후보 6개 파일을 별도 worktree에서 적용했다. 이 ref의 base는 `de312e8`, PR head는 `dfd1ba1`이다. Vite/TypeScript 빌드와 Vitest 22/22(서버 AI·다인방·정적 SEO), Chromium 5/5(3D 굴림·킵, 오프라인 PWA 2건, 1366×768·1920×1080 온라인 점수판)를 확인했다. 최초 UI 실행에서 미리보기 주소 바인딩을 바로잡고 동일 테스트를 다시 실행했다. 마지막 확인 때 PR은 OPEN 상태였고 origin/main은 기준 커밋이었다.

병합 후에는 gh pr view 94 --json state,mergeCommit,mergedAt의 MERGED 상태와 병합 커밋을 먼저 확인한다. origin/main을 fetch한 뒤 조상 관계를 확인하고 깨끗한 격리 worktree를 만든다. 최신 main과 거기에 감사 패치를 적용한 후보를 단계별로 기록한다. GitHub의 임시 merge ref는 실제 병합 후 main과 구분한다.

1. 최신 main과 후보의 킵 선반 axe·실제 3D 굴림/킵, 모바일/데스크톱 튜토리얼, 캐시 업데이트 및 오프라인 연습.
2. 같은 브라우저·옵션에서 3D 원본과 결정한 후보를 3회씩 비교. LCP·CLS·TBT, 첫 조작, SW 전송량을 함께 기록.
3. 서버 AI 평균과 p99 기존 게이트, 결정 동등성, 두 로컬 연결 제한 회귀, 방 lifecycle과 재대결.
4. 1366×768 및 가로 폭에서 1:1 점수판을 비교하고 SEO 정적 확장·비회원 상점은 Claude의 기존 작업과 나란히 회귀만 확인.
5. 연구 체크포인트 재개·충돌 재현. 기존 예산·시드와 진행 중인 연구 작업은 이 검증 경로와 분리.
