import { describe, expect, it } from 'vitest';
import { coreVersion } from './health.ts';

describe('coreVersion', () => {
  it('バージョン文字列を返す', () => {
    expect(coreVersion()).toBe('0.0.0');
  });
});
