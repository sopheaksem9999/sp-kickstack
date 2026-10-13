export interface RunPromptInput {
  /** The task's own prompt (branch rules, xticket instructions, wrapped requirement). */
  bodyMd: string;
  worktree: string;
  branch: string;
  /** Notes and answers not yet delivered. */
  notesMd: string;
  /** The run continues earlier work (after a question, a usage limit or a restart). */
  continuation: boolean;
}

/** The prompt for one run: the task's prompt plus how this unattended local run works. */
export function buildRunPrompt(input: RunPromptInput): string {
  const parts = [
    input.bodyMd.trimEnd(),
    `## Local run
- You run unattended in \`${input.worktree}\`, a separate copy of the repository on branch \`${input.branch}\`. Nobody reads your messages until you finish, so do not wait for confirmation.
- Stay inside this folder: do not read or change files outside it.
- Commit your work on \`${input.branch}\` (git add, git commit) before you finish. Uncommitted changes are not reviewed.
- Never push, never switch or create branches, and never rewrite commits already on the branch.
- For a product decision only a person can make, use \`xticket ask\` as described above, commit your work in progress, then stop.`,
  ];
  if (input.continuation) {
    parts.push(`## Continue
This task was started before and stopped (a question, a usage limit or a server restart). Run \`git log\` and \`git status\` first, then continue from the work already on \`${input.branch}\`.`);
  }
  if (input.notesMd.trim()) parts.push(`## Notes since your last run\n${input.notesMd.trim()}`);
  return `${parts.join('\n\n')}\n`;
}
