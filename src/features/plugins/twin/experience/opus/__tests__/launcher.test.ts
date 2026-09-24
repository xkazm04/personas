import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { closeTwinExperience, openTwinExperience, useTwinExperienceRequest } from '../launcher';

afterEach(() => {
  closeTwinExperience();
});

describe('the experience launcher', () => {
  it('carries the request from whoever opened it to the host, and clears on close', () => {
    const { result } = renderHook(() => useTwinExperienceRequest());
    expect(result.current).toBeNull();

    act(() => openTwinExperience({ mode: 'create' }));
    expect(result.current).toEqual({ mode: 'create' });

    act(() => openTwinExperience({ mode: 'train', stage: 'training' }));
    expect(result.current).toEqual({ mode: 'train', stage: 'training' });

    act(() => closeTwinExperience());
    expect(result.current).toBeNull();
  });

  it('every subscriber sees the same request', () => {
    const a = renderHook(() => useTwinExperienceRequest());
    const b = renderHook(() => useTwinExperienceRequest());
    act(() => openTwinExperience({ mode: 'train' }));
    expect(a.result.current).toEqual({ mode: 'train' });
    expect(b.result.current).toBe(a.result.current);
  });
});
