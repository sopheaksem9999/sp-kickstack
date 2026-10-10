// Helpers for placing untrusted text (requirements, tickets, agent summaries) into engine prompts.

// Also catches whitespace variants such as "</ untrusted_input" or "< /untrusted_input".
const TAG = /<\s*(\/?)\s*untrusted_input/gi;

// Bridge notes at the end of a prompt start with "<!-- bridge:<kind> -->"; text from people or
// agents must not be able to fake one.
const BRIDGE_MARK = /<!--\s*bridge:/gi;

/** Neutralize anything that looks like an untrusted_input tag so text cannot open or close a block. */
function neutralizeTags(text: string): string {
  return text.replace(TAG, '&lt;$1untrusted_input').replace(BRIDGE_MARK, '&lt;!-- bridge:');
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

/** Neutralize prompt-structure markers in multi-line text written by a person or agent. */
export function neutralize(text: string): string {
  return neutralizeTags(text);
}
