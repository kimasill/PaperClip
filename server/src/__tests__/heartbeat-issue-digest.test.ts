import { describe, expect, it } from "vitest";
import { heartbeatIssueDigestFromContext } from "@paperclipai/adapter-utils";
import {
  buildPaperclipHeartbeatIssueDigest,
  HEARTBEAT_ISSUE_DIGEST_MAX_DESCRIPTION_CHARS,
} from "../services/heartbeat-issue-digest.js";

describe("buildPaperclipHeartbeatIssueDigest", () => {
  it("returns empty string when there is no issue or wake context", () => {
    expect(
      buildPaperclipHeartbeatIssueDigest({
        runId: "run-1",
        invocationSource: "timer",
        triggerDetail: null,
        wakeReason: null,
        taskId: null,
        issueId: null,
        wakeCommentId: null,
        issue: null,
        triggerCommentBody: null,
      }),
    ).toBe("");
  });

  it("includes run metadata, issue fields, and wake reason", () => {
    const digest = buildPaperclipHeartbeatIssueDigest({
      runId: "run-abc",
      invocationSource: "assignment",
      triggerDetail: "system",
      wakeReason: "issue_assigned",
      taskId: "task-1",
      issueId: "issue-1",
      wakeCommentId: null,
      issue: {
        identifier: "ENG-42",
        title: "Fix the thing",
        description: "Do the work described here.",
      },
      triggerCommentBody: null,
    });
    expect(digest).toContain("run-abc");
    expect(digest).toContain("assignment");
    expect(digest).toContain("system");
    expect(digest).toContain("issue_assigned");
    expect(digest).toContain("ENG-42");
    expect(digest).toContain("Fix the thing");
    expect(digest).toContain("Do the work described here.");
    expect(digest).toContain("Paperclip heartbeat");
  });

  it("truncates long descriptions", () => {
    const longDesc = "x".repeat(HEARTBEAT_ISSUE_DIGEST_MAX_DESCRIPTION_CHARS + 50);
    const digest = buildPaperclipHeartbeatIssueDigest({
      runId: "r1",
      invocationSource: "x",
      triggerDetail: null,
      wakeReason: "issue_assigned",
      taskId: null,
      issueId: "i1",
      wakeCommentId: null,
      issue: {
        identifier: null,
        title: "T",
        description: longDesc,
      },
      triggerCommentBody: null,
    });
    expect(digest.length).toBeLessThan(longDesc.length + 500);
    expect(digest).toContain("…[truncated]");
  });

  it("includes trigger comment body when present", () => {
    const digest = buildPaperclipHeartbeatIssueDigest({
      runId: "r1",
      invocationSource: "automation",
      triggerDetail: null,
      wakeReason: "issue_comment_mentioned",
      taskId: "i1",
      issueId: "i1",
      wakeCommentId: "c1",
      issue: {
        identifier: "X-1",
        title: "Title",
        description: "Body",
      },
      triggerCommentBody: "@agent please review this PR",
    });
    expect(digest).toContain("Trigger comment");
    expect(digest).toContain("@agent please review this PR");
    expect(digest).toContain("c1");
  });
});

describe("heartbeatIssueDigestFromContext", () => {
  it("returns trimmed digest from context", () => {
    expect(heartbeatIssueDigestFromContext({ paperclipHeartbeatIssueDigest: "  hello  " })).toBe("hello");
  });

  it("returns empty when missing or not a string", () => {
    expect(heartbeatIssueDigestFromContext({})).toBe("");
    expect(heartbeatIssueDigestFromContext({ paperclipHeartbeatIssueDigest: 1 as unknown as string })).toBe("");
    expect(heartbeatIssueDigestFromContext(null)).toBe("");
  });
});
