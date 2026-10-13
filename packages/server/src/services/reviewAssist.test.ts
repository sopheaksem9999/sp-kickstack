// "Improve with AI" for review comments: context, prompt, the AI CLI call and its answer.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase, type AppDatabase } from '../db/index.js';
import { ProjectService } from './projectService.js';
import { RequirementService } from './requirementService.js';
import { SettingsService } from './settingsService.js';
import { ReviewService } from './reviewService.js';
import { FanOutService } from './fanOutService.js';
import { LinkService } from './linkService.js';
import { TicketService } from './ticketService.js';
import { WorkspaceService } from './workspaceService.js';
import { ManualAdapter } from '../adapters/manualAdapter.js';
import { ReviewAssistService, parseImprovedComment, runTextPrompt, type TextRunner } from './reviewAssist.js';
import { makeRepo, commitOnBranch, sh } from '../testing/gitFixture.js';
import { createApp } from '../api/app.js';
import { testRequest } from '../api/testHelper.js';
import { SseBroadcaster } from '../sse/broadcaster.js';
import { Notifier } from '../notify/notifier.js';

const HOOK = Array.from({ length: 30 }, (_, i) => `echo step-${i + 1}`).join('\n') + '\n';
const ANSWER = 'FILE: src/hooks.sh\nLINE: 6\n---\nThe post-commit hook fails when npx is missing.\n\nExpected: skip quietly.';

let ws: string;
let db: AppDatabase;
let repo: string;
let requirements: RequirementService;
let reqId: string;
let goalId: number;
let calls: Array<{ cli: string; prompt: string; model: string | null }>;
let answer: string | Error;

const run: TextRunner = async (cli, _bin, prompt, opts) => {
  calls.push({ cli, prompt, model: opts.model });
  if (answer instanceof Error) throw answer;
  return answer;
};
const installed = (name: string) => (name === 'claude' ? '/usr/bin/true' : null);
const assist = (find = installed) => new ReviewAssistService(db, requirements, { run, find });

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-review-assist-'));
  repo = makeRepo(path.join(ws, 'backend')).repo;
  db = initDatabase(':memory:');
  requirements = new RequirementService(db, ws);
  new ProjectService(db).registerProject({ name: 'backend', repo_path: repo, engine_type: 'manual', base_branch: 'develop' });
  reqId = requirements.createRequirement({
    title: 'Graft hooks', goal: 'Re-index the graph after every commit', acceptance_criteria: ['a'], affected_projects: ['backend'], priority: 'normal',
  }).id;
  commitOnBranch(repo, 'develop', 'README.md', '# repo\nmore\n');
  sh(repo, ['branch', reqId]);
  commitOnBranch(repo, reqId, 'src/hooks.sh', HOOK);
  goalId = Number(
    db
      .prepare("INSERT INTO bridge_tasks (req_id, project, role, title, status, branch, created_at, updated_at) VALUES (?, 'backend', 'goal', 'T', 'in_review', ?, 'x', 'x')")
      .run(reqId, reqId).lastInsertRowid
  );
  calls = [];
  answer = ANSWER;
});
afterEach(() => {
  db.close();
  fs.rmSync(ws, { recursive: true, force: true });
});

describe('Improve a review comment with AI', () => {
  it('sends the draft with the requirement, the branch, its changed files and the code around the line, and returns the rewrite', async () => {
    const result = await assist().improve(reqId, { task_id: goalId, body: 'hook breaks: npx: command not found', file_path: 'src/hooks.sh', line: 6 });

    expect(result).toEqual({
      body: 'The post-commit hook fails when npx is missing.\n\nExpected: skip quietly.',
      file_path: 'src/hooks.sh',
      line: 6,
      provider_used: 'Claude Code (sonnet)',
    });
    const [{ cli, prompt, model }] = calls;
    expect(cli).toBe('claude-cli');
    expect(model).toBe('sonnet');
    expect(prompt).toContain(`${reqId} — Graft hooks`);
    expect(prompt).toContain('Re-index the graph after every commit');
    expect(prompt).toContain(`backend · task branch \`${reqId}\`, merged into \`develop\``);
    expect(prompt).toContain('Changed on the branch: src/hooks.sh');
    expect(prompt).toContain('### src/hooks.sh (lines 1-26)');
    expect(prompt).toContain('   6 | echo step-6');
    expect(prompt).toContain('Reviewer points at: src/hooks.sh:6');
    expect(prompt).toContain('<untrusted_input name="reviewer_draft">\nhook breaks: npx: command not found\n</untrusted_input>');
  });

  it('reads files named in a pasted stack trace, absolute or relative, from the task branch', async () => {
    const body = `TypeError at ${repo}/src/hooks.sh:20\n    at lib/missing.ts:9`;
    await assist().improve(reqId, { task_id: goalId, body });
    const [{ prompt }] = calls;
    expect(prompt).toContain('### src/hooks.sh (lines 1-30)');
    expect(prompt).not.toContain('lib/missing.ts (lines');
  });

  it('reads a file pointed at with # (and :line) in the draft', async () => {
    await assist().improve(reqId, { task_id: goalId, body: '#src/hooks.sh:6 fails without npx' });
    expect(calls[0].prompt).toContain('### src/hooks.sh (lines 1-26)');
  });

  it("lists the files changed on a task's branch, for # in the comment box", () => {
    expect(assist().branchFiles(goalId)).toEqual({ branch: reqId, base: 'develop', files: ['src/hooks.sh'] });
    const loose = Number(
      db
        .prepare("INSERT INTO bridge_tasks (req_id, project, role, title, status, created_at, updated_at) VALUES (?, 'backend', 'ticket', 'T', 'queued', 'x', 'x')")
        .run(reqId).lastInsertRowid
    );
    expect(assist().branchFiles(loose)).toEqual({ branch: null, base: 'develop', files: [] });
    expect(() => assist().branchFiles(999999)).toThrow('Task #999999 not found');
  });

  it('puts the text of attached logs into the prompt, and names the other files', async () => {
    const b64 = (text: string) => Buffer.from(text).toString('base64');
    await assist().improve(reqId, {
      task_id: goalId,
      body: 'see the log',
      attachments: [
        { name: 'build.log', type: 'text/plain', data_url: `data:text/plain;base64,${b64('Error: npx not found')}` },
        { name: 'shot.png', type: 'image/png', data_url: `data:image/png;base64,${b64('PNG')}` },
      ],
    });
    const [{ prompt }] = calls;
    expect(prompt).toContain('<untrusted_input name="attachment build.log">\nError: npx not found\n</untrusted_input>');
    expect(prompt).toContain('Also attached (not shown): shot.png');
  });

  it('keeps the file and line the reviewer gave when the AI names none', async () => {
    answer = 'FILE: none\nLINE: none\n---\nClearer text';
    expect(await assist().improve(reqId, { task_id: goalId, body: 'x', file_path: 'src/hooks.sh', line: 3 })).toMatchObject({
      body: 'Clearer text', file_path: 'src/hooks.sh', line: 3,
    });
  });

  it('explains when no AI CLI can run', async () => {
    await expect(assist(() => null).improve(reqId, { task_id: goalId, body: 'x' })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Settings → AI & Local Engines'),
    });
    expect(calls).toEqual([]);
  });

  it('reports a failing CLI and an empty answer', async () => {
    answer = new Error('exit 1: quota exceeded');
    await expect(assist().improve(reqId, { task_id: goalId, body: 'x' })).rejects.toMatchObject({
      status: 502,
      message: 'Claude Code could not improve the comment: exit 1: quota exceeded',
    });
    answer = '   ';
    await expect(assist().improve(reqId, { task_id: goalId, body: 'x' })).rejects.toMatchObject({ status: 502, message: expect.stringContaining('empty') });
  });

  it("only takes the requirement's goals and tickets, and a non-empty draft", async () => {
    const other = requirements.createRequirement({ title: 'Other', goal: 'g', acceptance_criteria: ['a'], affected_projects: ['backend'], priority: 'normal' }).id;
    await expect(assist().improve(other, { task_id: goalId, body: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(assist().improve(reqId, { task_id: goalId, body: '  ' })).rejects.toThrow();
    await expect(assist().improve('REQ-404', { task_id: goalId, body: 'x' })).rejects.toMatchObject({ status: 404 });
  });

  it('answers POST /api/requirements/:id/comments/improve', async () => {
    const getAdapter = () => new ManualAdapter() as any;
    const projectService = new ProjectService(db);
    const linkService = new LinkService(db, projectService, getAdapter);
    const ticketService = new TicketService(db, projectService, linkService, getAdapter);
    const fanOutService = new FanOutService(db, projectService, requirements, getAdapter);
    const reviewService = new ReviewService(db, requirements, fanOutService, ticketService, getAdapter, undefined, assist());
    const app = createApp({
      db, workspaceService: new WorkspaceService(db), projectService, requirementService: requirements, fanOutService, linkService, ticketService,
      broadcaster: new SseBroadcaster(), notifier: new Notifier(), reviewService,
    });
    const ok = await testRequest(app, 'POST', `/api/requirements/${reqId}/comments/improve`, { body: { task_id: goalId, body: 'npx missing' } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ file_path: 'src/hooks.sh', line: 6, provider_used: 'Claude Code (sonnet)' });
    expect((await testRequest(app, 'POST', `/api/requirements/${reqId}/comments/improve`, { body: { task_id: goalId, body: '' } })).status).toBe(400);
    expect((await testRequest(app, 'GET', `/api/tasks/${goalId}/branch-files`)).body).toEqual({ branch: reqId, base: 'develop', files: ['src/hooks.sh'] });
    expect((await testRequest(app, 'GET', '/api/tasks/999999/branch-files')).status).toBe(404);
  });
});

describe('AI answer for a review comment', () => {
  it('reads FILE / LINE / --- and the comment; anything else is the comment', () => {
    expect(parseImprovedComment('Sure!\nFILE: `src/a.ts`\nLINE: 12\n---\nFix it\n')).toEqual({ body: 'Fix it', file_path: 'src/a.ts', line: 12 });
    expect(parseImprovedComment('Just text')).toEqual({ body: 'Just text', file_path: null, line: null });
  });

  it('drops a path outside the repository, and a line without a file', () => {
    expect(parseImprovedComment('FILE: ../etc/passwd\nLINE: 4\n---\nx')).toEqual({ body: 'x', file_path: null, line: null });
    expect(parseImprovedComment('FILE: none\nLINE: 4\n---\nx')).toEqual({ body: 'x', file_path: null, line: null });
  });

  it('cuts an answer longer than a comment may be', () => {
    expect(parseImprovedComment('a'.repeat(5000)).body).toHaveLength(4000);
  });
});

describe('AI CLI command for plain text', () => {
  const fake = (dir: string) => {
    const bin = path.join(dir, 'fake-cli.sh');
    fs.writeFileSync(bin, '#!/bin/sh\nprintf "ARGS:%s|" "$@"\nprintf "STDIN:"\ncat\n', { mode: 0o755 });
    return bin;
  };

  it('Claude Code gets the prompt on stdin, with tools turned off', async () => {
    const out = await runTextPrompt('claude-cli', fake(ws), 'hello prompt', { model: 'sonnet', effort: 'low', timeoutMs: 10_000 });
    expect(out).toBe('ARGS:-p|ARGS:--output-format|ARGS:text|ARGS:--tools|ARGS:|ARGS:--model|ARGS:sonnet|ARGS:--effort|ARGS:low|STDIN:hello prompt');
  });

  it('AGY gets the prompt as the value of -p', async () => {
    const out = await runTextPrompt('agy-cli', fake(ws), 'hello prompt', { model: null, effort: null, timeoutMs: 10_000 });
    expect(out).toBe('ARGS:-p|ARGS:hello prompt|ARGS:--output-format|ARGS:text|STDIN:');
  });
});
