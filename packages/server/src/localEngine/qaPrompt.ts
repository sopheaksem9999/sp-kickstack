// The prompt of an AI QA run: what to check in this repository, and how to report it with xticket.
import type { QaStage } from '@sp-kickstack/shared';
import { oneLine, wrapUntrusted } from '../lib/promptSafety.js';

export interface QaPromptInput {
  reqId: string;
  title: string;
  /** The requirement text (untrusted). */
  bodyMd: string;
  project: string;
  /** The commit checked out for QA. */
  commit: string;
  /** Where the requirement's changes start (the base before its merge), when known. */
  from: string | null;
  changedFiles: string[];
  commands: { test?: string | null; build?: string | null; lint?: string | null };
  maxFindings: number;
  /** 'review': the checkout is a merge preview (default 'qa': the merged code). */
  stage?: QaStage;
  /** Review rounds: the branch the preview merged into. */
  previewInto?: string | null;
}

/** Changed files listed at most; the rest are counted. */
const MAX_FILES_LISTED = 200;
const COMMAND_LABEL = { test: 'Test command', build: 'Build command', lint: 'Lint command' } as const;

/** The list items under the "## Acceptance criteria" heading ("- [ ] …", "* …", "1. …"). */
export function acceptanceCriteria(bodyMd: string): string[] {
  const lines = bodyMd.split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s*acceptance criteria\s*$/i.test(l.trim()));
  if (start < 0) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) break;
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line);
    if (item) items.push(item[1].trim());
  }
  return items;
}

export function buildQaPrompt(input: QaPromptInput): string {
  const criteria = acceptanceCriteria(input.bodyMd);
  const commit = input.commit.slice(0, 12);
  const what =
    input.stage === 'review'
      ? `a temporary merge of the requirement's branches into \`${input.previewInto ?? 'its base branch'}\`, not merged yet`
      : 'the code after the requirement was merged';
  const range = input.from ? `${input.from.slice(0, 12)}..${commit}` : null;
  const files = input.changedFiles.slice(0, MAX_FILES_LISTED);
  const more = input.changedFiles.length - files.length;
  const commands = (['test', 'build', 'lint'] as const)
    .filter((k) => input.commands[k]?.trim())
    .map((k) => `- ${COMMAND_LABEL[k]}: \`${input.commands[k]!.trim()}\``);

  return [
    `# AI QA of ${input.reqId} in ${input.project}`,
    '',
    `You are the QA reviewer of requirement ${input.reqId} ("${oneLine(input.title)}") in the repository **${input.project}**. ` +
      `Your working directory is a temporary checkout of commit \`${commit}\`: ${what}. ` +
      'Check it and report what you find. You do not fix anything.',
    '',
    '## The requirement',
    wrapUntrusted('requirement', input.bodyMd),
    '',
    '## Acceptance criteria',
    criteria.length
      ? criteria.map((c, i) => `${i + 1}. ${oneLine(c)}`).join('\n')
      : 'The requirement has no acceptance criteria section: judge the code against the requirement text above.',
    '',
    '## What changed in this repository',
    files.length
      ? [...files.map((f) => `- ${f}`), ...(more > 0 ? [`…and ${more} more (see git diff)`] : [])].join('\n')
      : 'No changed files were found for this requirement; look at the recent commits.',
    range ? `Inspect the changes with \`git log --oneline ${range}\` and \`git diff ${range}\`.` : 'Inspect recent history with `git log` and `git show`.',
    '',
    "## This repository's rules",
    'Read CLAUDE.md and AGENTS.md (when they exist) in the checkout, and judge the changes against them.',
    '',
    '## Checks, in this order',
    '1. For each acceptance criterion: is it met by the code? Report every gap.',
    '2. Review the changed files: bugs, missing error handling and edge cases, security problems, and breaches of the repository rules.',
    commands.length
      ? '3. Run these commands and report each failure with the key lines of its output. The checkout is fresh: install the dependencies first when a command needs them.\n' +
        commands.join('\n')
      : '3. No test, build or lint command is set for this repository: skip this step.',
    '',
    '## Rules',
    '- Do not commit, push, switch branches or edit files to fix anything. Anything you change in this checkout is thrown away.',
    `- One finding per problem; at most ${input.maxFindings} findings, the most important first.`,
    '- Severity: **blocker** (a criterion is not met, tests or the build fail, data loss, security), **major** (a real bug or a likely failure), **minor** (quality, naming, small gaps).',
    '- Do not ask a person questions: report what is unclear as a finding.',
    "- Report only real problems in this repository: never post a test finding (for example to check that xticket works), and do not report that something belongs to another repository (each repository has its own QA run). Use the qa-result summary for notes.",
    '',
    '## Reporting',
    'Report each finding as soon as you find it:',
    '```',
    'xticket comment --severity blocker|major|minor [--file <path> [--line <n>]] --title "<one line>" [--body "<details>" | --body-file <path>]',
    '```',
    '`--file` is relative to the repository root. Put the evidence in the body: what you checked, what happens, the key output lines.',
    '',
    'Finish with exactly one result:',
    '```',
    'xticket qa-result --passed --summary "<what you checked>"',
    'xticket qa-result --failed --summary "<the main problems>"',
    '```',
    'Use --failed when you reported any blocker or major finding.',
  ].join('\n');
}
