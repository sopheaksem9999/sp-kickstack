import { describe, it, expect } from 'vitest';
import { formatRequirementTitle } from './requirementTitles.js';

describe('requirement title formatting', () => {
  it('formats conversational request into standardized [Module] <Action Verb> <Scope> format', () => {
    const raw = 'We need to design a REST API with admin dashboard controllers';
    const result = formatRequirementTitle(raw);
    expect(result).toBe('[API] Design REST API with Admin Dashboard Controllers');
  });


  it('formats auth and token requirements cleanly', () => {
    const raw = 'we need to add jwt authentication with refresh token rotation';
    const result = formatRequirementTitle(raw);
    expect(result).toBe('[Auth] Add JWT Authentication with Refresh Token Rotation');
  });

  it('handles media and upload requirements with Build verb', () => {
    const raw = 'build user profile avatar upload and cropping';
    const result = formatRequirementTitle(raw);
    expect(result).toBe('[Media] Build User Profile Avatar Upload and Cropping');
  });

  it('handles billing and payment requirements with Integrate verb', () => {
    const raw = 'integrate stripe webhook and payment verification';
    const result = formatRequirementTitle(raw);
    expect(result).toBe('[Billing] Integrate Stripe Webhook and Payment Verification');
  });

  it('handles database schema requirements with Design verb', () => {
    const raw = 'design multilingual translation schema and compound indexes';
    const result = formatRequirementTitle(raw);
    expect(result).toBe('[Database] Design Multilingual Translation Schema and Compound Indexes');
  });

  it('handles performance and optimization requirements with Optimize verb', () => {
    const raw = 'optimize metrics feed with virtual scrolling';
    const result = formatRequirementTitle(raw);
    expect(result).toBe('[Perf] Optimize Metrics Feed with Virtual Scrolling');
  });

  it('preserves existing module tag and standardizes contents', () => {
    const raw = '[auth] implement oauth2 google login';
    const result = formatRequirementTitle(raw);
    expect(result).toBe('[Auth] Implement OAuth2 Google Login');
  });

  it('strips markdown, numbering, and trailing punctuation', () => {
    const raw = '1. **Requirement Created:** Add SMS verification for 2FA...';
    const result = formatRequirementTitle(raw);
    expect(result).toBe('[Auth] Add SMS Verification for 2FA');
  });

  it('falls back to context when title is generic or placeholder', () => {
    const raw = 'Overview';
    const context = 'Implement real-time driver location tracking via WebSocket';
    const result = formatRequirementTitle(raw, context);
    expect(result).toContain('[Realtime]');
    expect(result).toContain('WebSocket');
  });

  it('preserves micro test fixtures without alteration', () => {
    expect(formatRequirementTitle('T')).toBe('T');
    expect(formatRequirementTitle('Ok')).toBe('Ok');
    expect(formatRequirementTitle('abc')).toBe('abc');
  });

  it('truncates overly long titles at word boundary', () => {
    const long = 'We need to design a very long complex distributed architectural microservice system with multiple redundant failover handlers and streaming replication pipelines across global regions';
    const result = formatRequirementTitle(long);
    expect(result.length).toBeLessThanOrEqual(95);
    expect(result.endsWith(' ')).toBe(false);
  });
});
