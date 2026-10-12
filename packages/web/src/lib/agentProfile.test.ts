import { describe, it, expect } from 'vitest';
import { defaultProfileLabel, describeProfile, effectiveProfile, isValidModel, profilePatch, retryBody } from './agentProfile';

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
