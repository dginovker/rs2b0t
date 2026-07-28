import { mkdirSync, readFileSync } from 'node:fs';

import { chromium, type CDPSession, type Page } from 'playwright-core';

type Mode = 'visual' | 'headless';

interface Args {
    base: string;
    bots: number;
    durationMs: number;
    label: string;
    accountPrefix: string;
    password: string;
    mode: Mode;
    script: string;
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
    loopCycle: number;
    drawn: number;
    tickCount: number;
    tickMeanMs: number;
    clientFps: number;
    scriptState: string;
    scriptLoops: number;
}

function parseArgs(argv: string[]): Args {
    const args: Args = {
        base: 'http://localhost:8890',
        bots: 20,
        durationMs: 60_000,
        label: 'run',
        accountPrefix: 'issue99p',
        password: 'test',
        mode: 'headless',
        script: 'QuestDashboard'
    };
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        const value = argv[i + 1];
        if (key === '--base' && value) args.base = value;
        else if (key === '--bots' && value) args.bots = Number(value);
        else if (key === '--seconds' && value) args.durationMs = Number(value) * 1000;
        else if (key === '--label' && value) args.label = value;
        else if (key === '--account-prefix' && value) args.accountPrefix = value;
        else if (key === '--password' && value) args.password = value;
        else if (key === '--mode' && (value === 'visual' || value === 'headless')) args.mode = value;
        else if (key === '--script' && value) args.script = value;
        else continue;
        i++;
    }
    if (!Number.isSafeInteger(args.bots) || args.bots < 1 || args.bots > 100) {
        throw new RangeError('--bots must be an integer from 1 to 100');
    }
    if (!Number.isFinite(args.durationMs) || args.durationMs < 10_000) {
        throw new RangeError('--seconds must be at least 10');
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

async function slots(page: Page, mode: Mode): Promise<SlotSample[]> {
    return page.evaluate(headless => {
        type Snapshot = {
            id: number;
            username: string;
            focused: boolean;
            ingame: boolean;
            loopCycle: number;
            drawn: number;
            tickCount?: number;
            tickMeanMs?: number;
            clientFps?: number;
            scriptState: string;
            scriptLoops?: number;
        };
        type Runtime = {
            client: { constructor: { loopCycle: number }; fps: number };
            host: { tickCount: number; tickMeanMs: number };
            runner: { state: string; ctx: { loopCount: number } | null };
        };
        const wall = (globalThis as unknown as { multibox: { slots(): Snapshot[] } }).multibox;
        const snapshots = wall.slots();
        const frames = headless ? [] : Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
        return snapshots.map((slot, index) => {
            const runtime = (frames[index]?.contentWindow as unknown as { rs2b0t?: Runtime } | null)?.rs2b0t;
            return {
                ...slot,
                loopCycle: runtime?.client.constructor.loopCycle ?? slot.loopCycle,
                tickCount: runtime?.host.tickCount ?? slot.tickCount ?? 0,
                tickMeanMs: runtime?.host.tickMeanMs ?? slot.tickMeanMs ?? 0,
                clientFps: runtime?.client.fps ?? slot.clientFps ?? 0,
                scriptState: runtime?.runner.state ?? slot.scriptState,
                scriptLoops: runtime?.runner.ctx?.loopCount ?? slot.scriptLoops ?? 0
            };
        });
    }, mode === 'headless');
}

async function startScript(page: Page, mode: Mode, script: string): Promise<void> {
    if (mode === 'headless') {
        const started = await page.evaluate(name => {
            const panes = Array.from(document.querySelectorAll<HTMLElement>('.mbx-headless-pane'));
            for (const pane of panes) {
                const select = pane.querySelector<HTMLSelectElement>('.mbx-headless-select');
                const button = pane.querySelector<HTMLButtonElement>('.mbx-headless-start');
                if (!select || !button || !Array.from(select.options).some(option => option.value === name)) {
                    return false;
                }
                select.value = name;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                button.click();
            }
            return panes.length > 0;
        }, script);
        if (!started) throw new Error(`headless script '${script}' was not available in every slot`);
    } else {
        const started = await page.evaluate(name => {
            type Runtime = { registry: { get(name: string): unknown }; runner: { start(script: unknown): void } };
            const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
            for (const frame of frames) {
                const runtime = (frame.contentWindow as unknown as { rs2b0t?: Runtime } | null)?.rs2b0t;
                const selected = runtime?.registry.get(name);
                if (!runtime || !selected) return false;
                runtime.runner.start(selected);
            }
            return frames.length > 0;
        }, script);
        if (!started) throw new Error(`visual script '${script}' was not available in every slot`);
    }
}

async function focusLatencies(page: Page, samples: SlotSample[], mode: Mode): Promise<number[]> {
    const result: number[] = [];
    for (let i = 0; i < Math.min(samples.length * 2, 40); i++) {
        const target = samples[i % samples.length];
        result.push(
            await page.evaluate(
                async ({ id, headless }) => {
                    type Snapshot = { id: number; focused: boolean; drawn: number };
                    const wall = (globalThis as unknown as { multibox: { focus(id: number): void; slots(): Snapshot[] } }).multibox;
                    const before = wall.slots().find(slot => slot.id === id)?.drawn ?? 0;
                    const started = performance.now();
                    wall.focus(id);
                    return await new Promise<number>(resolve => {
                        const poll = (): void => {
                            const slot = wall.slots().find(item => item.id === id);
                            const paneVisible = !headless || Array.from(document.querySelectorAll<HTMLElement>('.mbx-headless-pane')).some(pane => !pane.hidden);
                            if ((slot?.focused && paneVisible && (headless || slot.drawn > before)) || performance.now() - started >= 2_000) {
                                resolve(performance.now() - started);
                            } else {
                                requestAnimationFrame(poll);
                            }
                        };
                        requestAnimationFrame(poll);
                    });
                },
                { id: target.id, headless: mode === 'headless' }
            )
        );
    }
    return result;
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
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => {
        if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text());
    });

    const wallUrl = new URL('/multibox.html', args.base);
    if (args.mode === 'headless') wallUrl.searchParams.set('headless', '1');
    await page.goto(wallUrl.href);
    await page.waitForFunction(() => Boolean((globalThis as unknown as { multibox?: unknown }).multibox), undefined, { timeout: 30_000 });

    const accounts = Array.from({ length: args.bots }, (_, index) => ({
        username: `${args.accountPrefix}${String(index + 1).padStart(2, '0')}`,
        password: args.password
    }));
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

    await startScript(page, args.mode, args.script);
    await page.waitForFunction(
        headless => {
            const current = (globalThis as unknown as { multibox: { slots(): Array<{ scriptState: string; scriptLoops?: number }> } }).multibox.slots();
            if (headless) return current.every(slot => slot.scriptState === 'running' && (slot.scriptLoops ?? 0) >= 3);
            const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
            return (
                frames.length === current.length &&
                frames.every(frame => {
                    const runner = (frame.contentWindow as unknown as { rs2b0t?: { runner: { state: string; ctx: { loopCount: number } | null } } } | null)?.rs2b0t?.runner;
                    return runner?.state === 'running' && (runner.ctx?.loopCount ?? 0) >= 3;
                })
            );
        },
        args.mode === 'headless',
        { timeout: 30_000 }
    );

    console.log(`${args.bots} ${args.mode} clients ingame; '${args.script}' active`);
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
    const beforeSlots = await slots(page, args.mode);
    const beforeMetrics = (await pageSession.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> };
    const started = performance.now();
    await page.waitForTimeout(args.durationMs);
    const elapsed = (performance.now() - started) / 1000;
    const afterProcesses = await processInfo(browserSession);
    const afterSlots = await slots(page, args.mode);
    const afterMetrics = (await pageSession.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> };
    const { targetInfos } = (await browserSession.send('Target.getTargets')) as { targetInfos: Array<{ type: string }> };
    const lag = await page.evaluate(() => {
        const state = globalThis as unknown as { __multiboxLag?: number[]; __multiboxLagTimer?: number };
        if (state.__multiboxLagTimer !== undefined) window.clearInterval(state.__multiboxLagTimer);
        return state.__multiboxLag ?? [];
    });

    const focus = await focusLatencies(page, afterSlots, args.mode);
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
        tickRate: round((after.tickCount - beforeSlots[index].tickCount) / elapsed),
        scriptLoops: after.scriptLoops - beforeSlots[index].scriptLoops,
        tickMeanMs: round(after.tickMeanMs),
        clientFps: after.clientFps
    }));
    const gameClockHz = slotDeltas.map(slot => slot.gameClockHz);
    const pumpFps = slotDeltas.map(slot => slot.pumpFps);
    const allIngame = afterSlots.every(slot => slot.ingame);
    const allScriptsRunning = afterSlots.every(slot => slot.scriptState === 'running');
    if (!allIngame) errors.push(`${afterSlots.filter(slot => !slot.ingame).length} clients were not in-game at the end`);
    if (!allScriptsRunning) errors.push(`${afterSlots.filter(slot => slot.scriptState !== 'running').length} scripts were not running at the end`);
    const result = {
        label: args.label,
        mode: args.mode,
        script: args.script,
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
