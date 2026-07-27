import { mkdirSync, readFileSync } from 'node:fs';

import { chromium, type Browser, type CDPSession, type Page } from 'playwright-core';

// Repeatable local-server load test used for issue #99. Example:
// bun tools/multibox-perf-test.ts --base http://localhost:8888 --label baseline

interface Args {
    base: string;
    bots: number;
    durationMs: number;
    label: string;
    accountPrefix: string;
}

interface SlotSample {
    id: number;
    username: string;
    focused: boolean;
    mode: string;
    loopCycle: number;
    drawn: number;
    tickCount: number;
    tickMeanMs: number;
    clientFps: number;
    scriptState: string;
    scriptLoops: number;
}

interface ProcessInfo {
    type: string;
    id: number;
    cpuTime: number;
}

interface TargetInfo {
    type: string;
}

function parseArgs(argv: string[]): Args {
    const out: Args = {
        base: 'http://localhost:18888',
        bots: 12,
        durationMs: 60_000,
        label: 'run',
        accountPrefix: 'issue99p'
    };
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        const value = argv[i + 1];
        if (key === '--base' && value) {
            out.base = value;
            i++;
        } else if (key === '--bots' && value) {
            out.bots = Number(value);
            i++;
        } else if (key === '--seconds' && value) {
            out.durationMs = Number(value) * 1000;
            i++;
        } else if (key === '--label' && value) {
            out.label = value;
            i++;
        } else if (key === '--account-prefix' && value) {
            out.accountPrefix = value;
            i++;
        }
    }
    if (!Number.isSafeInteger(out.bots) || out.bots < 1 || out.bots > 100) {
        throw new RangeError('--bots must be an integer from 1 to 100');
    }
    if (!Number.isFinite(out.durationMs) || out.durationMs < 10_000) {
        throw new RangeError('--seconds must be at least 10');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(out.label)) {
        throw new Error('--label may contain only letters, numbers, underscores, and hyphens');
    }
    const hostname = new URL(out.base).hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]') {
        throw new Error('--base must point to a local test server');
    }
    return out;
}

function percentile(values: number[], fraction: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function round(value: number, digits = 2): number {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
}

async function processInfo(session: CDPSession): Promise<ProcessInfo[]> {
    const result = await session.send('SystemInfo.getProcessInfo') as { processInfo: ProcessInfo[] };
    return result.processInfo;
}

function cpuSeconds(processes: ProcessInfo[]): number {
    return processes.reduce((sum, process) => sum + process.cpuTime, 0);
}

function processMemoryBytes(processes: ProcessInfo[]): { pss: number; rss: number; measured: number } {
    let pss = 0;
    let rss = 0;
    let measured = 0;
    for (const pid of new Set(processes.map(process => process.id))) {
        try {
            const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
            const pssKb = Number(/^Pss:\s+(\d+) kB$/m.exec(rollup)?.[1] ?? 0);
            const rssKb = Number(/^Rss:\s+(\d+) kB$/m.exec(rollup)?.[1] ?? 0);
            pss += pssKb * 1024;
            rss += rssKb * 1024;
            measured++;
        } catch {
            // The process may exit between CDP's process snapshot and /proc.
        }
    }
    return { pss, rss, measured };
}

function countsByType(items: Array<{ type: string }>): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const item of items) counts[item.type] = (counts[item.type] ?? 0) + 1;
    return counts;
}

async function slotSamples(page: Page): Promise<SlotSample[]> {
    return page.evaluate(() => {
        type Lcb = {
            client: { constructor: { loopCycle: number }; fps: number };
            host: { tickCount: number; tickMeanMs: number };
            renderGate: { drawn: number };
            runner: { state: string; ctx: { loopCount: number } | null };
        };
        type Snapshot = { id: number; username: string; focused: boolean; mode: string; loopCycle: number; drawn: number; scriptState: string };
        const multibox = (globalThis as unknown as { multibox: { slots(): Snapshot[] } }).multibox;
        const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
        return multibox.slots().map((slot, index) => {
            const lcb = frames[index]?.contentWindow && (frames[index].contentWindow as unknown as { rs2b0t?: Lcb }).rs2b0t;
            return {
                ...slot,
                tickCount: lcb?.host.tickCount ?? 0,
                tickMeanMs: lcb?.host.tickMeanMs ?? 0,
                clientFps: lcb?.client.fps ?? 0,
                scriptLoops: lcb?.runner.ctx?.loopCount ?? 0
            };
        });
    });
}

async function focusLatencies(page: Page, ids: number[]): Promise<number[]> {
    const samples: number[] = [];
    for (let i = 0; i < ids.length * 2; i++) {
        const id = ids[i % ids.length];
        const latency = await page.evaluate(async targetId => {
            type Snapshot = { id: number; drawn: number };
            const multibox = (globalThis as unknown as { multibox: { focus(id: number): void; slots(): Snapshot[] } }).multibox;
            const before = multibox.slots().find(slot => slot.id === targetId)?.drawn ?? 0;
            const started = performance.now();
            multibox.focus(targetId);
            return await new Promise<number>(resolve => {
                const poll = (): void => {
                    const drawn = multibox.slots().find(slot => slot.id === targetId)?.drawn ?? 0;
                    const elapsed = performance.now() - started;
                    if (drawn > before || elapsed >= 2000) {
                        resolve(elapsed);
                    } else {
                        requestAnimationFrame(poll);
                    }
                };
                requestAnimationFrame(poll);
            });
        }, id);
        samples.push(latency);
    }
    return samples;
}

async function run(browser: Browser, args: Args): Promise<Record<string, unknown>> {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => {
        if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
            errors.push(message.text());
        }
    });

    await page.goto(`${args.base}/multibox.html`);
    await page.waitForFunction(() => Boolean((globalThis as unknown as { multibox?: unknown }).multibox), undefined, { timeout: 30_000 });
    console.log(`wall ready; seeding shared cache with ${args.accountPrefix}01`);

    const accounts = Array.from({ length: args.bots }, (_, index) => ({
        username: `${args.accountPrefix}${String(index + 1).padStart(2, '0')}`,
        password: 'test'
    }));
    // Seed the origin's shared IndexedDB cache with one client before the other
    // eleven start. This keeps the benchmark focused on an established wall
    // instead of multiplying first-run cache downloads.
    await page.evaluate(account => {
        const multibox = (globalThis as unknown as { multibox: { add(account: { username: string; password: string }): unknown } }).multibox;
        multibox.add(account);
    }, accounts[0]);
    await page.waitForFunction(() => {
        type Snapshot = { ingame: boolean };
        const slots = (globalThis as unknown as { multibox: { slots(): Snapshot[] } }).multibox.slots();
        return slots.length === 1 && slots[0].ingame;
    }, undefined, { timeout: 120_000 });
    console.log('seed client ingame; adding remaining clients');
    await page.evaluate(value => {
        const multibox = (globalThis as unknown as { multibox: { add(account: { username: string; password: string }): unknown } }).multibox;
        for (const account of value) multibox.add(account);
    }, accounts.slice(1));

    await page.waitForFunction(expected => {
        type Snapshot = { ingame: boolean };
        const slots = (globalThis as unknown as { multibox: { slots(): Snapshot[] } }).multibox.slots();
        return slots.length === expected && slots.every(slot => slot.ingame);
    }, args.bots, { timeout: 240_000 });
    console.log(`${args.bots} clients ingame; starting QuestDashboard in every slot`);

    await page.evaluate(() => {
        type Lcb = { registry: { get(name: string): unknown }; runner: { start(meta: unknown): void } };
        for (const frame of Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'))) {
            const lcb = frame.contentWindow && (frame.contentWindow as unknown as { rs2b0t?: Lcb }).rs2b0t;
            const script = lcb?.registry.get('QuestDashboard');
            if (lcb && script) lcb.runner.start(script);
        }
    });
    await page.waitForFunction(() => {
        type Lcb = { runner: { state: string; ctx: { loopCount: number } | null } };
        const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
        return frames.every(frame => {
            const lcb = frame.contentWindow && (frame.contentWindow as unknown as { rs2b0t?: Lcb }).rs2b0t;
            return lcb?.runner.state === 'running' && (lcb.runner.ctx?.loopCount ?? 0) >= 3;
        });
    }, undefined, { timeout: 30_000 });

    console.log('all scripts active; warming for 20 seconds');
    await page.waitForTimeout(20_000);
    await page.evaluate(() => {
        const state = globalThis as unknown as { __issue99Lag?: number[]; __issue99LagTimer?: number };
        state.__issue99Lag = [];
        let previous = performance.now();
        state.__issue99LagTimer = window.setInterval(() => {
            const now = performance.now();
            state.__issue99Lag!.push(Math.max(0, now - previous - 20));
            previous = now;
        }, 20);
    });

    const browserSession = await browser.newBrowserCDPSession();
    const pageSession = await page.context().newCDPSession(page);
    await pageSession.send('Performance.enable');
    const beforeProcesses = await processInfo(browserSession);
    const beforeSlots = await slotSamples(page);
    const beforePerformance = await pageSession.send('Performance.getMetrics') as { metrics: { name: string; value: number }[] };
    const startedAt = performance.now();
    console.log(`measuring for ${args.durationMs / 1000} seconds`);
    await page.waitForTimeout(args.durationMs);
    const elapsedMs = performance.now() - startedAt;
    const afterPerformance = await pageSession.send('Performance.getMetrics') as { metrics: { name: string; value: number }[] };
    const afterSlots = await slotSamples(page);
    const afterProcesses = await processInfo(browserSession);
    const { targetInfos } = await browserSession.send('Target.getTargets') as { targetInfos: TargetInfo[] };
    const lag = await page.evaluate(() => {
        const state = globalThis as unknown as { __issue99Lag?: number[]; __issue99LagTimer?: number };
        if (state.__issue99LagTimer !== undefined) window.clearInterval(state.__issue99LagTimer);
        return state.__issue99Lag ?? [];
    });

    const focus = await focusLatencies(page, afterSlots.map(slot => slot.id));
    mkdirSync('out', { recursive: true });
    await page.screenshot({ path: `out/multibox-perf-${args.label}.png`, fullPage: true });

    const seconds = elapsedMs / 1000;
    const taskBefore = beforePerformance.metrics.find(metric => metric.name === 'TaskDuration')?.value ?? 0;
    const taskAfter = afterPerformance.metrics.find(metric => metric.name === 'TaskDuration')?.value ?? 0;
    const memory = processMemoryBytes(afterProcesses);
    const deltas = afterSlots.map((after, index) => {
        const before = beforeSlots[index];
        return {
            username: after.username,
            logicFps: round((after.loopCycle - before.loopCycle) / seconds),
            drawFps: round((after.drawn - before.drawn) / seconds),
            tickRate: round((after.tickCount - before.tickCount) / seconds),
            scriptLoops: after.scriptLoops - before.scriptLoops,
            reportedFps: after.clientFps,
            tickMeanMs: round(after.tickMeanMs)
        };
    });
    const logicFps = deltas.map(delta => delta.logicFps);
    const result = {
        label: args.label,
        base: args.base,
        bots: args.bots,
        durationSeconds: round(seconds),
        chrome: {
            cpuCores: round((cpuSeconds(afterProcesses) - cpuSeconds(beforeProcesses)) / seconds),
            taskCores: round((taskAfter - taskBefore) / seconds),
            pssMiB: round(memory.pss / 1024 / 1024, 1),
            rssMiB: round(memory.rss / 1024 / 1024, 1),
            measuredProcesses: memory.measured,
            processTypes: countsByType(afterProcesses),
            targetTypes: countsByType(targetInfos)
        },
        responsivenessMs: {
            eventLoopP50: round(percentile(lag, 0.5)),
            eventLoopP95: round(percentile(lag, 0.95)),
            eventLoopP99: round(percentile(lag, 0.99)),
            eventLoopMax: round(Math.max(0, ...lag)),
            focusToDrawP50: round(percentile(focus, 0.5)),
            focusToDrawP95: round(percentile(focus, 0.95)),
            focusToDrawMax: round(Math.max(0, ...focus))
        },
        logicFps: {
            min: round(Math.min(...logicFps)),
            median: round(percentile(logicFps, 0.5)),
            max: round(Math.max(...logicFps))
        },
        slots: deltas,
        errors
    };
    await Bun.write(`out/multibox-perf-${args.label}.json`, `${JSON.stringify(result, null, 2)}\n`);
    return result;
}

const args = parseArgs(process.argv.slice(2));
const browser = await chromium.launch({
    channel: 'chrome',
    headless: !process.env.HEADED,
    args: [
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
    ]
});

try {
    const result = await run(browser, args);
    console.log(JSON.stringify(result, null, 2));
    if ((result.errors as string[]).length > 0) process.exitCode = 1;
} finally {
    await browser.close();
}
