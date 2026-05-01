# Paperclip — 통합·오케스트레이션·플러그인 작업 요약

**포트폴리오·이력서용 요약:** [`PORTFOLIO-Paperclip-Control-Plane.md`](./PORTFOLIO-Paperclip-Control-Plane.md) (인프라·GitLab·Obsidian·토큰) · [`PORTFOLIO-Paperclip-Orchestration.md`](./PORTFOLIO-Paperclip-Orchestration.md) (통합·오케스트레이션·플러그인 흐름)

이 문서는 `PaperClip` 저장소 기준으로 **자동화 파이프라인(개발/런타임)**, **플러그인**, **인바운드 웹훅**, **에이전트 오케스트레이션(하트비트·에스컬레이션·프롬프트 주입)** 을 한곳에서 찾을 수 있게 정리한다. 세부 계약은 각 전용 문서와 코드를 우선한다.

---

## 1. 한눈에 보는 구조

| 영역 | 역할 | 대표 경로·문서 |
|------|------|----------------|
| 플러그인 호스트 | 설치·설정·워커 RPC·도구 디스패치 | `server/src/services/plugin-*.ts`, `server/src/routes/plugins.ts` |
| 웹훅 수신 | `POST /api/plugins/:id/webhooks/:endpointKey`, 배달 로그·재시도 | `packages/db/src/schema/plugin_webhooks.ts` → `plugin_webhook_deliveries`, `server/src/services/webhook-retry.ts` |
| Git 연동 | MR 생성·파이프라인·이슈 도구 + GitLab MR 승인 ↔ Paperclip 승인 동기화 | `packages/plugins/plugin-git-provider/`, `doc/GITLAB-APPROVAL-SYNC.md` |
| Linear | 서명 검증·FIFO 큐·순차 에이전트 세션 | `packages/plugins/plugin-linear-bridge/`, `doc/LINEAR-BRIDGE.md` |
| Slack | 슬래시 커맨드 수신·에이전트 호출 | `packages/plugins/plugin-slack-commands/` |
| Obsidian | Vault 내 `PaperclipBrain` 트리·도구 | `doc/OBSIDIAN-BRAIN.md`, `server/src/services/obsidian-brain-workflow-prompt.ts` |
| 하트비트·작업 맥락 | 이슈 본문·트리거 코멘트를 stdin 다이제스트로 주입 | `server/src/services/heartbeat-issue-digest.ts`, `server/src/services/heartbeat.ts` |
| 에스컬레이션 | `blocked` 이슈 누적 시 상위/CEO로 재배정 | `server/src/services/escalation-engine.ts` |
| 회사 스킬 | 가져오기·동기화·역할별 기본 힌트 | `server/src/services/company-skills.ts`, `server/src/services/role-default-skills.ts` |
| 로컬 개발 러너 | 감시·재시작·Tailscale 등 | `scripts/dev-runner.ts` |

---

## 2. 플러그인

### 2.1 공통 계약

- 매니페스트: `PaperclipPluginManifestV1` — capabilities, `instanceConfigSchema`, 선택적 `webhooks[]`, `tools[]` 등 (`packages/shared/src/types/plugin.ts`).
- 인바운드 웹훅 URL 형태: `POST /api/plugins/{pluginId}/webhooks/{endpointKey}` — `pluginId`는 **설치 행 UUID** 또는 **pluginKey** 문자열 모두 허용 (`doc/LINEAR-BRIDGE.md` 등과 동일 패턴).
- 웹훅 라우트는 **보드 인증 없음**; 대신 플러그인이 시크릿·서명으로 검증한다.

### 2.2 `paperclip.git-provider` (Git Provider Tools)

- **파일**: `packages/plugins/plugin-git-provider/src/manifest.ts`, `worker.ts`.
- **Capabilities**: `agent.tools.register`, `http.outbound`, `secrets.read-ref`, `webhooks.receive`, `approvals.read`, `approvals.resolve` 등.
- **도구 예**: GitHub PR, GitLab MR 생성, GitLab 이슈/노트/라벨, 파이프라인·MR 토론 조회.
- **설정**: GitHub/GitLab 토큰은 **`company_secrets.id` UUID 참조**(`gitlabTokenRef`, `githubTokenRef`). GitLab 웹훅 검증용 `gitlabWebhookSecretRef`는 UI에서 자동 연동되는 필드(`x-uiHidden`).
- **웹훅**: `endpointKey: gitlab` — MR 승인/승인 취소 이벤트로 연결된 Paperclip 승인을 해소. 계약·트러블슈팅: `doc/GITLAB-APPROVAL-SYNC.md`.
- **런타임 프롬프트**: 에이전트가 `adapterConfig`로 GitLab 연동 지시를 켜면, 플러그인이 회사에서 사용 가능할 때 마크다운 지시가 붙는다 — `server/src/services/gitlab-integration-prompt.ts`, `packages/adapter-utils`의 GitLab 통합 마크다운.

### 2.3 `paperclip.linear-bridge` (Linear Webhook Bridge)

- **파일**: `packages/plugins/plugin-linear-bridge/src/manifest.ts`.
- **동작**: `Linear-Signature`(HMAC-SHA256), 타임스탬프 리플레이 창, `plugin.state` FIFO 큐, **한 번에 하나** 에이전트 세션; 사용자 메시지(템플릿)만 전달.
- **웹훅**: `endpointKey: linear`.
- **문서**: `doc/LINEAR-BRIDGE.md` (Cloudflare Tunnel, 설정 API, `issueActions` vs Linear UI 설명).

### 2.4 `paperclip.slack-commands` (Slack Commands)

- **파일**: `packages/plugins/plugin-slack-commands/src/manifest.ts`.
- **Capabilities**: `webhooks.receive`, `secrets.read-ref`, `http.outbound`, `agents.invoke`.
- **웹훅**: `endpointKey: slash` — `application/x-www-form-urlencoded` (Express 전역 `urlencoded` + `rawBody` — `server/src/app.ts`).
- **설정**: `signingSecretRef`, `companyId`, `agentId` 필수; 채널 화이트리스트·커맨드 접두사 등.

### 2.5 `paperclip.obsidian-brain` (Obsidian Brain)

- **문서**: `doc/OBSIDIAN-BRAIN.md`.
- **런타임 프롬프트**: 에이전트 설정의 `paperclipObsidianBrainWorkflowPrompt`가 켜져 있고 플러그인이 회사에서 비활성이 아니면 워크플로 지시 주입 — `server/src/services/obsidian-brain-workflow-prompt.ts`.

### 2.6 보드·API에서 플러그인 다루기

- 절차 요약: `skills/paperclip/references/plugin-setup.md` — `GET/POST /api/plugins/...`, 설치·enable·config·시크릿 UUID 패턴.

---

## 3. 웹훅 인프라

### 3.1 스키마·상태

- 테이블 `plugin_webhook_deliveries`: 페이로드·헤더·상태(`pending` / `processing` / `succeeded` / `failed`), `retryCount`, `nextRetryAt` 등 (`packages/db/src/schema/plugin_webhooks.ts`).

### 3.2 실패 시 자동 재시도

- `server/src/services/webhook-retry.ts`: 백오프 배열(30s → 120s → 10m → 1h), 최대 5회, `processDueWebhookRetries`.
- **백그라운드 루프**: `startWebhookRetryLoop` — 기본 60초 간격으로 만기된 실패 배달 재처리 (`server/src/app.ts`에서 기동).

### 3.3 운영·진단 API (발췌)

- 웹훅 배달 이력: `GET /api/plugins/:pluginId/webhook-deliveries`.
- 테스트·수동 재시도: `POST .../webhooks/:endpointKey/test`, `POST .../retry/:deliveryId`.
- 브라우저 GET으로 URL 존재 확인: `GET .../webhooks/:endpointKey` (sanity check 메시지).

### 3.4 공개 URL

- 리버스 프록시·터널 뒤에서 GitLab/Linear가 올바른 호스트로 POST 하도록 **`PAPERCLIP_PUBLIC_BASE_URL`**(scheme + host, 슬래시 없음) 설정 — `doc/GITLAB-APPROVAL-SYNC.md` 예시 참고.

---

## 4. 시크릿·보안 하드닝

- Git Provider·Linear 등은 **원시 토큰을 설정 JSON에 넣지 않고** Paperclip **회사 시크릿 행의 UUID**를 참조하는 패턴으로 정리됨 (`manifest`의 `format: "secret-ref"`, `pattern` UUID).
- GitLab 웹훅: GitLab UI의 Secret token **문자열**과 Paperclip 필드의 **UUID**를 혼동하지 말 것 — `doc/GITLAB-APPROVAL-SYNC.md` 표 참고.
- 실행 패키지(토큰 로테이션·증거 수집 시퀀스): `doc/plans/2026-04-04-token-secret-hardening.md`.

---

## 5. 오케스트레이션 (서버 측)

### 5.1 하트비트와 이슈 다이제스트

- `buildPaperclipHeartbeatIssueDigest`: 하트비트 실행 시 로컬 어댑터 stdin에 **작업 지시** 블록(이슈 제목/본문, wake 이유, 트리거 코멘트 등)을 마크다운으로 넣어, 모델이 환경 변수만 보고 멈추는 것을 완화 (`server/src/services/heartbeat-issue-digest.ts`).
- `adapter-utils`의 `heartbeat-issue-digest-context` 등이 관련 컨텍스트 조립에 연동될 수 있음.

### 5.2 에스컬레이션 엔진

- `server/src/services/escalation-engine.ts`: 에이전트 하트비트 런이 끝난 뒤, 담당 에이전트의 **`blocked` 상태 이슈**에 대해 스트릭을 셀고, 임계값(`ESCALATION_HEARTBEAT_THRESHOLD = 2`) 도달 시 **상위(`reportsTo`) 또는 CEO** 쪽으로 재배정하는 서버 주도 로직.

### 5.3 온보딩 자산·역할

- `server/src/onboarding-assets/` — CEO/CFO/CTO/엔지니어 등 역할별 `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md` 등; git status 기준 다수 역할 폴더가 추가·확장됨.
- `server/src/services/role-default-skills.ts`: 채용 시 `desiredSkills`가 비어 있으면 역할별 기본 스킬 **참조 문자열** 병합(예: CEO/CTO → `paperclip`, `paperclip-create-agent`, `para-memory-files`).

### 5.4 회사 스킬

- `server/src/services/company-skills.ts`: 패키지·프로젝트 스캔, 가져오기, 신뢰 수준, 에이전트 사용 추적 등 대형 서비스.
- 스킬 레퍼런스: `skills/paperclip/references/company-skills.md`.

---

## 6. UI·로컬 어댑터

- 에이전트 상세: GitLab 통합·Obsidian 워크플로 등 **어댑터 설정 필드** — `ui/src/adapters/*/config-fields.tsx`, `ui/src/components/AgentConfigForm.tsx`, `ui/src/lib/gitlab-adapter-config-patch.ts`, `ui/src/lib/local-instruction-adapters.ts` (지원 어댑터 타입 집합).
- 지원하는 로컬 CLI 어댑터에서 `AGENTS.md` / `HEARTBEAT.md` 번들 편집 가능.

---

## 7. 개발·로컬 자동화

- **`scripts/dev-runner.ts`**: `dev` / `watch` 모드, `server`, `packages/adapters`, `packages/db`, `packages/plugins/sdk` 등 감시, 상태 파일 `.paperclip/dev-server-status.json`, Tailscale 관련 플래그 등.
- 플러그인 개발 감시: `createPluginDevWatcher` (`server/src/app.ts` 주변).

---

## 8. 관련 문서 빠른 링크

| 문서 | 내용 |
|------|------|
| `doc/GITLAB-APPROVAL-SYNC.md` | GitLab MR 웹훅 ↔ 승인 동기화, 시크릿 UUID, 502 구분, `PAPERCLIP_PUBLIC_BASE_URL` |
| `doc/LINEAR-BRIDGE.md` | Linear 서명·큐·터널·설정 API |
| `doc/OBSIDIAN-BRAIN.md` | Vault 레이아웃, 도구, UI 프롬프트 주입 |
| `doc/plans/2026-04-04-token-secret-hardening.md` | 토큰·시크릿 하드닝 실행 순서 |
| `skills/paperclip/references/plugin-setup.md` | 플러그인 설치·enable·config API 요약 |
| `CLAUDE.md` / `AGENTS.md` | 저장소 라우터·최소 규정 |

---

## 9. 변경 추적 시 참고할 Git 경로 (요약)

웹훅·플러그인·오케스트레이션에 직접 걸린 최근 변경을 볼 때 유용한 그룹:

- `server/src/routes/plugins.ts`, `server/src/app.ts`, `server/src/services/webhook-retry.ts`, `server/src/services/heartbeat*.ts`, `server/src/services/escalation-engine.ts`, `server/src/services/gitlab-integration-prompt.ts`, `server/src/services/obsidian-brain-workflow-prompt.ts`
- `packages/plugins/plugin-git-provider/`, `plugin-linear-bridge/`, `plugin-slack-commands/`, `plugin-obsidian-brain/`
- `packages/db/src/schema/plugin_webhooks.ts`, `packages/shared/src/types/plugin.ts`
- `packages/adapter-utils/src/*prompt*.ts`, `*gitlab*`, `*obsidian*`, `*heartbeat*`
- `scripts/dev-runner.ts`, `ui/src/components/AgentConfigForm.tsx`, `ui/src/adapters/`

---

*이 파일은 저장소 상태를 기준으로 정리한 요약이며, 세부 동작은 구현과 전용 문서가 최종 근거다.*
