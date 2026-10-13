import { describe, it, expect } from 'vitest';
import { ClefService } from './clefService.js';

describe('ClefService', () => {
  const service = new ClefService();

  it('classifies TypeScript type errors as P1 / type_check', async () => {
    const error = "error TS2322: Type 'string' is not assignable to type 'number'.";
    const result = await service.triageError(error);
    expect(result.severity).toBe('P1');
    expect(result.domain).toBe('type_check');
  });

  it('classifies missing dependencies as P1 / dependency', async () => {
    const error = "Cannot find module 'express' or its corresponding type declarations.";
    const result = await service.triageError(error);
    expect(result.severity).toBe('P1');
    expect(result.domain).toBe('dependency');
  });

  it('classifies critical database drops / data loss as P0', async () => {
    const error = "FATAL: DROP DATABASE production_db cascade failed during transaction abort";
    const result = await service.triageError(error);
    expect(result.severity).toBe('P0');
  });

  it('classifies minor cosmetic or warning issues as P2/P3', async () => {
    const error = "warning: unused variable 'unusedVar' in Button.tsx";
    const result = await service.triageError(error);
    expect(['P2', 'P3']).toContain(result.severity);
  });
});
