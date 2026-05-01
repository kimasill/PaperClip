# 컨트롤 플레인 핵심 불변조건·문서 정책

서버 도메인 로직, 거버넌스, 멀티테넌시를 건드릴 때 이 파일을 읽는다.

## 불변조건(요지)

- `process` 어댑터 에이전트는 `adapterConfig.command`가 필수다(통합·자동화 담당 포함). 상세는 `doc/ai/integration_process_agents.md`.
- 단일 담당자(single-assignee) 태스크 모델
- 이슈 checkout의 원자성
- 거버넌스 액션에 대한 승인 게이트
- 예산 한도 도달 시 자동 일시정지
- 변경 뮤테이션에 대한 액티비티 로깅

## 플랜·전략 문서

- 새 플랜 문서는 `doc/plans/`에 두고 파일명은 `YYYY-MM-DD-slug.md` 형식을 쓴다.
- `doc/SPEC.md`와 `doc/SPEC-implementation.md`는 요청 없이 통째로 갈아엎지 않는다. additive를 선호한다.

## 개발 환경 한 줄

로컬에서 `DATABASE_URL`을 비우면 임베디드 PostgreSQL이 자동으로 쓰인다. 상세는 `doc/DEVELOPING.md`.
