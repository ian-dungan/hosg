import { describe, expect, it } from 'vitest';
import { MOUTH_RECOMMENDED_LEVEL, mouthHintText } from './mouthHint';

describe('the crater mouth hint', () => {
  it('names the recommended level, and the adventurer\'s own when it is lower (entry is never blocked)', () => {
    expect(MOUTH_RECOMMENDED_LEVEL).toBe(8);
    const low = mouthHintText([], 1);
    expect(low).toContain('Recommended: level 8 or higher');
    expect(low).toContain('you are level 1');
    expect(low).toContain('Alone unless you form a party first');
    const ok = mouthHintText(['Ellie_01'], 9);
    expect(ok).toContain('Recommended: level 8 or higher');
    expect(ok).not.toContain('you are level');
    expect(ok).toContain('(you, Ellie_01)');
  });
});
