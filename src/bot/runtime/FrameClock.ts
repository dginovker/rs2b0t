import { WorkerClock } from '#/util/WorkerClock.js';

export interface FrameClock {
    sleep(ms: number): Promise<void>;
}

const SHARED_CLOCK_KEY = '__rs2b0tFrameClock';

function clockOn(scope: object): FrameClock | null {
    const value = (scope as Record<string, unknown>)[SHARED_CLOCK_KEY];
    if (!value || typeof (value as Partial<FrameClock>).sleep !== 'function') {
        return null;
    }
    return value as FrameClock;
}

export function installSharedFrameClock(scope: object = globalThis, clock: FrameClock = WorkerClock): FrameClock {
    const existing = clockOn(scope);
    if (existing) {
        return existing;
    }
    (scope as Record<string, unknown>)[SHARED_CLOCK_KEY] = clock;
    return clock;
}

export function resolveFrameClock(fallback: FrameClock = WorkerClock, scope: object = globalThis): FrameClock {
    try {
        const parent = (scope as { parent?: object }).parent;
        if (parent && parent !== scope) {
            return clockOn(parent) ?? fallback;
        }
    } catch {
        // Cross-origin embedding cannot share the parent's clock.
    }
    return fallback;
}
