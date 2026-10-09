// Helpers for placing untrusted text (requirements, tickets, agent summaries) into engine prompts.

const TAG = /<(\/?)untrusted_input/gi;

/** Neutralize anything that looks like an untrusted_input tag so text cannot open or close a block. */
function neutralizeTags(text: string): string {
  return text.replace(TAG, '&lt;$1untrusted_input');
}

/** Wrap untrusted text in a delimited block it cannot break out of. */
export function wrapUntrusted(name: string, text: string): string {
  return `<untrusted_input name="${name}">\n${neutralizeTags(text)}\n</untrusted_input>`;
}

/** Collapse a title onto one line so it cannot inject headings or instructions into the prompt. */
export function oneLine(title: string, maxLength = 250): string {
  const flat = neutralizeTags(title).replace(/\s+/g, ' ').trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength - 1)}…` : flat;
}
