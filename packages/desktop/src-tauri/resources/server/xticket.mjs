#!/usr/bin/env node

// ../xticket/src/cli.ts
import fs4 from "node:fs";
import { parseArgs as parseArgs3 } from "node:util";

// ../xticket/src/submit.ts
import fs from "node:fs";
import path from "node:path";
function outboxKind(payload) {
  const kind = payload.kind;
  return kind === "question" || kind === "qa-comment" || kind === "qa-result" ? kind : "ticket";
}
function queueInOutbox(payload, outboxDir, reason) {
  const kind = outboxKind(payload);
  try {
    fs.mkdirSync(outboxDir, { recursive: true });
    const file = path.join(outboxDir, `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
    const result = kind === "question" ? {
      questionId: 0,
      status: "queued_outbox",
      reason,
      message: "The bridge files your question as soon as it can. Stop working now; the answer arrives as a note when your task resumes."
    } : kind === "ticket" ? { ticketId: 0, target: payload.to, blocking: Boolean(payload.blocking), status: "queued_outbox", reason } : { status: "queued_outbox", reason, message: "The bridge saves it as soon as it can; carry on with the QA run." };
    return { exitCode: 0, stdout: JSON.stringify(result) };
  } catch (fsErr) {
    return { exitCode: 4, stderr: `${reason} and outbox failed: ${fsErr.message}` };
  }
}
function resolveOutboxDir(env = process.env, cwd = process.cwd()) {
  return env.XTICKET_OUTBOX ? path.resolve(cwd, env.XTICKET_OUTBOX) : path.resolve(cwd, ".devflow", "outbox");
}
async function submitTicket(payload, opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const kind = outboxKind(payload);
  const noun = kind === "qa-comment" ? "finding" : kind === "qa-result" ? "QA result" : kind;
  let res;
  try {
    res = await fetchImpl(`${opts.bridgeUrl}${opts.endpoint ?? "/api/agent/tickets"}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...opts.token ? { Authorization: `Bearer ${opts.token}` } : {}
      },
      body: JSON.stringify(payload)
    });
  } catch (netErr) {
    return queueInOutbox(payload, opts.outboxDir, `Bridge unreachable (${netErr.message})`);
  }
  if (res.ok) {
    return { exitCode: 0, stdout: JSON.stringify(await res.json()) };
  }
  const err = await res.json().catch(() => ({}));
  const reason = err.error || res.statusText || `HTTP ${res.status}`;
  if (res.status === 400) return { exitCode: 2, stderr: `Validation error: ${reason}` };
  if (res.status === 429) return { exitCode: 3, stderr: `Limit hit: ${reason}` };
  if (res.status === 401 || res.status === 403) {
    return { exitCode: 5, stderr: `Unauthorized (${res.status}): ${reason}. Set XTICKET_TOKEN to the bridge's AGENT_TOKEN.` };
  }
  if (res.status >= 500) {
    return queueInOutbox(payload, opts.outboxDir, `Bridge error ${res.status}: ${reason}`);
  }
  return { exitCode: 1, stderr: `Bridge rejected the ${noun} (${res.status}): ${reason}` };
}

// ../xticket/src/ask.ts
import fs2 from "node:fs";
import { parseArgs } from "node:util";
function parseAskArgs(argv, env) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        question: { type: "string" },
        option: { type: "string", multiple: true },
        body: { type: "string" },
        "body-file": { type: "string" }
      }
    }));
  } catch (err) {
    return { error: err.message };
  }
  const question = (values.question || "").trim();
  if (question.length < 3) return { error: "--question is required (at least 3 characters)" };
  const options = (values.option || []).map((o) => o.trim()).filter(Boolean);
  if (options.length > 6) return { error: "At most 6 --option values" };
  let body = values.body || "";
  if (values["body-file"]) {
    try {
      body = fs2.readFileSync(values["body-file"], "utf-8");
    } catch (err) {
      return { error: `Error reading --body-file: ${err.message}` };
    }
  }
  return {
    payload: { kind: "question", question, options, body, project: env.XTICKET_PROJECT || "unknown", engineTaskId: env.XTICKET_TASK }
  };
}

// ../xticket/src/qa.ts
import fs3 from "node:fs";
import { parseArgs as parseArgs2 } from "node:util";
var SEVERITIES = ["blocker", "major", "minor"];
function identity(env) {
  return { project: env.XTICKET_PROJECT || "unknown", engineTaskId: env.XTICKET_TASK };
}
function parseCommentArgs(argv, env) {
  let values;
  try {
    ({ values } = parseArgs2({
      args: argv,
      options: {
        severity: { type: "string" },
        file: { type: "string" },
        line: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        "body-file": { type: "string" }
      }
    }));
  } catch (err) {
    return { error: err.message };
  }
  const severity = (values.severity || "").trim();
  if (!SEVERITIES.includes(severity)) return { error: "--severity must be blocker, major or minor" };
  const title = (values.title || "").trim();
  if (title.length < 3) return { error: "--title is required (one line, at least 3 characters)" };
  if (/[\r\n]/.test(title)) return { error: "--title must be one line; put details in --body" };
  const file = (values.file || "").trim();
  let line;
  if (values.line !== void 0) {
    if (!file) return { error: "--line needs --file" };
    line = Number(values.line);
    if (!Number.isInteger(line) || line < 1) return { error: "--line must be a whole number from 1" };
  }
  let body = values.body || "";
  if (values["body-file"]) {
    try {
      body = fs3.readFileSync(values["body-file"], "utf-8");
    } catch (err) {
      return { error: `Error reading --body-file: ${err.message}` };
    }
  }
  return {
    payload: {
      kind: "qa-comment",
      severity,
      title,
      body,
      ...file ? { file_path: file } : {},
      ...line ? { line } : {},
      ...identity(env)
    }
  };
}
function parseQaResultArgs(argv, env) {
  let values;
  try {
    ({ values } = parseArgs2({
      args: argv,
      options: { passed: { type: "boolean" }, failed: { type: "boolean" }, summary: { type: "string" } }
    }));
  } catch (err) {
    return { error: err.message };
  }
  if (Boolean(values.passed) === Boolean(values.failed)) return { error: "Give exactly one of --passed or --failed" };
  const summary = (values.summary || "").trim();
  if (!summary) return { error: "--summary is required" };
  return { payload: { kind: "qa-result", passed: Boolean(values.passed), summary, ...identity(env) } };
}

// ../xticket/src/cli.ts
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    console.log(`
Usage: xticket <command> [options]

Commands:
  create     Create a cross-repo ticket
  status     Check status of a ticket
  list       List tickets
  ask        Ask a person a question; your task pauses until they answer
  comment    AI QA: report one finding (an open review comment marked AI QA)
  qa-result  AI QA: report the QA run's verdict

Options for create:
  --to <project>           Target project name
  --type <type>            api_request | bug | question (default: api_request)
  --title <title>          Ticket title
  --body <text>            Ticket body description
  --body-file <file>       Path to markdown file containing body
  --blocking               Block the calling task until this ticket is resolved

Options for ask:
  --question <text>        The question (required)
  --option <label>         A choice the person can pick (repeat, up to 6)
  --body <text>            Context that helps the person decide
  --body-file <file>       Path to a markdown file with that context

Options for comment (AI QA runs only):
  --severity <level>       blocker | major | minor (required)
  --title <text>           One line (required)
  --file <path>            File the finding is about, relative to the repository root
  --line <n>               Line in --file
  --body <text>            Details: what you checked, what happens, key output lines
  --body-file <file>       Path to a markdown file with the details

Options for qa-result (AI QA runs only):
  --passed | --failed      The verdict (exactly one)
  --summary <text>         What you checked, or the main problems (required)
`);
    process.exit(0);
  }
  const bridgeUrl = process.env.XTICKET_URL || "http://127.0.0.1:4100";
  const token = process.env.XTICKET_TOKEN;
  const outboxDir = resolveOutboxDir();
  if (command === "ask") {
    const parsed = parseAskArgs(args.slice(1), process.env);
    if ("error" in parsed) {
      console.error(`Error: ${parsed.error}`);
      process.exit(2);
    }
    const result2 = await submitTicket(parsed.payload, { bridgeUrl, token, outboxDir, endpoint: "/api/agent/questions" });
    if (result2.stdout) console.log(result2.stdout);
    if (result2.stderr) console.error(result2.stderr);
    process.exit(result2.exitCode);
  }
  const QA_COMMANDS = /* @__PURE__ */ new Map([
    ["comment", { parse: parseCommentArgs, endpoint: "/api/agent/qa/comments" }],
    ["qa-result", { parse: parseQaResultArgs, endpoint: "/api/agent/qa/result" }]
  ]);
  const report = QA_COMMANDS.get(command);
  if (report) {
    const parsed = report.parse(args.slice(1), process.env);
    if ("error" in parsed) {
      console.error(`Error: ${parsed.error}`);
      process.exit(2);
    }
    const result2 = await submitTicket(parsed.payload, { bridgeUrl, token, outboxDir, endpoint: report.endpoint });
    if (result2.stdout) console.log(result2.stdout);
    if (result2.stderr) console.error(result2.stderr);
    process.exit(result2.exitCode);
  }
  if (command !== "create") {
    console.error(`Unsupported command: ${command}`);
    process.exit(2);
  }
  const { values } = parseArgs3({
    args: args.slice(1),
    options: {
      to: { type: "string" },
      type: { type: "string", default: "api_request" },
      title: { type: "string" },
      body: { type: "string" },
      "body-file": { type: "string" },
      blocking: { type: "boolean", default: false }
    }
  });
  if (!values.to || !values.title) {
    console.error("Error: --to and --title are required");
    process.exit(2);
  }
  let bodyContent = values.body || "";
  if (values["body-file"]) {
    try {
      bodyContent = fs4.readFileSync(values["body-file"], "utf-8");
    } catch (err) {
      console.error(`Error reading --body-file: ${err.message}`);
      process.exit(2);
    }
  }
  if (!bodyContent) {
    console.error("Error: either --body or --body-file must provide content");
    process.exit(2);
  }
  const project = process.env.XTICKET_PROJECT || "unknown";
  const engineTaskId = process.env.XTICKET_TASK;
  const payload = {
    to: values.to,
    type: values.type,
    title: values.title,
    body: bodyContent,
    blocking: Boolean(values.blocking),
    project,
    engineTaskId
  };
  const result = await submitTicket(payload, {
    bridgeUrl,
    token,
    outboxDir
  });
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exit(result.exitCode);
}
main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
