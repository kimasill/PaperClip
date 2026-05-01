# Integration / `process` 어댑터 규정

GitLab·웹훅·브리지 등 **외부 시스템과 맞물리는 자동화**에 쓰는 에이전트 중, **`adapterType`이 `process`** 인 경우를 다룬다.

## 필수

- **`adapterConfig.command`** 에 실행 파일 경로 또는 `PATH` 상의 이름을 반드시 둔다 (비어 있으면 안 됨).
- 선택: `args`, `cwd`, `env`(바인딩), `timeoutSec` 등은 워크로드에 맞게 설정한다.

## 이유

- `process` 어댑터는 **지정한 명령 한 줄**으로 자식 프로세스를 띄운다. `command`가 없으면 런타임에서 즉시 실패한다(`Process adapter missing command`).
- 서버는 에이전트 **생성·채용(hire)·설정 PATCH** 시 위 조건을 검사해, 이슈에 배정되기 **전에** 422로 막는다.

## 권장

- **LLM CLI 기반 업무**(Claude Code, Codex, Gemini CLI 등)는 `claude_local`, `gemini_local` 등 **로컬 어댑터**를 쓰고, `process`는 **스크립트/전용 바이너리** 래퍼에 한정한다.
- 관리형 instructions 번들(AGENTS.md 등)이 필요하면 로컬 어댑터 쪽이 맞다. `process`는 UI 번들 편집 대상이 아니다.

## 관련 코드

- 실행: `server/src/adapters/process/execute.ts`
- 저장 시 검증: `server/src/routes/agents.ts` (`assertAdapterConfigConstraints`)
