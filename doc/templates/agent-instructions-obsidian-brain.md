# 에이전트 지시문 — Obsidian Brain + GitLab (템플릿)

이 파일을 복사한 뒤 절대 경로로 저장하고, Paperclip 에이전트 설정의 **instructionsFilePath**에 지정하세요.

## 역할

- 코드베이스와 Paperclip 이슈/태스크를 우선합니다.
- Obsidian Vault는 **Paperclip 플러그인 도구 `obsidian_brain.*`로만** 읽고 씁니다. Vault를 일반 Read 도구로 직접 읽지 않습니다.
- 컨텍스트 절약: `obsidian_brain.list`로 범위를 좁힌 뒤, 필요한 `obsidian_brain.read`만 수행합니다.

## Vault 사용

- 자신의 장기 기억·결론·유의사항은 **에이전트 전용 경로**에 `obsidian_brain.write` / `append`로 남깁니다(필요할 때만).
- 팀 공통 요약·다이제스트는 `common/` 아래를 **읽기**할 수 있습니다(`read` 시 경로: `common/파일명.md`).
- `common/`에 **쓰기**는 오케스트레이터 에이전트만 수행합니다(설정된 경우 `obsidian_brain.write_common`).

## GitLab — 한 작업 단위(권장 파이프라인)

아래 **1→2→3**을 한 번에 끝낸 것을 “코드 납품 단위”로 취급합니다. 중간에 멈추지 않습니다.

1. **코드 수정** — 워크스페이스에서 파일을 편집·검증합니다.
2. **원격에 반영**
   - **방법 A (로컬 git, Shell/Bash 도구가 있을 때 — 기본):** 어댑터의 **터미널/Shell 도구로** `git status` 확인 후 `git checkout -b …` → `git add` → `git commit` → `git push -u origin …` 를 **직접 실행**합니다. MR만 만들고 push를 생략하지 않습니다.
   - **방법 B (Shell 없음 / CI 전용 런타임):** 플러그인 **`gitlab.create_branch`** 와 **`gitlab.create_commit`**(Commits API)로 원격 브랜치·커밋을 만든 뒤 MR로 이어갑니다.
3. **MR 생성** — **`gitlab.create_merge_request`** 를 호출합니다(`sourceBranch` / `targetBranch` / `projectId` / `title` 등).

### 선택 도구

- GitLab 이슈 트래커에 Paperclip 작업을 올릴 때 **`gitlab.create_issue`** 에 **`paperclipIssueId`**(현재 Paperclip 이슈 UUID)를 넘깁니다. 보드 이슈에 GitLab 링크 댓글이 달리고 GitLab 본문에 Paperclip id 푸터가 붙습니다.
- 같은 작업의 지속 기록은 **`obsidian_brain.append`** 등으로 vault 작업 로그(예: `work-log/YYYY-MM-DD.md`)에 GitLab URL·요약 한 줄을 남깁니다.
- 기존 이슈·파이프라인·노트는 `gitlab.get_issue`, `gitlab.update_issue`, `gitlab.create_issue_note`, `gitlab.list_project_pipelines` 등 기존 도구를 따릅니다.

프로젝트 ID·브랜치 명명·리뷰어·PAT 스코프(`api`, `write_repository`)는 운영 규칙과 `paperclip.git-provider` 설정을 따릅니다.

## 오케스트레이터 에이전트 (별도 에이전트로 둘 경우)

- 다른 에이전트의 `agents/*/…` 요약을 읽을 수 있도록 **읽기 도구만** 사용해 훑은 뒤, `write_common`으로 `common/YYYY-MM-DD_digest.md` 형태로 정리합니다.
- 자동 스케줄이 없으면 보드에서 수동 런으로 실행합니다.
