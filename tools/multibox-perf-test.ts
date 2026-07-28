import { mkdirSync, readFileSync } from 'node:fs';

import { chromium, type CDPSession, type Page } from 'playwright-core';

interface Args {
    base: string;
    bots: number;
    durationMs: number;
    label: string;
    accountPrefix: string;
    password: string;
    script: string;
    renderers: 'on' | 'off';
    toggleCycles: number;
    settings: Array<{ script: string; key: string; value: string }>;
    requireMovement: boolean;
}

interface ProcessInfo {
    id: number;
    type: string;
    cpuTime: number;
}

interface SlotSample {
    id: number;
    username: string;
    focused: boolean;
    ingame: boolean;
    tile: { x: number; z: number; level: number } | null;
    loopCycle: number;
    drawn: number;
    tickCount: number;
    tickMeanMs: number;
    clientFps: number;
    scriptState: string;
    scriptLoops: number;
    rendererEnabled: boolean;
    streamGeneration: number;
}

function parseArgs(argv: string[]): Args {
    const args: Args = {
        base: 'http://localhost:8890',
        bots: 20,
        durationMs: 60_000,
        label: 'run',
        accountPrefix: 'issue99p',
        password: 'test',
        script: 'QuestDashboard',
        renderers: 'on',
        toggleCycles: 0,
        settings: [],
        requireMovement: false
    };
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        if (key === '--require-movement') {
            args.requireMovement = true;
            continue;
        }
        const value = argv[i + 1];
        if (key === '--base' && value) args.base = value;
        else if (key === '--bots' && value) args.bots = Number(value);
        else if (key === '--seconds' && value) args.durationMs = Number(value) * 1000;
        else if (key === '--label' && value) args.label = value;
        else if (key === '--account-prefix' && value) args.accountPrefix = value;
        else if (key === '--password' && value) args.password = value;
        else if (key === '--script' && value) args.script = value;
        else if (key === '--renderers' && (value === 'on' || value === 'off')) args.renderers = value;
        else if (key === '--toggle-cycles' && value) args.toggleCycles = Number(value);
        else if (key === '--setting' && value) {
            const equals = value.indexOf('=');
            const dot = value.indexOf('.');
            if (dot < 1 || equals <= dot + 1) throw new Error('--setting must be Script.key=value');
            args.settings.push({ script: value.slice(0, dot), key: value.slice(dot + 1, equals), value: value.slice(equals + 1) });
        }
        else continue;
        i++;
    }
    if (!Number.isSafeInteger(args.bots) || args.bots < 1 || args.bots > 100) {
        throw new RangeError('--bots must be an integer from 1 to 100');
    }
    if (!Number.isFinite(args.durationMs) || args.durationMs < 10_000) {
        throw new RangeError('--seconds must be at least 10');
    }
    if (!Number.isSafeInteger(args.toggleCycles) || args.toggleCycles < 0 || args.toggleCycles > 100) {
        throw new RangeError('--toggle-cycles must be an integer from 0 to 100');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(args.label)) {
        throw new Error('--label may contain only letters, numbers, underscores, and hyphens');
    }
    const hostname = new URL(args.base).hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]') {
        throw new Error('--base must point to a local test server');
    }
    return args;
}

function round(value: number, digits = 2): number {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
}

function percentile(values: number[], fraction: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

async function processInfo(session: CDPSession): Promise<ProcessInfo[]> {
    return ((await session.send('SystemInfo.getProcessInfo')) as { processInfo: ProcessInfo[] }).processInfo;
}

function cpuSeconds(processes: ProcessInfo[]): number {
    return processes.reduce((sum, process) => sum + process.cpuTime, 0);
}

function processMemory(processes: ProcessInfo[]): { pssMiB: number; rssMiB: number; measured: number } {
    let pssKb = 0;
    let rssKb = 0;
    let measured = 0;
    for (const pid of new Set(processes.map(process => process.id))) {
        try {
            const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
            pssKb += Number(/^Pss:\s+(\d+) kB$/m.exec(rollup)?.[1] ?? 0);
            rssKb += Number(/^Rss:\s+(\d+) kB$/m.exec(rollup)?.[1] ?? 0);
            measured++;
        } catch {
            // A browser process can exit between CDP's list and /proc.
        }
    }
    return { pssMiB: round(pssKb / 1024, 1), rssMiB: round(rssKb / 1024, 1), measured };
}

function counts(items: Array<{ type: string }>): Record<string, number> {
    const result: Record<string, number> = {};
    for (const item of items) result[item.type] = (result[item.type] ?? 0) + 1;
    return result;
}

async function slots(page: Page): Promise<SlotSample[]> {
    return page.evaluate(() => {
        type Snapshot = {
            id: number;
            username: string;
            focused: boolean;
            ingame: boolean;
            tile?: { x: number; z: number; level: number } | null;
            loopCycle: number;
            drawn: number;
            tickCount?: number;
            tickMeanMs?: number;
            clientFps?: number;
            scriptState: string;
            scriptLoops?: number;
            rendererEnabled?: boolean;
            streamGeneration?: number;
        };
        const wall = (globalThis as unknown as { multibox: { slots(): Snapshot[] } }).multibox;
        return wall.slots().map(slot => ({
            ...slot,
            tile: slot.tile ?? null,
            tickCount: slot.tickCount ?? 0,
            tickMeanMs: slot.tickMeanMs ?? 0,
            clientFps: slot.clientFps ?? 0,
            scriptLoops: slot.scriptLoops ?? 0,
            rendererEnabled: slot.rendererEnabled ?? true,
            streamGeneration: slot.streamGeneration ?? 0
        }));
    });
}

async function startScript(page: Page, script: string): Promise<void> {
    const started = await page.evaluate(name => {
        type Snapshot = { id: number };
        const wall = (globalThis as unknown as { multibox: { slots(): Snapshot[]; startScript(id: number, name: string): boolean } }).multibox;
        const current = wall.slots();
        return current.length > 0 && current.every(slot => wall.startScript(slot.id, name));
    }, script);
    if (!started) throw new Error(`script '${script}' was not available in every slot`);
}

async function focusLatencies(page: Page, samples: SlotSample[], renderers: 'on' | 'off'): Promise<number[]> {
    const result: number[] = [];
    for (let i = 0; i < Math.min(samples.length * 2, 40); i++) {
        const target = samples[i % samples.length];
        result.push(
            await page.evaluate(
                async ({ id, rendererOff }) => {
                    type Snapshot = { id: number; focused: boolean; drawn: number };
                    const wall = (globalThis as unknown as { multibox: { focus(id: number): void; slots(): Snapshot[] } }).multibox;
                    const before = wall.slots().find(slot => slot.id === id)?.drawn ?? 0;
                    const started = performance.now();
                    wall.focus(id);
                    return await new Promise<number>(resolve => {
                        const poll = (): void => {
                            const slot = wall.slots().find(item => item.id === id);
                            if ((slot?.focused && (rendererOff || slot.drawn > before)) || performance.now() - started >= 2_000) {
                                resolve(performance.now() - started);
                            } else {
                                requestAnimationFrame(poll);
                            }
                        };
                        requestAnimationFrame(poll);
                    });
                },
                { id: target.id, rendererOff: renderers === 'off' }
            )
        );
    }
    return result;
}

async function exerciseTransitions(page: Page, cycles: number): Promise<void> {
    if (cycles === 0) return;
    const before = await slots(page);
    for (let cycle = 0; cycle < cycles; cycle++) {
        await page.evaluate(() => {
            type Snapshot = { id: number };
            const wall = (globalThis as unknown as { multibox: { slots(): Snapshot[]; setRendererEnabled(id: number, enabled: boolean): boolean } }).multibox;
            for (const slot of wall.slots()) wall.setRendererEnabled(slot.id, false);
        });
        await page.waitForFunction(() => {
            const wall = (globalThis as unknown as { multibox: { slots(): Array<{ rendererEnabled?: boolean }> } }).multibox;
            return wall.slots().every(slot => slot.rendererEnabled === false)
                && Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas.game-canvas')).every(canvas => canvas.width === 1 && canvas.height === 1);
        }, undefined, { timeout: 30_000 });
        await page.evaluate(() => {
            type Snapshot = { id: number };
            const wall = (globalThis as unknown as { multibox: { slots(): Snapshot[]; setRendererEnabled(id: number, enabled: boolean): boolean } }).multibox;
            for (const slot of wall.slots()) wall.setRendererEnabled(slot.id, true);
        });
        await page.waitForFunction(() => {
            const wall = (globalThis as unknown as { multibox: { slots(): Array<{ rendererEnabled?: boolean }> } }).multibox;
            return wall.slots().every(slot => slot.rendererEnabled === true)
                && Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas.game-canvas')).every(canvas => canvas.width > 1 && canvas.height > 1);
        }, undefined, { timeout: 120_000 });
    }

    // Last-request-wins regression: cancel an in-flight enable without allowing
    // its completion to turn the renderer back on.
    await page.evaluate(() => {
        const wall = (globalThis as unknown as { multibox: { slots(): Array<{ id: number }>; setRendererEnabled(id: number, enabled: boolean): boolean } }).multibox;
        const id = wall.slots()[0].id;
        wall.setRendererEnabled(id, false);
        wall.setRendererEnabled(id, true);
        wall.setRendererEnabled(id, false);
    });
    await page.waitForFunction(() => (globalThis as unknown as { multibox: { slots(): Array<{ rendererEnabled?: boolean }> } }).multibox.slots()[0]?.rendererEnabled === false);
    await page.evaluate(() => {
        const wall = (globalThis as unknown as { multibox: { slots(): Array<{ id: number }>; setRendererEnabled(id: number, enabled: boolean): boolean } }).multibox;
        wall.setRendererEnabled(wall.slots()[0].id, true);
    });
    await page.waitForFunction(() => (globalThis as unknown as { multibox: { slots(): Array<{ rendererEnabled?: boolean }> } }).multibox.slots()[0]?.rendererEnabled === true, undefined, { timeout: 120_000 });

    await page.evaluate(() => {
        const wall = (globalThis as unknown as { multibox: { slots(): Array<{ id: number }>; move(id: number, toIndex: number): boolean } }).multibox;
        const current = wall.slots();
        if (current.length > 1) {
            const last = current.at(-1)!;
            wall.move(last.id, 0);
            wall.move(last.id, current.length - 1);
        }
    });

    const after = await slots(page);
    if (after.some((slot, index) => slot.streamGeneration !== before[index].streamGeneration)) {
        throw new Error('renderer transition replaced a login stream');
    }
    if (after.some(slot => slot.scriptState !== 'running')) {
        throw new Error('renderer transition interrupted a script');
    }
}

const args = parseArgs(process.argv.slice(2));
const browser = await chromium.launch({
    channel: 'chrome',
    headless: !process.env.HEADED,
    args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']
});

try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.stack ?? String(error)));
    page.on('console', message => {
        if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text());
    });

    const wallUrl = new URL('/multibox.html', args.base);
    await page.goto(wallUrl.href);
    await page.waitForFunction(() => Boolean((globalThis as unknown as { multibox?: unknown }).multibox), undefined, { timeout: 30_000 });

    const accounts = Array.from({ length: args.bots }, (_, index) => ({
        username: `${args.accountPrefix}${String(index + 1).padStart(2, '0')}`,
        password: args.password
    }));
    if (args.renderers === 'off') {
        await page.evaluate(items => {
            for (const account of items) {
                localStorage.setItem(`rs2b0t:${account.username}:rendererEnabled`, '0');
            }
        }, accounts);
    }
    if (args.settings.length > 0) {
        await page.evaluate(({ items, settings }) => {
            for (const account of items) {
                for (const setting of settings) {
                    localStorage.setItem(`rs2b0t:${account.username}:set:${setting.script}:${setting.key}`, setting.value);
                }
            }
        }, { items: accounts, settings: args.settings });
    }
    await page.evaluate(account => {
        (globalThis as unknown as { multibox: { add(account: { username: string; password: string }): void } }).multibox.add(account);
    }, accounts[0]);
    await page.waitForFunction(
        () => {
            const current = (globalThis as unknown as { multibox: { slots(): Array<{ ingame: boolean }> } }).multibox.slots();
            return current.length === 1 && current[0].ingame;
        },
        undefined,
        { timeout: 120_000 }
    );
    await page.evaluate(rest => {
        const wall = (globalThis as unknown as { multibox: { add(account: { username: string; password: string }): void } }).multibox;
        for (const account of rest) wall.add(account);
    }, accounts.slice(1));
    await page.waitForFunction(
        expected => {
            const current = (globalThis as unknown as { multibox: { slots(): Array<{ ingame: boolean }> } }).multibox.slots();
            return current.length === expected && current.every(slot => slot.ingame);
        },
        args.bots,
        { timeout: 300_000 }
    );
    await page.waitForTimeout(1_000);

    await startScript(page, args.script);
    try {
        await page.waitForFunction(
            minimumLoops => {
                const current = (globalThis as unknown as { multibox: { slots(): Array<{ scriptState: string; scriptLoops?: number }> } }).multibox.slots();
                return current.every(slot => slot.scriptState === 'running' && (slot.scriptLoops ?? 0) >= minimumLoops);
            },
            args.requireMovement ? 1 : 3,
            { timeout: args.requireMovement ? 120_000 : 30_000 }
        );
    } catch (error) {
        console.error('script warmup failed', await slots(page), errors);
        throw error;
    }

    await exerciseTransitions(page, args.toggleCycles);

    if (args.renderers === 'off') {
        await page.evaluate(() => {
            type Snapshot = { id: number };
            const wall = (globalThis as unknown as { multibox: { slots(): Snapshot[]; setRendererEnabled(id: number, enabled: boolean): boolean } }).multibox;
            for (const slot of wall.slots()) wall.setRendererEnabled(slot.id, false);
        });
    }

    console.log(`${args.bots} embedded clients ingame; '${args.script}' active`);
    await page.waitForTimeout(20_000);
    await page.evaluate(() => {
        const state = globalThis as unknown as { __multiboxLag?: number[]; __multiboxLagTimer?: number };
        state.__multiboxLag = [];
        let previous = performance.now();
        state.__multiboxLagTimer = window.setInterval(() => {
            const now = performance.now();
            state.__multiboxLag!.push(Math.max(0, now - previous - 20));
            previous = now;
        }, 20);
    });

    const browserSession = await browser.newBrowserCDPSession();
    const pageSession = await page.context().newCDPSession(page);
    await pageSession.send('Performance.enable');
    const beforeProcesses = await processInfo(browserSession);
    const beforeSlots = await slots(page);
    const beforeMetrics = (await pageSession.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> };
    const started = performance.now();
    await page.waitForTimeout(args.durationMs);
    const elapsed = (performance.now() - started) / 1000;
    const afterProcesses = await processInfo(browserSession);
    const afterSlots = await slots(page);
    const afterMetrics = (await pageSession.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> };
    const { targetInfos } = (await browserSession.send('Target.getTargets')) as { targetInfos: Array<{ type: string }> };
    const lag = await page.evaluate(() => {
        const state = globalThis as unknown as { __multiboxLag?: number[]; __multiboxLagTimer?: number };
        if (state.__multiboxLagTimer !== undefined) window.clearInterval(state.__multiboxLagTimer);
        return state.__multiboxLag ?? [];
    });

    const focus = args.renderers === 'off' ? [] : await focusLatencies(page, afterSlots, args.renderers);
    const memory = processMemory(afterProcesses);
    const taskBefore = beforeMetrics.metrics.find(metric => metric.name === 'TaskDuration')?.value ?? 0;
    const taskAfter = afterMetrics.metrics.find(metric => metric.name === 'TaskDuration')?.value ?? 0;
    const slotDeltas = afterSlots.map((after, index) => ({
        username: after.username,
        ingame: after.ingame,
        scriptState: after.scriptState,
        gameClockHz: round((after.loopCycle - beforeSlots[index].loopCycle) / elapsed),
        pumpFps: after.clientFps,
        drawFps: round((after.drawn - beforeSlots[index].drawn) / elapsed),
        tilesMoved: beforeSlots[index].tile && after.tile && beforeSlots[index].tile!.level === after.tile.level
            ? Math.max(Math.abs(after.tile.x - beforeSlots[index].tile!.x), Math.abs(after.tile.z - beforeSlots[index].tile!.z))
            : 0,
        tickRate: round((after.tickCount - beforeSlots[index].tickCount) / elapsed),
        scriptLoops: after.scriptLoops - beforeSlots[index].scriptLoops,
        tickMeanMs: round(after.tickMeanMs),
        clientFps: after.clientFps,
        rendererEnabled: after.rendererEnabled,
        streamGeneration: after.streamGeneration
    }));
    const gameClockHz = slotDeltas.map(slot => slot.gameClockHz);
    const pumpFps = slotDeltas.map(slot => slot.pumpFps);
    const allIngame = afterSlots.every(slot => slot.ingame);
    const allScriptsRunning = afterSlots.every(slot => slot.scriptState === 'running');
    if (!allIngame) errors.push(`${afterSlots.filter(slot => !slot.ingame).length} clients were not in-game at the end`);
    if (!allScriptsRunning) errors.push(`${afterSlots.filter(slot => slot.scriptState !== 'running').length} scripts were not running at the end`);
    const expectedRenderer = args.renderers === 'on';
    if (afterSlots.some(slot => slot.rendererEnabled !== expectedRenderer)) errors.push('renderer state did not match the requested mode');
    if (afterSlots.some(slot => slot.streamGeneration !== 1)) errors.push('one or more clients replaced their login stream');
    if (slotDeltas.some(slot => slot.gameClockHz < 45 || slot.gameClockHz > 55)) errors.push('logical game clock left the 45-55 Hz tolerance');
    if (slotDeltas.some(slot => slot.tickRate < 1)) errors.push('one or more clients stopped receiving server ticks');
    if (slotDeltas.some(slot => slot.scriptLoops < 1)) errors.push('one or more scripts made no progress during measurement');
    if (args.requireMovement && slotDeltas.some(slot => slot.tilesMoved < 1)) errors.push('one or more clients made no movement progress');
    const result = {
        label: args.label,
        mode: 'embedded',
        renderers: args.renderers,
        toggleCycles: args.toggleCycles,
        script: args.script,
        settings: args.settings,
        base: args.base,
        bots: args.bots,
        durationSeconds: round(elapsed),
        chrome: {
            cpuCores: round((cpuSeconds(afterProcesses) - cpuSeconds(beforeProcesses)) / elapsed),
            taskCores: round((taskAfter - taskBefore) / elapsed),
            pssMiB: memory.pssMiB,
            rssMiB: memory.rssMiB,
            measuredProcesses: memory.measured,
            processTypes: counts(afterProcesses),
            targetTypes: counts(targetInfos)
        },
        responsivenessMs: {
            eventLoopP50: round(percentile(lag, 0.5)),
            eventLoopP95: round(percentile(lag, 0.95)),
            eventLoopP99: round(percentile(lag, 0.99)),
            eventLoopMax: round(Math.max(0, ...lag)),
            focusP50: round(percentile(focus, 0.5)),
            focusP95: round(percentile(focus, 0.95)),
            focusMax: round(Math.max(0, ...focus))
        },
        gameClockHz: {
            min: round(Math.min(...gameClockHz)),
            median: round(percentile(gameClockHz, 0.5)),
            max: round(Math.max(...gameClockHz))
        },
        clientPumpFps: {
            min: round(Math.min(...pumpFps)),
            median: round(percentile(pumpFps, 0.5)),
            max: round(Math.max(...pumpFps))
        },
        fleet: {
            allIngame,
            allScriptsRunning,
            minScriptLoops: Math.min(...slotDeltas.map(slot => slot.scriptLoops))
        },
        slots: slotDeltas,
        errors
    };

    mkdirSync('out', { recursive: true });
    const output = `out/multibox-perf-${args.label}`;
    await page.screenshot({ path: `${output}.png`, fullPage: true });
    await Bun.write(`${output}.json`, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
    if (errors.length > 0) process.exitCode = 1;
} finally {
    await browser.close();
}
