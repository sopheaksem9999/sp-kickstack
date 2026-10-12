import type { EngineType, ReasoningEffort } from '@sp-kickstack/shared';

export const MODEL_SUGGESTIONS = ['opus', 'sonnet', 'haiku', 'fable'];
export const EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export interface ProfileValue {
  model: string | null;
  effort: ReasoningEffort | null;
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;

export function isValidModel(model: string): boolean {
  return MODEL_ID.test(model.trim());
}

/** "opus · high", "opus", "high effort", or "" when nothing is set. */
export function describeProfile(p: Partial<ProfileValue> | null | undefined): string {
  const model = p?.model || '';
  const effort = p?.effort ? (model ? p.effort : `${p.effort} effort`) : '';
  return [model, effort].filter(Boolean).join(' · ');
}

/** The value that applies and where each part comes from, first layer that sets it wins. */
export function effectiveProfile(layers: Array<{ value: Partial<ProfileValue> | null | undefined; from: string }>): {
  model: string | null;
  modelFrom: string | null;
  effort: ReasoningEffort | null;
  effortFrom: string | null;
} {
  const modelLayer = layers.find((l) => l.value?.model);
  const effortLayer = layers.find((l) => l.value?.effort);
  return {
    model: modelLayer?.value?.model ?? null,
    modelFrom: modelLayer?.from ?? null,
    effort: effortLayer?.value?.effort ?? null,
    effortFrom: effortLayer?.from ?? null,
  };
}

/** Only the parts a person chose ("Default" = keep), for Retry / Request changes. */
export function profilePatch(value: ProfileValue): { model?: string; effort?: ReasoningEffort } {
  return { ...(value.model ? { model: value.model } : {}), ...(value.effort ? { effort: value.effort } : {}) };
}

/** Trigger text when a picker is on Default: "Default: sonnet · high (workspace)", or the fallback when nothing is inherited. */
export function defaultProfileLabel(
  inherited: { value: Partial<ProfileValue> | null | undefined; from: string } | null | undefined,
  fallback = 'Engine default'
): string {
  const text = describeProfile(inherited?.value);
  return text ? `Default: ${text} (${inherited!.from})` : fallback;
}

/** Body for Retry: Clear pin (only while the task has a pin) sends null for both parts, otherwise just what was picked. */
export function retryBody(
  value: ProfileValue,
  clearPin: boolean,
  hasPin: boolean
): { model?: string | null; effort?: ReasoningEffort | null } {
  return clearPin && hasPin ? { model: null, effort: null } : profilePatch(value);
}

/** Body for Request changes: Clear pins (only while a task being sent back has a pin) sends null for both parts, otherwise just what was picked. */
export function requestChangesProfile(
  value: ProfileValue,
  clearPins: boolean,
  anyPinned: boolean
): { model?: string | null; effort?: ReasoningEffort | null } {
  return retryBody(value, clearPins, anyPinned);
}

/** Whether a task carries a model or effort pin (set by Retry with or Request changes). */
export function hasPin(task: { model_override?: string | null; effort_override?: ReasoningEffort | null }): boolean {
  return Boolean(task.model_override || task.effort_override);
}

/** Whether the engine takes a model or effort; the manual engine ignores both, so a pin there does nothing. */
export function profileApplies(engineType: EngineType | undefined): boolean {
  return engineType !== 'manual';
}

/**
 * Picker trigger text and tooltip. While nothing is chosen it names the inherited setting. A choice of only
 * a model or only an effort also shows the part it inherits, and the tooltip says where that part comes from.
 */
export function pickerLabel(
  value: Partial<ProfileValue> | null | undefined,
  inherited?: { value: Partial<ProfileValue> | null | undefined; from: string } | null,
  fallback = 'Engine default'
): { text: string; title: string } {
  if (!describeProfile(value)) {
    const text = defaultProfileLabel(inherited, fallback);
    return { text, title: text };
  }
  const effective = effectiveProfile([{ value, from: 'chosen' }, ...(inherited ? [inherited] : [])]);
  const text = describeProfile({ model: effective.model, effort: effective.effort });
  const inheritedParts = [
    ...(effective.modelFrom && effective.modelFrom !== 'chosen' ? [`model from ${effective.modelFrom}`] : []),
    ...(effective.effortFrom && effective.effortFrom !== 'chosen' ? [`effort from ${effective.effortFrom}`] : []),
  ];
  return { text, title: inheritedParts.length ? `${text} (${inheritedParts.join(', ')})` : text };
}
