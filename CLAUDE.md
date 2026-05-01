# Paperclip — AI 작업 라우터 (CLAUDE.md)

이 파일은 **목차·라우터**입니다. 전체 문서를 미리 읽지 말고, **지금 하는 작업에 해당하는 지침 파일만** 연다(lazy loading).

## 프로젝트 한 줄

Paperclip은 AI 에이전트 회사용 컨트롤 플레인입니다. V1 계약은 `doc/SPEC-implementation.md`입니다.

## 글로벌 규칙 (항상)

- 언어·도구: **TypeScript**, **pnpm** 워크스페이스, Node 20+.
- 변경은 **회사(company) 스코프**를 깨지 않는다. 상세는 아래 `core_invariants`를 해당 작업 시 읽는다.
- 제품·아키텍처 배경이 필요할 때만(기능 설계·스펙 논의): `doc/ai/onboarding_context.md`를 연다.

## 작업별 지침 — 여기서만 골라 읽기

| 하려는 일 | 먼저 열 파일 |
|-----------|----------------|
| DB 스키마·마이그레이션·Drizzle·데이터 모델 | `doc/ai/db_schema_rules.md` |
| UI·React·스타일·보드 화면 | `doc/ai/ui_guidelines.md` |
| 테스트·타입체크·빌드·검증 순서 | `doc/ai/test_strategy.md` |
| REST API·인증·에이전트 키·라우트 추가 | `doc/ai/api_and_auth.md` |
| 컨트롤 플레인 불변조건·플랜 문서 위치·전략 문서 정책 | `doc/ai/core_invariants.md` |
| 반복 작업에 붙여 넣을 스니펫·체크리스트(토큰 절약) | `doc/ai/code_templates.md` |
| 로컬 실행·Docker·락파일 등 개발 환경 | `doc/DEVELOPING.md` |
| PostgreSQL 연결 모드·호스팅 | `doc/DATABASE.md` |
| Integration / `process` 어댑터·command 필수 규정 | `doc/ai/integration_process_agents.md` |

## 사람용 진입점

- 저장소 전반 안내: 루트 `AGENTS.md`
- 기여 가이드: `CONTRIBUTING.md`
