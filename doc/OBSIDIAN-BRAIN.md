# Obsidian Brain 플러그인

에이전트가 Obsidian Vault 안에 **Paperclip 전용 트리**로 Markdown을 읽고 쓰는 플러그인(`paperclip.obsidian-brain`). 에이전트는 작업 중/후에 재사용 가능한 지식을 **자발적으로 저장**하고, `[[wikilinks]]`로 노트를 연결합니다.

## 디렉터리 레이아웃

```text
{vaultRoot}/
  PaperclipBrain/
    {companyId}/
      agents/
        {agentId}/
          ... 에이전트 전용 .md
      common/
        ... 공유 다이제스트·요약 .md
```

- **에이전트 전용**: 각 에이전트는 `agents/{agentId}/` 아래에 자유롭게 읽기/쓰기.
- **common**: 모든 에이전트가 `common/` 경로를 읽을 수 있음.
- **common 쓰기**: `allowAllAgentsCommonWrite` 옵션이 켜져 있으면 회사 전체 에이전트가 `write_common` 사용 가능. 꺼져 있으면 `orchestratorAgentIds`에 등록된 에이전트만 가능.

## 설치

1. Paperclip UI 플러그인 목록에서 **Obsidian Brain** 설치.
2. 인스턴스 설정:
   - **vaultRoot**: Obsidian이 여는 **실제 Vault 폴더의 절대 경로** (예: `C:\Users\…\OneDrive\문서\Obsidian Vault`). 상대 경로는 Paperclip **서버 프로세스의 cwd** 기준으로 풀리므로, 에이전트 작업 폴더와 무관하고 거의 항상 잘못된 위치가 됩니다.
   - **Allow all agents to write common/**: 켜면 전 에이전트가 `write_common` 사용 가능.
   - **orchestratorAgentIds**: 위 옵션이 꺼져 있을 때 common 쓰기가 허용될 에이전트 UUID (쉼표 구분).

### 에이전트별 프롬프트 주입 (UI)

에이전트 **설정(Configuration)** 탭에 **Obsidian Brain workflow (prompt)** 섹션이 있습니다. **Inject Obsidian Brain workflow into prompt**를 켜면 해당 에이전트의 하트비트 프롬프트에 짧은 워크플로 지시(필요 시 문서화·선택적 읽기·`common/`·오케스트레이터 전달)가 붙습니다. 도구 호출을 강제하지는 않습니다.

주입 조건: 플러그인이 인스턴스에 설치되어 있고 `disabled` / `uninstalled` / `error` 상태가 아니며, 회사별 플러그인 설정에서 해당 플러그인이 끄지(`enabled: false`) 않은 경우입니다.

`adapterConfig` 키: `paperclipObsidianBrainWorkflowPrompt` (boolean).

### Auto-knowledge 모드 (토큰 절감)

워크플로 프롬프트가 켜진 상태에서 **Auto-knowledge mode** 토글을 추가로 켜면, 에이전트에게 **매 하트비트 런마다 의무적으로** 다음을 수행하도록 지시합니다:

1. **런 시작** — `_role-context.md` 를 먼저 읽어 이전 런에서 구조화한 역할·환경·작업 상태를 즉시 숙지. 추가로 현재 작업과 관련된 노트만 선택적으로 읽기.
2. **런 도중** — 기술 결정(`decisions/`), API 레퍼런스(`references/`), 트러블슈팅(`troubleshooting/`) 등을 즉시 저장.
3. **런 종료** — `_role-context.md` 를 업데이트하여 다음 런이 재발견 없이 바로 작업 시작 가능. 작업 로그(`work-log/YYYY-MM-DD.md`)에도 기록.

이로 인해 다음 하트비트 런에서 역할 파악·환경 탐색에 사용되던 토큰이 크게 절감됩니다.

`adapterConfig` 키: `paperclipObsidianBrainAutoKnowledge` (boolean).

### 파일이 `…\.paperclip\instances\…\projects\…\obsidian-vault\` 아래만 생기는 경우

플러그인은 DB에 저장된 `vaultRoot`를 **그대로** 사용합니다. 코드가 OneDrive Vault로 자동 리다이렉트하지 않습니다. 위 경로에 `PaperclipBrain`이 보이면 설정값이 그 트리를 가리키거나, `vaultRoot`가 상대 경로(`obsidian-vault` 등)로 들어가 서버 cwd 아래로 풀린 경우입니다. UI에서 **절대 경로**를 다시 저장하고, 값 앞뒤에 따옴표가 붙지 않았는지 확인하세요. 설정 검사 시 Paperclip이 관리하는 `projects` 경로면 경고를 띄웁니다.

**선택**: 실제 Vault 대신 프로젝트 체크아웃 옆에만 두고 싶다면 의도된 구성일 수 있습니다. 다만 그 경우 **Obsidian 앱**에서는 해당 폴더를 Vault로 열어야 그래프·검색이 됩니다.

## 에이전트 행동 기대치

### 작업 시작

1. `obsidian_brain.list` (scope: agent) → 기존 노트 중 현재 작업 주제와 매칭되는 제목 탐색.
2. 매칭되는 노트가 있으면 `obsidian_brain.read`로 기존 컨텍스트 재사용 (재발견 비용 절감).
3. `obsidian_brain.list` (scope: common) → 팀 공유 지식 확인.

### 작업 도중

- 재사용 가능한 요소 (코드 스니펫, 설계 결정, API 레퍼런스, 설정 템플릿)를 발견하면 `write` 또는 `append`로 즉시 저장.
- 관련 노트는 `[[다른 노트 제목]]` wikilink로 연결.

### 작업 완료

- 새로운 지식이 생성되었으면 요약 노트 작성.
- 기존 노트에 추가할 내용이면 `append`로 중복 방지.

### 토큰 최적화

- `list` → 선택적 `read` (1–2개) 순서로. 전체 폴더를 일괄 읽지 않음.
- 노트 내용은 간결하게 유지. 프롬프트에 불필요한 내용을 넣지 않음.

## 도구 요약

| 도구 | 용도 |
|------|------|
| `obsidian_brain.list` | 작업 시작 시 기존 노트 탐색 (agent 또는 common scope) |
| `obsidian_brain.read` | 에이전트 폴더 또는 `common/` 노트 읽기 |
| `obsidian_brain.write` | 에이전트 폴더에 노트 생성/덮어쓰기 (`[[wikilinks]]` 사용) |
| `obsidian_brain.append` | 기존 노트에 내용 추가 |
| `obsidian_brain.write_common` | common/ 공유 노트 작성 (허용된 에이전트만) |

## Auto-knowledge 모드 디렉터리 구조 (권장)

```text
{agentId}/
  _role-context.md        ← 역할 브리핑 (매 런 종료 시 업데이트)
  decisions/              ← 기술 결정 기록
    YYYY-MM-DD-<topic>.md
  references/             ← API/설정/패턴 레퍼런스
    <topic>.md
  troubleshooting/        ← 에러 해결 기록
    <topic>.md
  work-log/               ← 일별 작업 로그
    YYYY-MM-DD.md
```

## 관련 문서

- Claude 어댑터 스킬: `packages/adapters/claude-local/skills/obsidian-brain/SKILL.md`
