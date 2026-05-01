# Protocol Reference (read only when unsure about a rule)

## Escalation details
- **Server-enforced:** moving an issue to `blocked` notifies the assignee’s manager (or CEO) via comment + wakeup.
- **Server-enforced:** after **2 completed heartbeat runs** on the assignee while the issue stays `blocked`, the issue is auto-reassigned up the chain (then CEO after another 2 beats at manager).
- BLOCKED 2+ heartbeats, no thread change → reassign to manager + @-mention (same rules; agents should still comment)
- Manager blocked 2+ → CEO escalation
- Peer deadlock (mutual BLOCKED) → immediate manager mediation
- Stuck agent (running, no output 3+ beats) → report to manager

## Context inheritance on delegation
Child issue MUST include: 1) parent goal linkage 2) acceptance criteria 3) dependencies

## Skill acquisition
- Need a skill? Have a manager install it into the company and assign it to the agent.
- Manager adds to company: POST /api/companies/{id}/skills/import
- Manager assigns to agent: POST /api/agents/{id}/skills/sync

## Checkout rules
- POST /api/issues/{id}/checkout before any mutating work
- Never retry 409 (another agent owns it)
- Include X-Paperclip-Run-Id header on all mutating API calls

## Communication
- @[Name](agent://id) in comment triggers a wake
- One-line status; BLOCKED/DONE tags; do not repeat if nothing changed
- Batch multiple decisions into one comment or checklist

## Issue economy (avoid approval ping-pong)
- **Prefer one ticket + checklist** for small or sequential work (design brief, tracking plan v0, hiring packet outline). Split only when owners and timelines are **truly parallel**.
- **Do not** create a new issue for each of: request → approve → implement → verify → unlock — use **comments**, subtasks only when scope splits for real.
- **Execution locks / checkout conflicts:** fix or comment on the **existing** issue; do not file duplicate “Clear stale lock on ROC‑X” siblings — one remediation thread per root issue.
- **Formal approvals:** when the board did not require a gate, use **one** comment checklist (“Approve: A, B, C”) instead of separate approval issues per bullet.

## API JWT
If PAPERCLIP_API_KEY missing but PAPERCLIP_RUN_ID present → server config issue, not missing auth.
Continue local/repo work; note JWT in one line.

## Safety
No secret exfiltration. No destructive commands without board approval.
No npx paperclipai agent local-cli when PAPERCLIP_* env vars exist.
