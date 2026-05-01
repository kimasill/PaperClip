# Linear Webhook Bridge (`paperclip.linear-bridge`)

로컬 Paperclip이 Linear 웹훅을 받아 에이전트를 순차 실행하는 플러그인입니다. 외부 지시는 **에이전트의 시스템 프롬프트를 바꾸지 않고**, `agents.sessions.sendMessage`의 **사용자 메시지(템플릿)** 로만 전달됩니다.

## 동작 요약

1. **서명**: 요청 본문(raw UTF-8 문자열)에 대해 HMAC-SHA256(웹훅 시크릿)을 계산하고, HTTP 헤더 `Linear-Signature`(hex)와 `crypto.timingSafeEqual`로 비교합니다. [Linear 문서: Securing Webhooks](https://linear.app/developers/webhooks#securing-webhooks)
2. **리플레이 방지**: 본문의 `webhookTimestamp`(ms)가 현재 시각과 설정된 창(기본 120초) 안에 있어야 합니다.
3. **큐**: 처리 대상 이슈 이벤트는 `plugin.state`에 FIFO 큐로 저장되고, 한 번에 하나의 작업만 에이전트 세션으로 실행됩니다.
4. **순차 실행**: 이전 작업의 세션이 끝난(`done` 이벤트) 뒤에만 다음 큐 항목을 꺼냅니다.

## Paperclip 웹훅 URL

웹훅 경로의 `{pluginId}` 자리에는 **설치된 플러그인을 가리키는 식별자**를 넣습니다. 호스트는 다음 둘 다 허용합니다.

- **DB에 저장된 플러그인 행의 UUID** (`id` 필드)
- **플러그인 키** 문자열 (예: 이 플러그인은 예제 목록 기준 `paperclip.linear-bridge`)

```http
POST /api/plugins/{pluginId}/webhooks/linear
Content-Type: application/json; charset=utf-8
Linear-Signature: <hex>
Linear-Event: Issue
Linear-Delivery: <uuid>
```

`endpointKey`는 `linear`입니다. 이 URL은 **보드 인증이 없습니다**(Linear가 호출). 대신 플러그인이 `Linear-Signature`로 검증합니다.

### 플러그인 설치·활성화·식별자 확인 (상세)

1. **개발 서버 기동**  
   저장소 루트에서 `pnpm dev` 등으로 API가 뜨는지 확인합니다(기본 `http://localhost:3100`).

2. **플러그인 설치**  
   보드 세션(브라우저에서 Paperclip 로그인) 또는 보드 인증이 붙은 API 클라이언트로 설치합니다. 로컬 패키지 예시는 `doc/plugins/PLUGIN_AUTHORING_GUIDE.md`와 동일합니다.

   - HTTP 예: `POST /api/plugins/install`  
     본문 예: `{"packageName":"S:/Project/PaperClip/packages/plugins/plugin-linear-bridge","isLocalPath":true}`  
     (`packageName`은 본인 환경의 **절대 경로**로 바꿉니다.)

3. **인스턴스 설정 저장**  
   아래 [플러그인 설정 API](#플러그인-설정-api)를 사용합니다. `{pluginId}`에는 플러그인 **UUID** 또는 **`paperclip.linear-bridge`** 를 넣을 수 있습니다.

4. **활성화(Enable)**  
   `POST /api/plugins/{pluginId}/enable`  
   웹훅은 플러그인 상태가 **`ready`** 일 때만 받습니다. 비활성/오류 상태면 `400`이 납니다.

5. **어디서 ID/키를 보나**  
   - **UI**: Paperclip 보드의 플러그인(또는 설정) 화면에서 설치된 플러그인 목록을 열면 각 행의 **UUID**와 **pluginKey**가 보입니다(표시 이름은 제품 UI 문구에 따름).  
   - **API**: `GET /api/plugins` — 응답 배열의 각 항목에서 `id`(UUID), `pluginKey`, `status`를 확인합니다.  
   - **단일 조회**: `GET /api/plugins/{pluginId}` — `pluginId`에 UUID 또는 키 문자열을 넣을 수 있습니다.

6. **Linear에 넣을 최종 URL**  
   공인 HTTPS 베이스(아래 [Cloudflare Tunnel](#cloudflare-tunnel-상세)) + 경로:

   `https://<공인-호스트>/api/plugins/<UUID 또는 paperclip.linear-bridge>/webhooks/linear`

## Cloudflare Tunnel (상세)

Linear는 **공개 HTTPS URL**만 허용하므로, 집/사무실 PC의 Paperclip에 들어오려면 로컬 포트를 인터넷에 노출하는 터널이 필요합니다. 여기서는 Cloudflare Tunnel(`cloudflared`) 기준으로만 적습니다.

### 준비

1. [cloudflared 설치](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (Windows는 `.msi` 또는 패키지 매니저).
2. Paperclip API 포트 확인: 기본은 **`http://127.0.0.1:3100`** (`pnpm dev` 기준). 본인이 다른 포트를 쓰면 그에 맞춥니다.

### 가장 빠른 시험: 임시(Quick) 터널

로그인 없이 임시 URL이 나옵니다. 개발·연동 테스트에 쓰기 좋고, URL이 바뀔 수 있어 **장기 Linear 웹훅에는 부적합**할 수 있습니다.

```bash
cloudflared tunnel --url http://127.0.0.1:3100
```

출력에 `https://xxxx.trycloudflare.com` 형태의 URL이 나오면, Linear 웹훅에는 다음처럼 넣습니다.

`https://xxxx.trycloudflare.com/api/plugins/<pluginId>/webhooks/linear`

### 고정 도메인이 필요할 때

Cloudflare Zero Trust 대시보드에서 Tunnel을 만들고, 퍼블릭 호스트네임(예: `paperclip.example.com`)을 로컬 `http://127.0.0.1:3100`에 연결합니다. 절차는 [Cloudflare 문서: Add a tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/)을 따릅니다.

### Linear 쪽

1. Linear **Settings → API → Webhooks → New webhook**
2. URL: 위에서 만든 **HTTPS 베이스 + 전체 경로** (`.../webhooks/linear`까지 포함)
3. 웹훅을 저장한 뒤 상세 화면에서 **Signing secret**을 복사합니다. 이 값은 Linear UI에만 두지 말고, **Paperclip 회사 시크릿**으로 한 번 저장한 뒤 그 시크릿의 **UUID**를 `webhookSigningSecretRef`에 넣습니다(아래 [인스턴스 설정](#인스턴스-설정)).

#### Linear 웹훅 UI에 `create` 체크박스가 없는 이유

Linear 설정 화면의 **Issue** 등은 **어떤 리소스/이벤트 종류를 보낼지**를 고릅니다.  
반면 플러그인의 `issueActions` 기본값 `["create"]`는 **웹훅 JSON 본문 안의 필드 `action`**(예: 이슈 생성 시 `create`, 수정 시 `update`)과 비교합니다. 이건 **Linear 대시보드의 별도 체크박스가 아니라** 페이로드 문자열입니다.  
**Issue만 켜 두면** 이슈 관련 이벤트가 오고, 기본 설정이면 그중 **`action`이 `create`인 것만** 큐에 넣습니다. 업데이트 등도 처리하려면 플러그인 설정에서 `issueActions`에 `update` 등을 추가하고, Linear 쪽에서 해당 변경에 대한 웹훅이 오게 하면 됩니다.

## 플러그인 설정 API

- **구현 위치**: `server/src/routes/plugins.ts` — `GET/POST /plugins/:pluginId/config` (Express `app`에 `/api`가 붙으면 최종 경로는 아래와 같음).
- **전체 URL (로컬 예)**: `http://127.0.0.1:3100/api/plugins/{pluginId}/config`  
  `{pluginId}` = 플러그인 UUID 또는 `paperclip.linear-bridge`.
- **인증**: **보드 세션**이 필요합니다(`assertBoard`). 브라우저에서 로그인한 상태로 호출하거나, API 클라이언트에 보드용 쿠키/인증을 붙입니다. (웹훅 URL `.../webhooks/linear`와는 다릅니다.)

### `GET /api/plugins/{pluginId}/config`

- 현재 저장된 인스턴스 설정을 조회합니다. 없으면 `null`에 가깝게 반환될 수 있습니다.

### `POST /api/plugins/{pluginId}/config`

- **Content-Type**: `application/json`
- **본문 양식 (필수 키)**:

```json
{
  "configJson": {
    "webhookSigningSecretRef": "<Paperclip 회사 시크릿 UUID>",
    "companyId": "<회사 UUID>"
  }
}
```

- **`agentId`** (선택): 특정 에이전트를 지정합니다. 없으면 워커가 해당 회사의 에이전트 목록에서 기본값을 고릅니다(CEO 역할 우선, 없으면 종료되지 않은 첫 에이전트). 회사에 쓸 에이전트가 하나도 없으면 웹훅 처리 시 오류가 납니다.
- 선택 필드(`promptTemplate`, `issueActions`, `linearEventTypes`, `replayWindowMs`, `taskTimeoutMs`)는 [인스턴스 설정](#인스턴스-설정) 표를 참고해 같은 객체 안에 넣습니다.
- **검증**: 서버가 플러그인 `instanceConfigSchema`와 맞는지 검사합니다. 실패 시 `400`과 `fieldErrors`를 돌려줄 수 있습니다.

### `POST /api/plugins/{pluginId}/config/test`

- 설정을 **저장하지 않고** 워커의 `onValidateConfig`만 호출해 볼 때 사용합니다(플러그인이 `ready`일 때).

## curl로 그대로 호출하기 (Windows 포함)

### `curl -s api/plugins/.../config` 처럼 쳤는데 아무것도 안 나올 때

1. **`http://` 또는 `https://`와 호스트·포트가 있어야 합니다.**  
   `api/plugins/...` 만 치면 curl은 **호스트가 없는 상대 경로**로 처리하지 못하거나 엉뚱한 동작을 합니다.  
   **올바른 예**: `http://127.0.0.1:3100/api/plugins/.../config`

2. **경로 앞에 `/api` 가 있어야 합니다.**  
   서버는 `app.use("/api", api)` 로 마운트합니다(`server/src/app.ts`). 즉 전체 경로는 항상 **`/api/...`** 입니다.

3. **이 API는 보드 인증이 필요합니다.**  
   쿠키 없이 `GET` 하면 `401`/`403` 이거나 본문이 비어 보일 수 있습니다. 브라우저에서 Paperclip 보드에 로그인한 뒤, 아래처럼 **Cookie 헤더**를 붙입니다.

4. **아직 설정을 한 번도 저장하지 않았으면** `GET .../config` 응답이 **`null`** 일 수 있습니다. 그건 오류가 아니라 “저장된 인스턴스 설정이 없음”입니다.

**Windows**: PowerShell에서 `curl`은 기본이 **Invoke-WebRequest 별칭**일 수 있습니다. 아래처럼 **`curl.exe`** 를 쓰면 문서와 동일하게 동작합니다.

### 1) 보드 쿠키 준비

1. 브라우저에서 `http://127.0.0.1:3100` (또는 본인 보드 URL)에 로그인합니다.
2. 개발자 도구(F12) → **Network** → 아무 API 요청 하나 선택 → **Request Headers** 의 **`Cookie:`** 줄 전체를 복사합니다.
3. 터미널에서 (예시, 값은 본인 것으로 교체):

**Git Bash / macOS / Linux**

```bash
export COOKIE='여기에_Cookie_헤더_값_전체_붙여넣기'
```

**PowerShell**

```powershell
$env:COOKIE = '여기에_Cookie_헤더_값_전체_붙여넣기'
```

### 2) 회사 UUID · 에이전트 UUID 조회

`companyId` 는 플러그인 설정에 넣습니다. `agentId` 는 생략할 수 있으며, 생략 시 위 기본 규칙으로 자동 선택됩니다. 특정 에이전트를 고정하려면 아래 목록에서 `id` 를 복사해 `agentId` 에 넣습니다.

**회사 목록** (`id` 필드가 회사 UUID):

```bash
curl -sS -H "Cookie: $COOKIE" "http://127.0.0.1:3100/api/companies"
```

PowerShell에서는:

```powershell
curl.exe -sS -H "Cookie: $env:COOKIE" "http://127.0.0.1:3100/api/companies"
```

**해당 회사의 에이전트 목록** (`YOUR_COMPANY_ID` 를 위에서 본 UUID로 바꿈):

```powershell
curl.exe -sS -H "Cookie: $env:COOKIE" "http://127.0.0.1:3100/api/companies/YOUR_COMPANY_ID/agents"
```

응답 JSON 배열에 있는 에이전트 객체의 **`id`** 를 `agentId` 로 선택할 때 사용합니다.

### 3) Linear Signing secret 을 Paperclip “회사 시크릿”으로 등록 (매우 상세)

플러그인 필드 `webhookSigningSecretRef` 에 넣을 수 있는 값은 **Linear 시크릿 문자열 그대로가 아니라**, Paperclip DB에 등록된 **회사 시크릿 한 건의 UUID**(`company_secrets.id`)입니다. 호스트가 `ctx.secrets.resolve(그_UUID)` 로 복호화한 뒤 HMAC 검증에 씁니다(`server/src/services/plugin-secrets-handler.ts`).

**준비**

1. Linear **Settings → API → Webhooks** 에서 해당 웹훅을 열고 **Signing secret** 문자열을 복사합니다. (이 값은 Linear 쪽에만 두지 말고 다음 단계에서 Paperclip에 **똑같이** 저장합니다.)
2. Paperclip API가 떠 있는지 확인합니다 (`http://127.0.0.1:3100/api/health`).

**시크릿 생성 API** (구현: `server/src/routes/secrets.ts`)

- **메서드·경로**: `POST http://127.0.0.1:3100/api/companies/{companyId}/secrets`
- **본문 (JSON)**  
  - `name` (필수): 구분용 이름. 예: `linear-webhook-signing`  
  - `value` (필수): Linear에서 복사한 **Signing secret 원문** (긴 문자열)  
  - `description` (선택): 메모  
  - `provider` (선택): 생략 시 서버 기본값(보통 `local_encrypted`)

**한 줄 예시** (PowerShell — `YOUR_COMPANY_ID` / 시크릿 값은 본인 것으로 교체):

```powershell
curl.exe -sS -X POST "http://127.0.0.1:3100/api/companies/YOUR_COMPANY_ID/secrets" -H "Content-Type: application/json; charset=utf-8" -H "Cookie: $env:COOKIE" -d "{\"name\":\"linear-webhook-signing\",\"value\":\"LINEAR에서_복사한_Signing_secret_전체\",\"description\":\"Linear webhook HMAC\"}"
```

**성공 시** HTTP `201` 과 함께 JSON이 옵니다. 그중 **`id`** 필드(예: `"a1b2c3d4-...."`)를 메모합니다. 이 문자열이 **`webhookSigningSecretRef` 에 넣을 UUID** 입니다.  
(응답에 시크릿 **값**은 다시 내려주지 않는 것이 정상에 가깝습니다. 값은 DB에만 암호화 저장됩니다.)

**이미 같은 이름으로 만들었다면** `GET` 으로 목록만 확인합니다(값은 안 보임):

```powershell
curl.exe -sS -H "Cookie: $env:COOKIE" "http://127.0.0.1:3100/api/companies/YOUR_COMPANY_ID/secrets"
```

### 4) 플러그인 인스턴스 설정 저장 — 실제 `curl` 예시

아래에서 다음만 본인 환경에 맞게 바꿉니다.

- `e465a720-87dc-4df1-8201-5a418acdb187` → 본인 플러그인 설치 UUID (`GET /api/plugins` 의 `id`) 또는 `paperclip.linear-bridge` 로 대체 가능  
- `SECRET_UUID_FROM_STEP_3` → 3) 응답의 `id`  
- `YOUR_COMPANY_ID` / `YOUR_AGENT_ID` → 2)에서 조회한 UUID

```powershell
curl.exe -sS -X POST "http://127.0.0.1:3100/api/plugins/e465a720-87dc-4df1-8201-5a418acdb187/config" -H "Content-Type: application/json; charset=utf-8" -H "Cookie: $env:COOKIE" -d "{\"configJson\":{\"webhookSigningSecretRef\":\"SECRET_UUID_FROM_STEP_3\",\"companyId\":\"YOUR_COMPANY_ID\",\"agentId\":\"YOUR_AGENT_ID\"}}"
```

### 5) 저장 여부 확인 (GET)

```powershell
curl.exe -sS -H "Cookie: $env:COOKIE" "http://127.0.0.1:3100/api/plugins/e465a720-87dc-4df1-8201-5a418acdb187/config"
```

한 번도 저장하지 않았다면 `null` 일 수 있고, 저장 후에는 `configJson` 등이 포함된 객체가 나와야 합니다.

## 인스턴스 설정

설정은 **운영자가 직접** `POST /api/plugins/{pluginId}/config`로 넣거나, UI에 플러그인 인스턴스 설정 폼이 있으면 그곳에 입력합니다. 플러그인이 웹훅 페이로드만 보고 `companyId` / `agentId`를 **자동 추론하지는 않습니다.**

| 필드 | 필수 | 누가/무엇이 정하는지 | 설명 |
|------|------|----------------------|------|
| `webhookSigningSecretRef` | 예 | **직접** | Linear 웹훅 **Signing secret** 문자열을 Paperclip **회사 시크릿**으로 저장한 뒤, 그 시크릿 행의 **UUID**(`company_secrets.id`)를 넣습니다. 플러그인은 호스트의 `ctx.secrets.resolve`로 값을 읽어 `Linear-Signature` 검증에 사용합니다(`server/src/services/plugin-secrets-handler.ts` 참고). |
| `companyId` | 예 | **직접** | 웹훅으로 깨울 에이전트가 속한 **회사 UUID**. 보드에서 회사 목록/API로 확인합니다. |
| `agentId` | 예 | **직접** | 작업을 맡길 **에이전트 UUID**. 자동 배정 없음. |
| `promptTemplate` | 아니오 | **직접(선택)** | 비우면 플러그인 코드에 있는 기본 한국어 템플릿을 씁니다. 바꾸면 그 문자열이 **사용자 메시지**로만 들어갑니다. `{{identifier}}` 등 치환은 플러그인이 웹훅 본문에서 채웁니다. |
| `issueActions` | 아니오 | **직접(선택)** | 미설정 시 내부 기본값 `["create"]`만 처리. 빈 배열 `[]`로 두면 **모든** `action`을 큐에 넣습니다. |
| `linearEventTypes` | 아니오 | **직접(선택)** | 미설정 시 기본 `["Issue"]`. 빈 배열이면 `Linear-Event` 필터를 쓰지 않습니다. |
| `replayWindowMs` | 아니오 | **직접(선택)** | 미설정 시 기본 `120000`. `webhookTimestamp` 허용 범위입니다. |
| `taskTimeoutMs` | 아니오 | **직접(선택)** | 미설정 시 기본 `3600000`(1시간). 세션 한 건 대기 상한입니다. |

**정리**: 반드시 손으로 넣어야 하는 것은 **`webhookSigningSecretRef`, `companyId`, `agentId`** 세 가지입니다. 나머지는 기본값으로도 동작하고, 동작을 바꾸고 싶을 때만 설정합니다.

## 로컬 검증 스크립트

`tools/linear-bridge/test_webhook.py`는 동일한 시크릿으로 서명된 POST를 연속으로 보내 순차 처리 여부를 확인할 때 사용합니다. Paperclip이 떠 있고, 플러그인이 **ready**이며, URL·시크릿이 맞아야 합니다.

```bash
python tools/linear-bridge/test_webhook.py --base-url https://your-tunnel.example.com --plugin-id <uuid-or-pluginKey> --secret "<linear-webhook-secret>"
```

`--plugin-id`에는 `GET /api/plugins`로 확인한 **UUID** 또는 **`paperclip.linear-bridge`** 를 넣을 수 있습니다.
