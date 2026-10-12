# Agent model and effort per requirement and task — design

Status: approved by the user ("can implement"), 2026-10-12. Builds on feat/human-loop (Retry, Request changes).

## Problem

Agents run with whatever model and effort their engine is configured with. A hard task cannot get a
stronger model, and an easy one cannot use a cheaper one. Model/effort pickers exist only for the AI chat
that drafts requirements. Separately, the MCP tool `sp_list_projects` lists every workspace's projects and
`sp_create_requirement` always creates in the `default` workspace, against the rule that engines and AI
tools stay inside one workspace.

## Design

- **Where the choice lives** (each optional; null = "inherit", and at the end "the engine decides"):
  1. workspace default — `workspaces.agent_model`, `agent_effort` (edited in the workspace rules dialog);
  2. requirement — `requirements.agent_model`, `agent_effort` (edited on the requirement page, any time;
     applies to runs started after the change);
  3. task pin — `bridge_tasks.model_override`, `effort_override`, set when a person picks a model/effort on
     **Retry** or **Request changes**; kept for later automatic re-dispatches of that task.
  Model and effort resolve independently: task pin → requirement → workspace → none.
- **Effort** values: the existing `low | medium | high | xhigh | max`. **Model**: free text id the engine
  understands (`opus`, `sonnet`, `claude-opus-5-5`, …), validated as `[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}`;
  the UI suggests `opus`, `sonnet`, `haiku`, `fable`.
- **Dispatch**: goal and ticket creation send `model` / `effort` in the engine create body when set
  (Stoneforge receives the create input as JSON; whether it honours them is unconfirmed — the manual
  adapter ignores them). The values actually sent are recorded on the task (`bridge_tasks.model`,
  `effort`) and shown on the task card ("opus · high"), so every run says what it used.
- **Retry / Request changes**: both accept an optional `{ model, effort }` (undefined = keep the task's
  pin, null = clear it, value = pin it). The pin is part of the claim and is restored if the old engine
  task cannot be stopped.
- **MCP**: `sp_list_projects` and `sp_create_requirement` take `workspace_id` (default `default`) and only
  see that workspace.
- Non-goals: choosing a different engine per requirement (engines stay per repository), automatic
  escalation to a stronger model.
