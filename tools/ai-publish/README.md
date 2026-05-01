# AI publish — Git push, GitLab MR, Obsidian

AI(또는 로컬 작업)이 끝난 뒤 한 번에 다음을 수행합니다.

1. 새 브랜치 생성(선택) → 변경 스테이징·커밋 → `git push`
2. GitLab Merge Request 생성(리뷰어·담당자 지정 가능)
3. Obsidian Vault 아래 `AI_Reports/YYYY-MM-DD_<슬러그>.md` 리포트 작성(`[[위키링크]]` 포함)

## 준비

```bash
cd /path/to/PaperClip
pip install -r tools/ai-publish/requirements.txt
cp tools/ai-publish/.env.example tools/ai-publish/.env
# .env 편집 후
```

## 환경 변수

| 변수 | 설명 |
|------|------|
| `GITLAB_TOKEN` | GitLab PAT (`api` 범위 권장) |
| `GITLAB_API_URL` | 기본 `https://gitlab.com/api/v4` |
| `GITLAB_PROJECT_ID` | 프로젝트 숫자 ID 또는 URL 인코딩 경로 |
| `TARGET_BRANCH` | MR 타깃 브랜치 (미설정 시 `origin/HEAD` 또는 `main`/`master` 추정) |
| `GITLAB_REVIEWER_IDS` | 쉼표로 구분한 사용자 ID |
| `GITLAB_REVIEWER_USERNAMES` | 쉼표로 구분한 사용자명(API로 ID 조회) |
| `GITLAB_ASSIGNEE_IDS` | 담당자 ID(선택) |
| `OBSIDIAN_VAULT` | Vault 폴더 절대 경로 |
| `OBSIDIAN_REPORTS_DIR` | Vault 기준 하위 폴더, 기본 `AI_Reports` |

`.env`는 저장소에 커밋하지 마세요(`.gitignore`에 포함됨).

## 사용 예

```bash
# 저장소 루트에서
python tools/ai-publish/publish.py --title "피처: 로그인 플로우" --summary "세션 쿠키 처리 추가"

# 이미 만든 브랜치에서만 푸시
python tools/ai-publish/publish.py --use-current-branch --title "fix: 타입 오류"

# MR/파일 쓰기 없이 검증
python tools/ai-publish/publish.py --dry-run --title "test"
```

## Claude Code 연동

- **슬래시**: `/ai-publish` — 프로젝트 [`.claude/commands/ai-publish.md`](../../.claude/commands/ai-publish.md) 참고.
- **훅(SessionEnd)**: 작업 트리가 깨끗하고 특정 경로일 때만 스크립트를 호출하도록 가드를 두는 것을 권장합니다. 예시는 아래와 같습니다.

`~/.claude/settings.json` 또는 프로젝트 설정의 `hooks`에 추가할 때는 [hook-creator 스킬](../../.claude/skills/hook-creator/SKILL.md)과 [hook-events](../../.claude/skills/hook-creator/references/hook-events.md)를 따릅니다.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo \"Optional: run publish only when ready\""
          }
        ]
      }
    ]
  }
}
```

실제 운영에서는 `Stop`/`SessionEnd`에서 `python .../tools/ai-publish/publish.py ...`를 호출하기 전에 `git status --porcelain` 등으로 조건을 두는 셸 스크립트를 두면 안전합니다.

## Paperclip 에이전트

에이전트는 Bash로 푸시한 뒤 플러그인 도구 `gitlab.create_merge_request`를 호출할 수 있습니다. MR에 리뷰어를 넣으려면 `assigneeIds` / `reviewerIds` 배열을 전달하세요. 로컬 스크립트와 동일한 정책을 쓰려면 이 저장소의 `publish.py`만 실행하도록 운영 규칙을 통일하면 됩니다.
