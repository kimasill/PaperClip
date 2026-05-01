#!/usr/bin/env python3
"""
Send 3 signed Linear-style Issue webhooks in a row to a Paperclip plugin webhook URL.

Requires: Python 3.10+ (stdlib only: hmac, hashlib, urllib, argparse).

Example:
  python test_webhook.py --base-url http://127.0.0.1:3100 --plugin-id <uuid> --secret "your-webhook-secret"
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
from uuid import uuid4


def sign_body(secret: str, raw: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()


def build_payload(seq: int) -> dict:
    now_ms = int(time.time() * 1000)
    issue_id = str(uuid4())
    return {
        "action": "create",
        "type": "Issue",
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        "url": f"https://linear.app/team/issue/TEST-{100 + seq}",
        "organizationId": str(uuid4()),
        "webhookTimestamp": now_ms,
        "webhookId": str(uuid4()),
        "data": {
            "id": issue_id,
            "identifier": f"TEST-{100 + seq}",
            "title": f"Queued test {seq}",
            "description": f"Body for queue test item {seq}",
            "state": {"name": "Todo"},
            "team": {"name": "Test Team", "key": "TEST"},
        },
    }


def main() -> None:
    p = argparse.ArgumentParser(description="POST 3 signed Linear webhooks to Paperclip")
    p.add_argument(
        "--base-url",
        required=True,
        help="Paperclip API base, e.g. https://x.trycloudflare.com or http://127.0.0.1:3100",
    )
    p.add_argument("--plugin-id", required=True, help="Plugin instance UUID (from /api/plugins)")
    p.add_argument("--secret", required=True, help="Linear webhook signing secret (same as Linear UI)")
    p.add_argument(
        "--path-template",
        default="/api/plugins/{plugin_id}/webhooks/linear",
        help="Path template with {plugin_id} placeholder",
    )
    args = p.parse_args()

    base = args.base_url.rstrip("/")
    path = args.path_template.format(plugin_id=args.plugin_id)
    url = f"{base}{path}"

    for i in range(1, 4):
        body_obj = build_payload(i)
        raw = json.dumps(body_obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        sig = sign_body(args.secret, raw)
        delivery = str(uuid4())

        req = urllib.request.Request(
            url,
            data=raw,
            method="POST",
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Linear-Signature": sig,
                "Linear-Event": "Issue",
                "Linear-Delivery": delivery,
                "User-Agent": "Linear-Webhook-Test/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                print(f"[{i}] HTTP {resp.status} delivery={delivery}")
        except urllib.error.HTTPError as e:
            print(f"[{i}] HTTP {e.code} {e.reason} delivery={delivery}")
            print(e.read().decode("utf-8", errors="replace")[:2000])

    print("Done. Check Paperclip activity log / agent runs for sequential handling.")


if __name__ == "__main__":
    main()
