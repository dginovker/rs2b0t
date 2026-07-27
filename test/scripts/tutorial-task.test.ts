import { expect, test } from 'bun:test';
import { once, task } from '#/bot/scripts/tutorial/Task.js';

test('task delegates validation and execution', async () => {
    let runs = 0;
    const step = task(() => true, async () => ++runs);
    expect(await step.validate()).toBe(true);
    await step.execute();
    expect(runs).toBe(1);
});

test('once retries until its action confirms completion', async () => {
    let attempts = 0;
    const step = once(() => true, async () => ++attempts === 2);
    expect(await step.validate()).toBe(true);
    await step.execute();
    expect(await step.validate()).toBe(true);
    await step.execute();
    expect(await step.validate()).toBe(false);
    expect(attempts).toBe(2);
});
