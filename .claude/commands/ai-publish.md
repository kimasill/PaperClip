---
allowed-tools: Bash(python:*), Bash(python3:*)
argument-hint: [--use-current-branch] [--dry-run] --title "작업 제목"
description: AI 작업 후 Git 푸시, GitLab MR, Obsidian 리포트를 tools/ai-publish/publish.py 로 실행합니다.
---

# AI publish (GitLab + Obsidian)

저장소 루트에서 아래를 실행하세요. `tools/ai-publish/.env`에 `GITLAB_TOKEN`, `GITLAB_PROJECT_ID`, `OBSIDIAN_VAULT` 등을 설정합니다.

```bash
python tools/ai-publish/publish.py --title "여기에 MR/리포트 제목" --summary "변경 요약"
```

현재 브랜치만 푸시하려면 `--use-current-branch`를 붙입니다. 연습은 `--dry-run`.

자세한 옵션은 `tools/ai-publish/README.md`를 참고하세요.
