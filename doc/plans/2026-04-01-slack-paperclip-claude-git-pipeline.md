---
title: "Slack → Paperclip → Claude Code CLI → GitHub/GitLab 파이프라인 (V1)"
date: "2026-04-01"
status: "draft"
---

## 목표

Slack의 Slash Command로 들어온 작업 지시를 Paperclip이 받아 **에이전트 실행(Claude Code CLI)**까지 자동으로 연결하고, 필요 시 **GitHub PR / GitLab MR 생성**까지 이어지는 운영 가능한 파이프라인을 구성한다.

이 문서는 Paperclip V1 코드베이스 기준으로 다음을 포함한다.

- Slack 수신(서명 검증 포함)
- Paperclip Agent invocation
- GitHub/GitLab PR/MR 생성(에이전트가 호출할 수 있는 Tool 제공)
- Claude Code CLI 비대면 자동화(`--enable-auto-mode`) 기본값 반영

## 구현 요약 (코드)

- **Slack 수신 플러그인**: `@paperclipai/plugin-slack-commands`
  - 웹훅 엔드포인트: `endpointKey = "slash"`
  - 서명 검증: `X-Slack-Signature`, `X-Slack-Request-Timestamp`
  - Slack `response_url`로 비동기 응답 전송
- **Git provider 플러그인**: `@paperclipai/plugin-git-provider`
  - 에이전트 Tool:
    - `github.create_pull_request`
    - `gitlab.create_merge_request`
- **서버 바디 파서 보강**: Slack의 `application/x-www-form-urlencoded`을 받기 위해 `server/src/app.ts`에 `express.urlencoded()` 추가 (rawBody stash 포함).
- **Claude Code CLI 비블로킹 권장**:
  - 새 에이전트 생성 기본 `extraArgs = "--enable-auto-mode"`
  - UI 도움말/문서에 `--enable-auto-mode` 권장 명시

## 운영 구성 (필수)

### 1) Claude Code CLI 설치 및 로그인

Paperclip 서버가 실행되는 머신에서:

```bash
npm install -g @anthropic-ai/claude-code
claude auth login
```

Paperclip의 `claude_local` 에이전트는 로컬에서 `claude` 바이너리를 실행하므로, **해당 OS 사용자 계정에 로그인 세션이 유지**되어야 한다.

### 2) Paperclip 실행

```bash
pnpm install
pnpm dev
```

로컬에서 Slack이 접근해야 한다면 ngrok 등으로 공개 URL을 만든다.

### 3) 플러그인 설치

UI에서 `Settings → Plugins → Examples`에 아래 항목이 보이면 로컬 경로 설치로 추가한다.

- **Slack Commands** (`@paperclipai/plugin-slack-commands`)
- **Git Provider Tools** (`@paperclipai/plugin-git-provider`)

또는 API로 로컬 경로 설치:

```bash
curl -X POST http://localhost:3100/api/plugins/install \
  -H "content-type: application/json" \
  -d "{\"packageName\":\"<ABS_PATH_TO_REPO>/packages/plugins/plugin-slack-commands\",\"isLocalPath\":true}"
```

### 4) Slack App / Slash Command 설정

Slack 앱에서 Slash Command를 만들고 Request URL을 다음으로 설정한다.

`POST /api/plugins/{pluginId}/webhooks/slash`

- `pluginId`는 설치된 플러그인의 UUID 또는 plugin key(매니페스트 id)를 사용 가능하다.
- 예: `paperclip.slack-commands`를 키로 쓰면:
  - `POST /api/plugins/paperclip.slack-commands/webhooks/slash`

Slack 쪽에서 아래 값을 반드시 얻는다.

- **Signing Secret**

### 5) Slack Commands 플러그인 설정

`Settings → Plugins → Slack Commands → Configuration`에서:

- `signingSecretRef`: Slack Signing Secret을 가리키는 secret ref
- `companyId`: 작업을 실행할 회사 UUID
- `agentId`: 실행할 에이전트 UUID
- (선택) `projectId`: 프롬프트에 포함할 프로젝트 UUID
- (선택) `commandPrefix`: 예 `@Engineer`처럼 프리픽스 강제
- (선택) `allowChannels`: 허용 채널 ID 목록

### 6) Git Provider Tools 플러그인 설정

PR/MR 생성을 위해 토큰을 secret ref로 저장하고 플러그인 설정에 연결한다.

- GitHub: `githubTokenRef`
- GitLab: `gitlabTokenRef`

둘 다 설정하면 에이전트가 상황에 맞게 Tool을 선택해 호출할 수 있다.

## Slack 사용 예시

Slash command 텍스트(예시):

- `@Engineer 결제 페이지를 모바일 반응형으로 수정하고, 브랜치를 푸시한 뒤 PR/MR을 생성해줘.`

플러그인은 다음을 수행한다.

1. Slack 서명 검증 성공 시 `response_url`로 “작업 시작” 메시지 전송
2. Paperclip 에이전트에 작업 프롬프트로 `agents.invoke` 호출
3. `runId`를 Slack에 후속 메시지로 전송

## PR/MR 생성 Tool 사용(에이전트용)

에이전트는 작업 후 아래 중 하나를 호출한다.

### GitHub PR

- Tool: `github.create_pull_request`
- 입력 예:
  - `owner`: `org`
  - `repo`: `repo`
  - `head`: `feature/my-branch`
  - `base`: `main`
  - `title`: `Fix: mobile layout`
  - `body`: 요약/테스트 플랜

### GitLab MR

- Tool: `gitlab.create_merge_request`
- 입력 예:
  - `projectId`: `group%2Frepo` 또는 numeric id
  - `sourceBranch`: `feature/my-branch`
  - `targetBranch`: `master`
  - `title`: `Fix: mobile layout`

## 세션 만료/장애 대응(권장)

- **Claude 로그인 세션 만료**: `claude auth status`가 실패하면 재로그인 필요.
- Paperclip은 `claude_local` 어댑터에서 쿼터/상태 확인 경로가 있으므로, 운영에서는 주기적으로 상태 확인을 실행하고 실패 시 Slack으로 알리는 루틴을 권장한다.

## 보안/운영 주의

- Slack Signing Secret 및 Git 토큰은 **반드시 secret ref**로 저장한다.
- Slack webhook은 공개 엔드포인트이므로, **서명 검증 실패 시 즉시 reject**하도록 플러그인에서 강제한다.
- GitHub/GitLab 토큰 권한은 최소 권한 원칙으로 부여한다.

