# 포트폴리오 — Paperclip 통합·오케스트레이션

> **한 줄 요약:** AI 에이전트 회사용 컨트롤 플레인(Paperclip) 위에 **플러그인·웹훅으로 외부 도구를 붙이고**, 서버가 **하트비트 입력(작업 맥락)·에스컬레이션·역할·스킬**로 에이전트 실행을 조율하는 **오케스트레이션 레이어**를 정리했다는 점을 이력서·면접용으로 압축한 문서다.

**저장소:** Paperclip 모노레포 (TypeScript, Express, PostgreSQL/Drizzle, 플러그인 워커)  
**기술 맵(경로·모듈 전체):** [`INTEGRATION-ORCHESTRATION-SUMMARY.md`](./INTEGRATION-ORCHESTRATION-SUMMARY.md)  
**인프라·GitLab·Obsidian·토큰 상한 중심 서술:** [`PORTFOLIO-Paperclip-Control-Plane.md`](./PORTFOLIO-Paperclip-Control-Plane.md)

---

## 1. 무엇을 “오케스트레이션”이라고 부르는가

Paperclip에서 오케스트레이션은 단일 챗봇 호출이 아니라, 다음이 **같은 제품 안에서 맞물리는 것**을 가리킨다.

| 층 | 역할 |
|----|------|
| **통합(인바운드)** | GitLab·Linear·Slack 등이 **웹훅**으로 서버에 이벤트를 넣고, 플러그인 워커가 검증·처리한다. |
| **실행 맥락 주입** | 주기적 하트비트(또는 트리거) 시 서버가 **이슈 본문·깨우기 이유·트리거 코멘트** 등을 마크다운 다이제스트로 조립해, 로컬 CLI 어댑터의 stdin 등에 넣는다. |
| **거버넌스·라우팅** | `blocked` 이슈가 누적되면 **조직도(`reportsTo`)나 CEO 쪽으로 재배정**하는 서버 주도 에스컬레이션. |
| **역할·스킬** | 온보딩 자산(역할별 `AGENTS.md` 등)과 **회사 스킬** 가져오기·동기화로, 채용 직후에도 일관된 힌트와 도구 사용 패턴을 유지한다. |
| **선택적 런타임 지시** | GitLab·Obsidian 등 플러그인이 켜져 있을 때만, 어댑터 설정에 따라 **통합 가이드 마크다운**을 실행 프롬프트에 합성한다. |

즉, **외부 이벤트 → 서버 상태 → 에이전트 입력·재배정 → 스킬·문서**까지 한 흐름으로 설계한 것이 이 레포의 오케스트레이션 그림이다.

---

## 2. 플러그인 호스트와 웹훅 — 통합의 공통 분모

- **매니페스트 계약:** capabilities, `instanceConfigSchema`, 선택적 `webhooks[]`, `tools[]` 등으로 플러그인이 “무엇을 할 수 있는지”를 선언한다 (`packages/shared` 플러그인 타입).
- **인바운드 URL:** `POST /api/plugins/{pluginId}/webhooks/{endpointKey}` — 설치 행 UUID 또는 pluginKey 문자열을 허용해 운영·문서 예시와 맞춘다.
- **인증 모델:** 보드 세션이 아니라 **플러그인 측 시크릿·서명(HMAC 등)** 으로 외부 발신자를 검증한다.
- **배달·재시도:** `plugin_webhook_deliveries`에 페이로드·상태를 남기고, 백오프(예: 30초→2분→10분→1시간, 상한 5회)로 실패를 흡수한다. 백그라운드 루프로 만기 배달을 재처리한다.

이 덕분에 GitLab MR 승인, Linear 이슈 이벤트, Slack 슬래시 커맨드가 **같은 파이프라인**을 타며, 운영자는 배달 이력·테스트·수동 재시도 API로 진단할 수 있다.

---

## 3. 채널별 통합 — 오케스트레이션이 붙는 지점

요약만 적는다. 세부 계약은 각 전용 문서와 코드가 최종 근거이다.

| 통합 | 포트폴리오에서 강조할 포인트 |
|------|------------------------------|
| **Git (`paperclip.git-provider`)** | MR·이슈·파이프라인·토론 등 **에이전트 도구** + GitLab MR 웹훅으로 **Paperclip 승인과 MR 승인 동기화**. 토큰은 **회사 시크릿 UUID 참조**로만 연결. |
| **Linear (`paperclip.linear-bridge`)** | `Linear-Signature` 검증, 타임스탬프 리플레이 방지, **`plugin.state` FIFO 큐**로 **한 번에 하나**의 에이전트 세션만 처리해 경쟁 상태를 줄임. |
| **Slack (`paperclip.slack-commands`)** | `urlencoded` 본문과 **raw body** 보존으로 서명 검증 가능, 슬래시 커맨드에서 **에이전트 호출**까지 연결. |
| **Obsidian (`paperclip.obsidian-brain`)** | Vault 내 `PaperclipBrain` 트리와 파일 도구로 **지식 베이스**를 에이전트 작업 공간에 둔다. 워크플로 프롬프트는 플러그인·설정이 켜졌을 때만 주입. |

UI에서는 에이전트 상세 화면에서 GitLab·Obsidian 등 **어댑터별 설정 필드**로 이 스위치들을 노출하고, 지원하는 로컬 CLI 어댑터에서는 `AGENTS.md` / `HEARTBEAT.md` 번들 편집까지 이어진다.

---

## 4. 서버 측 오케스트레이션 — 하트비트·에스컬레이션·스킬

### 4.1 하트비트와 이슈 다이제스트

- 하트비트 실행 시 `buildPaperclipHeartbeatIssueDigest` 등이 **작업 지시 블록**을 마크다운으로 만든다.
- 목적: 모델이 **환경 변수만 보고 멈추는** 상황을 줄이고, “지금 무엇을 해야 하는지”를 서버가 구조화해 넘긴다.
- `adapter-utils`의 heartbeat 관련 컨텍스트 조립과 맞물릴 수 있다. (입력 길이 상한·토큰 관점은 [`PORTFOLIO-Paperclip-Control-Plane.md`](./PORTFOLIO-Paperclip-Control-Plane.md)에서 다룬다.)

### 4.2 에스컬레이션 엔진

- 에이전트 하트비트 런이 끝난 뒤, 담당자의 **`blocked` 이슈**에 대해 연속 누적(스트릭)을 센다.
- 임계값(예: 하트비트 2회)에 도달하면 **상위(`reportsTo`) 또는 CEO** 쪽으로 이슈를 재배정하는 **서버 주도** 로직이다. “막힌 일이 오래 남지 않게” 조직 구조를 코드로 반영한 부분이다.

### 4.3 온보딩 자산·역할·회사 스킬

- `server/src/onboarding-assets/` 에 CEO·CFO·CTO·엔지니어 등 역할별 템플릿이 있고, 채용 시 빈 스킬이면 `role-default-skills`가 역할별 기본 스킬 참조를 합친다.
- `company-skills`는 패키지·프로젝트 스캔, 가져오기, 신뢰 수준, 사용 추적 등 **회사 단위 스킬 운영**을 담당한다.

이 세 덩어리가 합쳐져 **“누가, 어떤 힌트와 도구로, 막히면 어디로 넘기는지”** 를 제품 내부에서 일관되게 유지한다.

---

## 5. 개발·런타임 자동화 (맥락)

- **`scripts/dev-runner.ts`:** 서버·어댑터·DB·SDK 등 감시·재시작으로 로컬 플러그인·오케스트레이션 기능을 빠르게 검증할 수 있게 한다.
- 플러그인 개발용 감시기는 앱 기동 경로와 연결되어 있다.

면접에서는 “운영 서버만이 아니라 **개발 루프도** 모노레포에 맞춰 자동화했다”는 점을 한 문장으로 보태면 좋다.

---

## 6. 보안·운영 — 오케스트레이션과 붙는 전제

- Git Provider·Linear 등은 설정 JSON에 **원시 토큰을 넣지 않고** `company_secrets` 행의 **UUID 참조**만 둔다.
- GitLab 웹훅의 경우 UI에 보이는 Secret token 문자열과 Paperclip 필드의 UUID를 **혼동하지 않도록** 문서로 구분해 두었다.
- 공개 콜백 URL은 **`PAPERCLIP_PUBLIC_BASE_URL`**(scheme + host)으로 맞춰, 터널·리버스 프록시 뒤에서도 링크와 검증이 어긋나지 않게 한다.

---

## 7. 기술 스택 (오케스트레이션 서술에 쓰기 좋은 것)

| 영역 | 기술·개념 |
|------|-----------|
| API·플러그인 | Express, 플러그인 매니페스트, 워커 RPC, 도구 디스패치 |
| 데이터 | PostgreSQL, Drizzle, `plugin_webhook_deliveries`, `plugin.state` 등 |
| 통합 | GitLab REST·웹훅, Linear 서명·FIFO, Slack 서명·폼 파싱, Obsidian Vault FS |
| 서버 로직 | 하트비트 이슈 다이제스트, 에스컬레이션 엔진, 회사 스킬·역할 기본값 |
| 프론트 | 에이전트 설정 폼, 어댑터별 config 필드 |

---

## 8. 면접·이력서용 문장 (예시)

- *“Paperclip에서 플러그인 웹훅으로 GitLab·Linear·Slack·Obsidian을 같은 배달·재시도 파이프라인에 태우고, 하트비트 시 이슈·코멘트 맥락을 다이제스트로 주입하며, 막힌 이슈는 조직도 기반 에스컬레이션으로 재배정하도록 서버 측 오케스트레이션을 설계·구현했다.”*

---

## 9. 참고 문서

| 문서 | 내용 |
|------|------|
| [`INTEGRATION-ORCHESTRATION-SUMMARY.md`](./INTEGRATION-ORCHESTRATION-SUMMARY.md) | 모듈·경로·API 한눈에 보기 |
| [`PORTFOLIO-Paperclip-Control-Plane.md`](./PORTFOLIO-Paperclip-Control-Plane.md) | 터널·웹훅·GitLab·Obsidian·토큰 상한 |
| [`GITLAB-APPROVAL-SYNC.md`](./GITLAB-APPROVAL-SYNC.md) | MR 승인 ↔ Paperclip 승인, 공개 URL |
| [`LINEAR-BRIDGE.md`](./LINEAR-BRIDGE.md) | Linear 서명·큐·설정 |
| [`OBSIDIAN-BRAIN.md`](./OBSIDIAN-BRAIN.md) | Vault·도구·워크플로 |
| [`skills/paperclip/references/plugin-setup.md`](../skills/paperclip/references/plugin-setup.md) | 플러그인 설치·enable·config API 요약 |

---

*본 문서는 [`INTEGRATION-ORCHESTRATION-SUMMARY.md`](./INTEGRATION-ORCHESTRATION-SUMMARY.md)를 포트폴리오 독자(면접관·채용 담당)가 읽기 쉬운 서술로 재구성한 것이다. 동작 세부는 구현 코드와 링크된 전용 문서가 최종 근거이다.*
