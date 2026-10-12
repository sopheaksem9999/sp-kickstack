import { describe, it, expect } from 'vitest';
import {
  defaultProfileLabel,
  describeProfile,
  effectiveProfile,
  hasPin,
  isValidModel,
  pickerLabel,
  profileApplies,
  profilePatch,
  requestChangesProfile,
  retryBody,
} from './agentProfile';

describe('describeProfile', () => {
  it('joins model and effort', () => {
    expect(describeProfile({ model: 'opus', effort: 'high' })).toBe('opus · high');
  });
  it('shows a model alone', () => {
    expect(describeProfile({ model: 'opus', effort: null })).toBe('opus');
  });
  it('labels an effort alone', () => {
    expect(describeProfile({ model: null, effort: 'high' })).toBe('high effort');
  });
  it('is empty when nothing is set', () => {
    expect(describeProfile({ model: null, effort: null })).toBe('');
    expect(describeProfile(null)).toBe('');
    expect(describeProfile(undefined)).toBe('');
  });
});

describe('effectiveProfile', () => {
  it('takes model and effort from the first layer that sets each', () => {
    const result = effectiveProfile([
      { value: { model: null, effort: 'max' }, from: 'task' },
      { value: { model: 'opus', effort: 'low' }, from: 'requirement' },
      { value: { model: 'sonnet', effort: 'high' }, from: 'workspace' },
    ]);
    expect(result).toEqual({ model: 'opus', modelFrom: 'requirement', effort: 'max', effortFrom: 'task' });
  });

  it('falls through to the workspace and reports nothing set', () => {
    expect(
      effectiveProfile([
        { value: null, from: 'task' },
        { value: undefined, from: 'requirement' },
        { value: { model: 'sonnet', effort: null }, from: 'workspace' },
      ])
    ).toEqual({ model: 'sonnet', modelFrom: 'workspace', effort: null, effortFrom: null });
    expect(effectiveProfile([])).toEqual({ model: null, modelFrom: null, effort: null, effortFrom: null });
  });
});

describe('isValidModel', () => {
  it('accepts plain model ids', () => {
    expect(isValidModel('opus')).toBe(true);
    expect(isValidModel('claude-opus-5-5')).toBe(true);
    expect(isValidModel('org/model:v1')).toBe(true);
    expect(isValidModel('  opus  ')).toBe(true);
  });
  it('rejects empty, unsafe and overlong ids', () => {
    expect(isValidModel('')).toBe(false);
    expect(isValidModel('rm -rf /')).toBe(false);
    expect(isValidModel('-opus')).toBe(false);
    expect(isValidModel('a'.repeat(81))).toBe(false);
    expect(isValidModel('a'.repeat(80))).toBe(true);
  });
});

describe('profilePatch', () => {
  it('drops the parts left on Default', () => {
    expect(profilePatch({ model: null, effort: null })).toEqual({});
    expect(profilePatch({ model: 'opus', effort: null })).toEqual({ model: 'opus' });
    expect(profilePatch({ model: null, effort: 'high' })).toEqual({ effort: 'high' });
    expect(profilePatch({ model: 'opus', effort: 'max' })).toEqual({ model: 'opus', effort: 'max' });
  });
});

describe('defaultProfileLabel', () => {
  it('names where the inherited value comes from', () => {
    expect(defaultProfileLabel({ value: { model: 'sonnet', effort: 'high' }, from: 'workspace' })).toBe('Default: sonnet · high (workspace)');
    expect(defaultProfileLabel({ value: { model: null, effort: 'low' }, from: 'workspace' })).toBe('Default: low effort (workspace)');
  });
  it('falls back to the engine default when nothing is inherited', () => {
    expect(defaultProfileLabel({ value: { model: null, effort: null }, from: 'workspace' })).toBe('Engine default');
    expect(defaultProfileLabel(null)).toBe('Engine default');
    expect(defaultProfileLabel(undefined, "Keep each task's setting")).toBe("Keep each task's setting");
  });
});

describe('retryBody', () => {
  it('keeps the pin when Default is left alone', () => {
    expect(retryBody({ model: null, effort: null }, false, true)).toEqual({});
    expect(retryBody({ model: null, effort: null }, false, false)).toEqual({});
  });
  it('pins only what was picked', () => {
    expect(retryBody({ model: 'opus', effort: null }, false, false)).toEqual({ model: 'opus' });
    expect(retryBody({ model: 'opus', effort: 'high' }, false, true)).toEqual({ model: 'opus', effort: 'high' });
  });
  it('clears both parts when Clear pin is on and the task has a pin', () => {
    expect(retryBody({ model: 'opus', effort: 'high' }, true, true)).toEqual({ model: null, effort: null });
  });
  it('ignores a stale Clear pin once the task has no pin', () => {
    expect(retryBody({ model: 'opus', effort: null }, true, false)).toEqual({ model: 'opus' });
    expect(retryBody({ model: null, effort: null }, true, false)).toEqual({});
  });
});

describe('requestChangesProfile', () => {
  it('sends nothing when the picker is left on Keep', () => {
    expect(requestChangesProfile({ model: null, effort: null }, false, true)).toEqual({});
    expect(requestChangesProfile({ model: null, effort: null }, false, false)).toEqual({});
  });
  it('pins only what was picked for the round', () => {
    expect(requestChangesProfile({ model: 'opus', effort: 'max' }, false, false)).toEqual({ model: 'opus', effort: 'max' });
    expect(requestChangesProfile({ model: null, effort: 'high' }, false, true)).toEqual({ effort: 'high' });
  });
  it('clears every pin when Clear pins is on and a task has one', () => {
    expect(requestChangesProfile({ model: 'opus', effort: 'max' }, true, true)).toEqual({ model: null, effort: null });
    expect(requestChangesProfile({ model: null, effort: null }, true, true)).toEqual({ model: null, effort: null });
  });
  it('ignores a stale Clear pins once no task has a pin', () => {
    expect(requestChangesProfile({ model: 'opus', effort: null }, true, false)).toEqual({ model: 'opus' });
    expect(requestChangesProfile({ model: null, effort: null }, true, false)).toEqual({});
  });
});

describe('hasPin', () => {
  it('is true when the task pins a model or an effort', () => {
    expect(hasPin({ model_override: 'opus', effort_override: null })).toBe(true);
    expect(hasPin({ model_override: null, effort_override: 'low' })).toBe(true);
    expect(hasPin({ model_override: 'opus', effort_override: 'max' })).toBe(true);
  });
  it('is false for an unpinned task', () => {
    expect(hasPin({ model_override: null, effort_override: null })).toBe(false);
    expect(hasPin({})).toBe(false);
  });
});

describe('profileApplies', () => {
  it('is false for the manual engine, which has no model or effort to set', () => {
    expect(profileApplies('manual')).toBe(false);
  });
  it('is true for engines that take them, and while the project is still unknown', () => {
    expect(profileApplies('stoneforge')).toBe(true);
    expect(profileApplies('clinekanban')).toBe(true);
    expect(profileApplies(undefined)).toBe(true);
  });
});

describe('pickerLabel', () => {
  const workspace = (model: string | null, effort: 'low' | 'high' | null) => ({ value: { model, effort }, from: 'workspace' });

  it('shows the inherited setting while nothing is chosen', () => {
    expect(pickerLabel({ model: null, effort: null }, workspace('sonnet', 'high'))).toEqual({
      text: 'Default: sonnet · high (workspace)',
      title: 'Default: sonnet · high (workspace)',
    });
  });
  it('falls back when nothing is chosen or inherited', () => {
    expect(pickerLabel({ model: null, effort: null }, workspace(null, null)).text).toBe('Engine default');
    expect(pickerLabel({ model: null, effort: null }, undefined, "Keep each task's setting").text).toBe("Keep each task's setting");
  });
  it('shows a full choice as it is', () => {
    expect(pickerLabel({ model: 'opus', effort: 'max' }, workspace('sonnet', 'low'))).toEqual({ text: 'opus · max', title: 'opus · max' });
  });
  it('adds the inherited effort next to a chosen model, and says where it comes from', () => {
    expect(pickerLabel({ model: 'opus', effort: null }, workspace(null, 'low'))).toEqual({
      text: 'opus · low',
      title: 'opus · low (effort from workspace)',
    });
  });
  it('adds the inherited model next to a chosen effort', () => {
    expect(pickerLabel({ model: null, effort: 'high' }, workspace('sonnet', null))).toEqual({
      text: 'sonnet · high',
      title: 'sonnet · high (model from workspace)',
    });
  });
  it('shows a partial choice alone when nothing else is inherited', () => {
    expect(pickerLabel({ model: null, effort: 'high' }, workspace(null, null))).toEqual({ text: 'high effort', title: 'high effort' });
    expect(pickerLabel({ model: 'opus', effort: null })).toEqual({ text: 'opus', title: 'opus' });
  });
});
