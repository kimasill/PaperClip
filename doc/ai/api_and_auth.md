# API·인증 작업 지침

REST 엔드포인트, 인증, 에이전트 API 키 동작을 추가하거나 바꿀 때만 이 파일을 읽는다.

## 기본

- 에이전트 `adapterType`별 필수 `adapterConfig` 필드(예: `process` → `command`)는 `doc/ai/integration_process_agents.md` 등 도메인 지침을 따른다.
- Base path: `/api`
- 보드(운영자) 접근은 전체 제어 컨텍스트로 본다.
- 에이전트 접근은 Bearer API 키(`agent_api_keys`, 저장 시 해시)를 쓴다.
- 에이전트 키는 **다른 회사** 데이터에 접근하면 안 된다.

## 엔드포인트를 추가할 때

- 회사 접근 검사
- 액터 권한(보드 vs 에이전트)
- 변경이 있는 뮤테이션은 액티비티 로그
- HTTP 오류는 일관되게 (`400/401/403/404/409/422/500`)
