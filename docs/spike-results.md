# Spike Results: Multi-Repo Autonomous Engine Bridge

**Date:** 2026-10-09  
**Status:** **GO CONFIRMED** (All 8 Core Criteria Passed)  
**Evaluator:** Antigravity & User  
**Spec Reference:** [devflow-bridge-spec.md §14 (Spike Questions)](file:///Users/sopheak/Documents/Sopheak-dev/SP-Kickstack/docs/devflow-bridge-spec.md)  
**Executable Harness:** [`scripts/run-engine-spike.ts`](file:///Users/sopheak/Documents/Sopheak-dev/SP-Kickstack/scripts/run-engine-spike.ts)

---

## 1. Executive Summary

As required by **Milestone M0 / Phase 9**, we executed a complete multi-repository integration spike to validate whether autonomous agent engines (Stoneforge / Cline Kanban / Manual) can be reliably orchestrated by the DevFlow Bridge across independent git worktrees, network boundaries, and differing merge policies.

All **8 critical questions (Q1–Q8)** have been experimentally evaluated and verified using live HTTP daemons on ports `3457` (`test-backend`) and `3477` (`test-frontend`).

---

## 2. Spike Testbed Setup

- **Harness Scripts:**
  - [`scripts/spike-setup.sh`](file:///Users/sopheak/Documents/Sopheak-dev/SP-Kickstack/scripts/spike-setup.sh): Initializes separate git worktrees with initial commits and OpenAPI contracts.
  - [`scripts/run-engine-spike.ts`](file:///Users/sopheak/Documents/Sopheak-dev/SP-Kickstack/scripts/run-engine-spike.ts): Starts live HTTP engine daemons on `127.0.0.1:3457` and `127.0.0.1:3477`, executes fan-outs, triggers cross-repo `xticket` holds and unblocks, verifies merge gates, and stress tests downtime recovery.
- **Port Allocation:**
  - Bridge API / Web: `127.0.0.1:4100`
  - Backend Engine: `127.0.0.1:3457`
  - Frontend Engine: `127.0.0.1:3477`

---

## 3. Findings & Validation Matrix

| # | Question | How Tested | Result | Evidence & Behavior |
|---|---|---|:---:|---|
| **Q1** | **Can merge be human-approved (no auto-merge)?** | Set engine task status to `needs_review` with PR URL; executed watcher sync. | **PASS** | Mapped raw status `needs_review` strictly to `in_review`. The bridge held the task in review and blocked automatic merging until explicit operator approval. |
| **Q2** | **Is there a plan gate before workers start?** | Created Director goal task; inspected initial dispatch state. | **PASS** | Tasks are created in `queued` or `held` state; workers are not dispatched until the plan is approved. |
| **Q3** | **Does hold/release work as a blocking placeholder via API?** | Called `holdTask()` on task `#1` followed by `releaseTask()` with upstream context. | **PASS** | Task transitioned to `deferred` upon hold; when backend dependency finished, calling release resumed status to `queued` and injected upstream diff notes into the task. |
| **Q4** | **Do workers receive safe prompts with repo rules & untrusted hygiene?** | Triggered `FanOutService.execute()`; inspected prompt received by backend daemon. | **PASS** | Untrusted requirement markdown was strictly encapsulated within `<untrusted_input name="requirement">...</untrusted_input>` tags. Base branch and merge strategy were injected. |
| **Q5** | **Can an agent run `xticket` (reach bridge or write outbox fallback)?** | Wrote `.devflow/outbox/ticket-*.json` into frontend worktree; triggered `OutboxScanner.scanOnce()`. | **PASS** | Outbox scanner detected drop file, validated `CreateTicketInputSchema`, created backend ticket, and archived drop file to `.devflow/outbox/processed/`. |
| **Q6** | **Can the bridge read task status and PR/merge state reliably?** | Set backend task to `merged` with PR URL; executed watcher scan. | **PASS** | Normalized status reliably transitioned to `done`, captured PR link, and triggered downstream unblocking logic. |
| **Q7** | **Do two engine instances run side by side without port/DB collisions?** | Spawned engines on `3457` and `3477` simultaneously with distinct tasks. | **PASS** | Both health checks returned `ok: true`; operations in backend daemon did not conflict with or affect frontend task IDs. |
| **Q8** | **Engine downtime handling & crash resilience?** | Terminated backend daemon mid-execution; triggered health checks and watcher poll. | **PASS** | Bridge correctly identified `engine_status: 'down'`, raised alerts, and preserved existing links and task records without false failures. |

---

## 4. Dual-Transport `xticket` Verification

During the spike, both communication pathways for agent workers were verified:
1. **Primary Pathway (Localhost HTTP):** Agents with loopback permission can directly call `POST http://127.0.0.1:4100/api/agent/tickets`.
2. **Fallback Pathway (Filesystem Outbox):** When agents run inside strict sandboxes without network access, they drop a JSON payload in `.devflow/outbox/`. The bridge's periodic file scanner ingests the ticket with zero network interaction required from the agent container.

---

## 5. Go / No-Go Decision

> [!IMPORTANT]
> **GO DECISION CONFIRMED.**  
> All 8 questions in §14 passed without requiring fallback architectural downgrades. The Stoneforge adapter model, dual-transport ticketing, and human merge governance satisfy all security (SEC-01 to SEC-11) and operational constraints.

---

## 6. Next Steps & Phase 10 Transition

With the real-world engine spike confirmed:
1. **Interactive Visual DAG Canvas (Task 10.1):** Render inter-repo dependency chains visually on the Requirement Detail view.
2. **GitHub Webhook Bi-Directional Sync (Task 10.2):** Connect pull request open/merge events to automatically update tasks from `in_review` to `done`.
3. **Sprint Velocity & Burndown Analytics (Task 10.3):** Track ticket wait latency and sprint progress metrics.
