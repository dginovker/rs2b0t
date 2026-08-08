import { afterEach, expect, test } from 'bun:test';
import { LoopingBot } from '#/bot/api/Bot.js';
import { Scheduler } from '#/bot/runtime/Scheduler.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import type { ScriptMeta } from '#/bot/runtime/ScriptRegistry.js';

class SelfStoppingBot extends LoopingBot {
    starts = 0;
    stops = 0;

    override onStart(): void {
        this.starts++;
        ScriptRunner.stop('test: self-stopping bot');
    }

    override onStop(): void {
        this.stops++;
    }

    override loop(): void {
        throw new Error('loop must not run after onStart stops the script');
    }
}

async function settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

afterEach(async () => {
    ScriptRunner.stop('test teardown');
    await settle();
});

test('a script can restart after stopping itself during onStart', async () => {
    const instances: SelfStoppingBot[] = [];
    const meta: ScriptMeta = {
        name: 'Self-stopping test bot',
        description: 'runner regression fixture',
        create: () => {
            const bot = new SelfStoppingBot();
            instances.push(bot);
            return bot;
        }
    };

    ScriptRunner.start(meta);
    await settle();

    expect(ScriptRunner.state).toBe('stopped');
    expect(Scheduler.active).toBeNull();
    expect(instances[0]?.starts).toBe(1);
    expect(instances[0]?.stops).toBe(1);
    // Tail, not the whole log: ScriptRunner is a singleton, so whether a line
    // about an earlier run is carried in depends on what ran before this file.
    expect(ScriptRunner.ctx?.log.map(line => line.msg).slice(-3)).toEqual([
        'Self-stopping test bot started (input: direct)',
        'stopping — test: self-stopping bot',
        'stopped — test: self-stopping bot'
    ]);

    expect(() => ScriptRunner.start(meta)).not.toThrow();
    await settle();

    expect(ScriptRunner.state).toBe('stopped');
    expect(Scheduler.active).toBeNull();
    expect(instances).toHaveLength(2);
    expect(instances[1]?.starts).toBe(1);
    expect(instances[1]?.stops).toBe(1);
    // A restart replaces the context and its log; without this carry-over the
    // reason the previous run ended would be gone (the "stopped, nothing in the
    // logs" report).
    expect(ScriptRunner.ctx?.log.map(line => line.msg)).toContain(
        "previous run of 'Self-stopping test bot' ended (stopped) — test: self-stopping bot"
    );
});

test('a stop with a blank reason still says so instead of reading as no reason', async () => {
    const meta: ScriptMeta = {
        name: 'Blank reason bot',
        description: 'runner regression fixture',
        create: () => new (class extends LoopingBot {
            loop(): void {}
        })()
    };

    ScriptRunner.start(meta);
    await settle();
    ScriptRunner.stop('   ');
    await settle();

    expect(ScriptRunner.ctx?.log.map(line => line.msg)).toContain(
        'stopped — no reason given by the caller (bug — please report)'
    );
});
