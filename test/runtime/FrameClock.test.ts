import { describe, expect, test } from 'bun:test';

import { installSharedFrameClock, resolveFrameClock, type FrameClock } from '#/bot/runtime/FrameClock.js';

function fakeClock(): FrameClock {
    return { sleep: async () => {} };
}

describe('MultiBox frame clock', () => {
    test('child clients reuse the clock installed by their wall', () => {
        const shared = fakeClock();
        const parent = {};
        const child = { parent };
        const fallback = fakeClock();

        installSharedFrameClock(parent, shared);

        expect(resolveFrameClock(fallback, child)).toBe(shared);
    });

    test('standalone clients keep their local clock', () => {
        const fallback = fakeClock();
        const standalone: { parent?: object } = {};
        standalone.parent = standalone;

        expect(resolveFrameClock(fallback, standalone)).toBe(fallback);
    });

    test('an existing wall clock is not replaced', () => {
        const first = fakeClock();
        const second = fakeClock();
        const scope = {};

        expect(installSharedFrameClock(scope, first)).toBe(first);
        expect(installSharedFrameClock(scope, second)).toBe(first);
    });
});
