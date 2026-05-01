#!/usr/bin/env python3
"""
로컬 Git 브랜치·커밋·푸시 후 GitLab MR 생성 및 Obsidian 리포트(md) 작성.

환경 변수는 tools/ai-publish/.env 에 두거나 OS 환경에 설정합니다.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import quote

try:
    import requests
except ImportError:
    print("Install dependencies: pip install -r requirements.txt", file=sys.stderr)
    raise

SCRIPT_DIR = Path(__file__).resolve().parent


def load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def run_git(args: list[str], cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    r = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if check and r.returncode != 0:
        msg = r.stderr.strip() or r.stdout.strip() or f"exit {r.returncode}"
        raise RuntimeError(f"git {' '.join(args)} failed: {msg}")
    return r


def git_out(args: list[str], cwd: Path) -> str:
    r = run_git(args, cwd, check=True)
    return (r.stdout or "").strip()


def branch_exists(name: str, cwd: Path) -> bool:
    r = run_git(["show-ref", "--verify", "--quiet", f"refs/heads/{name}"], cwd, check=False)
    return r.returncode == 0


def repo_root(start: Path) -> Path:
    p = git_out(["rev-parse", "--show-toplevel"], start)
    return Path(p)


def slugify(title: str, max_len: int = 48) -> str:
    s = title.lower().strip()
    s = re.sub(r"[^\w\s\-가-힣]", "", s, flags=re.UNICODE)
    s = re.sub(r"[\s_]+", "-", s).strip("-")
    if not s:
        s = "task"
    return s[:max_len].rstrip("-")


def parse_id_list(raw: str | None) -> list[int]:
    if not raw:
        return []
    out: list[int] = []
    for part in raw.replace(";", ",").split(","):
        part = part.strip()
        if part.isdigit():
            out.append(int(part))
    return out


def gitlab_headers(token: str) -> dict[str, str]:
    return {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
        "User-Agent": "paperclip-ai-publish/1.0",
    }


def gitlab_get(api_base: str, token: str, path: str) -> Any:
    url = f"{api_base.rstrip('/')}{path}"
    r = requests.get(url, headers=gitlab_headers(token), timeout=60)
    r.raise_for_status()
    return r.json()


def gitlab_post(api_base: str, token: str, path: str, body: dict[str, Any]) -> dict[str, Any]:
    url = f"{api_base.rstrip('/')}{path}"
    r = requests.post(url, headers=gitlab_headers(token), json=body, timeout=60)
    if not r.ok:
        raise RuntimeError(f"GitLab API {r.status_code}: {r.text[:800]}")
    return r.json()


def resolve_username_to_id(api_base: str, token: str, username: str) -> int | None:
    try:
        users = gitlab_get(api_base, token, f"/users?username={quote(username, safe='')}")
    except requests.RequestException:
        return None
    if isinstance(users, list) and users:
        uid = users[0].get("id")
        return int(uid) if uid is not None else None
    return None


def detect_default_branch(root: Path) -> str:
    try:
        sym = git_out(["symbolic-ref", "refs/remotes/origin/HEAD"], root)
        # refs/remotes/origin/main -> main
        return sym.split("/")[-1]
    except RuntimeError:
        pass
    for name in ("main", "master", "develop"):
        rc = run_git(["rev-parse", "--verify", f"origin/{name}"], root, check=False).returncode
        if rc == 0:
            return name
    return "main"


def render_template(
    template: str,
    mapping: dict[str, str],
) -> str:
    out = template
    for k, v in mapping.items():
        out = out.replace("{{" + k + "}}", v)
    return out


def main() -> int:
    load_env_file(SCRIPT_DIR / ".env")

    p = argparse.ArgumentParser(description="Git push + GitLab MR + Obsidian AI report")
    p.add_argument("--title", required=True, help="MR 제목 및 리포트 제목")
    p.add_argument("--slug", default=None, help="브랜치/파일용 슬러그 (기본: title에서 생성)")
    p.add_argument("--summary", default="", help="리포트 요약 본문")
    p.add_argument("--errors-fixed", default="", dest="errors_fixed", help="해결한 오류·메모 (마크다운 가능)")
    p.add_argument("--commit-message", default=None, help="커밋 메시지 (기본: title)")
    p.add_argument("--cwd", default=".", help="저장소 루트 (기본: 현재 디렉터리)")
    p.add_argument("--use-current-branch", action="store_true", help="새 브랜치를 만들지 않고 현재 브랜치에 푸시")
    p.add_argument("--dry-run", action="store_true", help="실제 git/API/파일 쓰기 없이 계획만 출력")
    p.add_argument("--skip-mr", action="store_true", help="Git 푸시만 하고 MR 생성 생략")
    p.add_argument("--skip-obsidian", action="store_true", help="Obsidian 파일 생성 생략")
    p.add_argument(
        "--snippet-bytes",
        type=int,
        default=8000,
        help="리포트에 넣을 git diff 최대 바이트 (기본 8000)",
    )
    args = p.parse_args()

    root = repo_root(Path(args.cwd).resolve())
    short_sha = git_out(["rev-parse", "--short", "HEAD"], root)
    slug = args.slug or slugify(args.title)
    branch = git_out(["branch", "--show-current"], root)

    target_branch = os.environ.get("TARGET_BRANCH") or detect_default_branch(root)

    if args.use_current_branch:
        new_branch = branch
    else:
        new_branch = f"feat/ai-{slug}-{short_sha}"
        if not args.dry_run:
            if branch_exists(new_branch, root):
                run_git(["checkout", new_branch], root)
            else:
                run_git(["checkout", "-b", new_branch], root)
        else:
            print(f"[dry-run] git checkout -b {new_branch} (또는 이미 있으면 checkout)")

    status = git_out(["status", "--porcelain"], root)
    has_changes = len(status.strip()) > 0

    commit_msg = args.commit_message or args.title
    if has_changes and not args.dry_run:
        run_git(["add", "-A"], root)
        run_git(["commit", "-m", commit_msg], root)
    elif has_changes and args.dry_run:
        print(f"[dry-run] git add -A && git commit -m {commit_msg!r}")

    if not args.dry_run:
        run_git(["push", "-u", "origin", new_branch], root)
    else:
        print(f"[dry-run] git push -u origin {new_branch}")

    diff_stat = ""
    diff_snippet = ""
    if not args.dry_run:
        try:
            diff_stat = git_out(["diff", "--stat", f"origin/{target_branch}...HEAD"], root)
        except RuntimeError:
            diff_stat = git_out(["diff", "--stat", "HEAD~1..HEAD"], root)
        try:
            diff_full = run_git(
                ["diff", f"origin/{target_branch}...HEAD"],
                root,
                check=False,
            ).stdout
            if not (diff_full or "").strip():
                diff_full = run_git(["diff", "HEAD~1..HEAD"], root, check=False).stdout
        except RuntimeError:
            diff_full = ""
        raw = (diff_full or "")[: max(0, args.snippet_bytes)]
        diff_snippet = f"```diff\n{raw}\n```" if raw.strip() else "(변경 diff 없음 또는 범위 없음)"
    else:
        diff_stat = "(dry-run)"
        diff_snippet = "(dry-run)"

    mr_url: str | None = None
    if not args.skip_mr and not args.dry_run:
        token = os.environ.get("GITLAB_TOKEN", "").strip()
        project_id = os.environ.get("GITLAB_PROJECT_ID", "").strip()
        api_base = os.environ.get("GITLAB_API_URL", "https://gitlab.com/api/v4").strip()
        if not token or not project_id:
            print("Skip MR: set GITLAB_TOKEN and GITLAB_PROJECT_ID", file=sys.stderr)
        else:
            reviewer_ids = parse_id_list(os.environ.get("GITLAB_REVIEWER_IDS"))
            for u in os.environ.get("GITLAB_REVIEWER_USERNAMES", "").split(","):
                u = u.strip()
                if not u:
                    continue
                rid = resolve_username_to_id(api_base, token, u)
                if rid is not None:
                    reviewer_ids.append(rid)
            assignee_ids = parse_id_list(os.environ.get("GITLAB_ASSIGNEE_IDS"))

            body: dict[str, Any] = {
                "title": args.title,
                "source_branch": new_branch,
                "target_branch": target_branch,
                "remove_source_branch": False,
            }
            desc_parts = [args.summary.strip()] if args.summary.strip() else []
            desc_parts.append(f"Automated MR from tools/ai-publish (commit {short_sha}).")
            body["description"] = "\n\n".join(desc_parts)
            if assignee_ids:
                body["assignee_ids"] = assignee_ids
            if reviewer_ids:
                body["reviewer_ids"] = sorted(set(reviewer_ids))

            enc = requests.utils.quote(project_id, safe="")
            data = gitlab_post(api_base, token, f"/projects/{enc}/merge_requests", body)
            mr_url = data.get("web_url") or ""

    elif args.skip_mr:
        print("MR skipped (--skip-mr)")
    elif args.dry_run:
        print("[dry-run] GitLab MR would be created here")

    report_path: Path | None = None
    if not args.skip_obsidian and not args.dry_run:
        vault = os.environ.get("OBSIDIAN_VAULT", "").strip()
        sub = os.environ.get("OBSIDIAN_REPORTS_DIR", "AI_Reports").strip() or "AI_Reports"
        if not vault:
            print("Skip Obsidian: OBSIDIAN_VAULT not set", file=sys.stderr)
        else:
            today = date.today().isoformat()
            safe_file = f"{today}_{slug}.md"
            report_dir = Path(vault) / sub
            report_dir.mkdir(parents=True, exist_ok=True)
            report_path = report_dir / safe_file

            tpl_path = SCRIPT_DIR / "templates" / "ai_report.md"
            template = tpl_path.read_text(encoding="utf-8")
            project_slug = root.name
            mapping = {
                "DATE_ISO": today,
                "TITLE": args.title,
                "SUMMARY": args.summary.strip() or "(요약 없음)",
                "MR_URL": mr_url or "(MR 없음 또는 스킵)",
                "DIFF_STAT": f"```\n{diff_stat}\n```" if diff_stat else "",
                "SNIPPETS": diff_snippet,
                "ERRORS_FIXED": (args.errors_fixed.strip() or "(없음)"),
                "PROJECT_SLUG": project_slug,
            }
            content = render_template(template, mapping)
            report_path.write_text(content, encoding="utf-8")
            print(f"Obsidian report: {report_path}")
    elif args.skip_obsidian:
        print("Obsidian skipped (--skip-obsidian)")
    else:
        print("[dry-run] Obsidian file would be written")

    print("branch:", new_branch)
    if mr_url:
        print("mr:", mr_url)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        raise SystemExit(1)
