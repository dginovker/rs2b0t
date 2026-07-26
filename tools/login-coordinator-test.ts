// Real-browser regression for GitHub #63. Run a production-mode local server
// with NODE_WS_ONDEMAND=true, deploy the client, then execute this file against
// its /multibox.html page.
import { chromium, type ConsoleMessage } from 'playwright-core';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';

interface FrameState {
    username: string;
    ready: boolean;
    ingame: boolean;
    sceneState: number;
    loginMessage: string;
    loopCycle: number;
}

interface Args {
    base: string;
    control: boolean;
    count: number;
    screenshot: string;
}

function fail(message: string): never {
    throw new Error(`FAIL: ${message}`);
}

function parseArgs(argv: string[]): Args {
    let base = 'http://localhost:8890';
    let control = false;
    let count = 9;
    let screenshot = '/tmp/rs2b0t-login-coordinator.png';
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--base' && argv[i + 1]) base = argv[++i];
        else if (argv[i] === '--count' && argv[i + 1]) count = Number(argv[++i]);
        else if (argv[i] === '--screenshot' && argv[i + 1]) screenshot = argv[++i];
        else if (argv[i] === '--control') control = true;
    }
    if (!Number.isSafeInteger(count) || count < 5 || count > 20) {
        fail('--count must be an integer from 5 through 20');
    }
    return { base: base.replace(/\/$/, ''), control, count, screenshot };
}

function resolveChromium(): string {
    if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
    const cache = join(process.env.HOME ?? '', '.cache/ms-playwright');
    for (const pattern of ['chromium-*/chrome-linux*/chrome', 'chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium']) {
        const matches = [...new Glob(pattern).scanSync(cache)].sort().reverse();
        if (matches.length > 0) return join(cache, matches[0]);
    }
    fail('Chromium not found; set CHROME_BIN or install Playwright Chromium');
}

function frameStates(): FrameState[] {
    return Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe.mbx-frame')).map(frame => {
        const api = (
            frame.contentWindow as unknown as {
                rs2b0t?: {
                    client: { constructor: { loopCycle: number }; ingame: boolean; sceneState: number; loginMes1: string };
                };
            } | null
        )?.rs2b0t;
        return {
            username: frame.title,
            ready: Boolean(api),
            ingame: api?.client.ingame ?? false,
            sceneState: api?.client.sceneState ?? 0,
            loginMessage: api?.client.loginMes1 ?? '',
            loopCycle: api?.client.constructor.loopCycle ?? 0
        };
    });
}

const args = parseArgs(process.argv.slice(2));
const browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1800 } });
let startedAt = Date.now();
const attempts: Array<{ elapsedMs: number; text: string }> = [];
const throttles: Array<{ elapsedMs: number; text: string }> = [];

function capture(message: ConsoleMessage): void {
    const text = message.text();
    const elapsedMs = Date.now() - startedAt;
    if (text.includes('auto-login: attempt')) attempts.push({ elapsedMs, text });
    if (text.includes('rate limited by server')) throttles.push({ elapsedMs, text });
}
page.on('console', capture);
page.on('pageerror', error => console.error(`browser page error: ${error.message}`));
page.on('requestfailed', request => {
    if (!request.url().endsWith('/__rs2b0t/resources')) {
        console.error(`browser request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`);
    }
});

try {
    // One cold client populates the origin's cache before several iframes parse it
    // concurrently. This keeps the test focused on login scheduling, not downloads.
    await page.goto(`${args.base}/bot.html?autorelogin=0&run=0`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page
        .waitForFunction(
            () => {
                const api = (globalThis as unknown as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t;
                return (api?.client.constructor.loopCycle ?? 0) > 10;
            },
            undefined,
            { timeout: 180000 }
        )
        .catch(async error => {
            const diagnostic = await page.evaluate(() => {
                const client = (globalThis as unknown as { rs2b0t?: { client: Record<string, unknown> & { constructor: { loopCycle: number } } } }).rs2b0t?.client;
                return {
                    loopCycle: client?.constructor.loopCycle ?? 0,
                    errorLoading: client?.errorLoading,
                    errorMessage: client?.errorMessage,
                    lastProgressMessage: client?.lastProgressMessage,
                    lastProgressPercent: client?.lastProgressPercent,
                    resources: performance
                        .getEntriesByType('resource')
                        .map(entry => entry.name)
                        .slice(-10)
                };
            });
            fail(`cache warm-up failed (${error instanceof Error ? error.message : String(error)}): ${JSON.stringify(diagnostic)}`);
        });

    await page.goto(`${args.base}/multibox.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => Boolean((globalThis as Record<string, unknown>).multibox), undefined, { timeout: 30000 });
    startedAt = Date.now();

    if (args.control) {
        await page.evaluate(() => {
            const wall = (globalThis as unknown as { multibox: { controller: { loginCoordination: unknown } } }).multibox;
            wall.controller.loginCoordination = null;
        });
    }

    const tag = Date.now().toString(36).slice(-5);
    const accounts = Array.from({ length: args.count }, (_, index) => ({
        username: `q63${tag}${String.fromCharCode(97 + index)}`,
        password: 'test'
    }));
    await page.evaluate(profiles => {
        const wall = (globalThis as unknown as { multibox: { add(account: { username: string; password: string }): unknown } }).multibox;
        for (const profile of profiles) wall.add(profile);
    }, accounts);

    const observedMessages = new Set<string>();
    let states: FrameState[] = [];
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        states = await page.evaluate(frameStates);
        for (const state of states) {
            if (/^Login (?:attempts|limit) exceeded/.test(state.loginMessage)) {
                observedMessages.add(`${state.username}: ${state.loginMessage}`);
            }
        }
        const ingameCount = states.filter(s => s.ingame && s.sceneState === 2).length;
        if (args.control ? observedMessages.size > 0 && ingameCount >= 4 : states.length === args.count && ingameCount === args.count) break;
        await page.waitForTimeout(100);
    }

    const elapsedMs = Date.now() - startedAt;
    if (args.control) {
        if (observedMessages.size === 0) fail(`uncoordinated control did not hit the production device limit: ${JSON.stringify(states)}`);
        const ingameCount = states.filter(s => s.ingame && s.sceneState === 2).length;
        if (ingameCount < 4) fail(`control did not prove accepted logins before throttling: ${JSON.stringify(states)}`);
        console.log(`PASS control: ${ingameCount} accepted, then server rejected the uncoordinated burst (${[...observedMessages].join(', ')})`);
        await page.screenshot({ path: args.screenshot, fullPage: true });
        process.exitCode = 0;
    } else {
        if (states.length !== args.count || !states.every(s => s.ingame && s.sceneState === 2)) {
            fail(`only ${states.filter(s => s.ingame && s.sceneState === 2).length}/${args.count} clients reached ingame: ${JSON.stringify(states)}`);
        }
        if (observedMessages.size > 0 || throttles.length > 0) {
            fail(`coordinated clients still hit a server limit: ${[...observedMessages, ...throttles.map(x => x.text)].join(', ')}`);
        }
        if (attempts.length !== args.count || attempts.some(entry => !entry.text.includes('attempt 1/15'))) {
            fail(`expected one first-attempt login per client, got ${JSON.stringify(attempts)}`);
        }

        const attemptTimes = attempts.map(entry => entry.elapsedMs);
        for (let index = 1; index < attemptTimes.length; index++) {
            const expectedGap = index % 4 === 0 ? 15000 : 800;
            const gap = attemptTimes[index] - attemptTimes[index - 1];
            if (gap < expectedGap) fail(`attempt ${index + 1} followed too quickly (${gap}ms; need ${expectedGap}ms)`);
        }

        // Let the wall's one-second status renderer turn every rail dot green.
        await page.waitForTimeout(1500);
        await page.evaluate(
            ({ count, elapsed }) => {
                const proof = document.createElement('aside');
                proof.id = 'issue-63-proof';
                proof.textContent = `Issue #63 E2E · ${count}/${count} ingame · 0 throttles · ${(elapsed / 1000).toFixed(1)}s`;
                Object.assign(proof.style, {
                    position: 'fixed',
                    left: '20px',
                    top: '20px',
                    zIndex: '100000',
                    padding: '14px 18px',
                    border: '2px solid #51d88a',
                    borderRadius: '8px',
                    color: '#dcffe9',
                    background: '#10271b',
                    font: 'bold 18px monospace',
                    boxShadow: '0 4px 18px #000a'
                });
                document.body.appendChild(proof);
            },
            { count: args.count, elapsed: elapsedMs }
        );
        await page.screenshot({ path: args.screenshot, fullPage: true });
        console.log(`PASS: ${args.count}/${args.count} clients ingame, zero throttles, ${attempts.length} first-attempt logins in ${(elapsedMs / 1000).toFixed(1)}s`);
        console.log(`attempt timeline: ${attemptTimes.map(ms => (ms / 1000).toFixed(1)).join(', ')} seconds`);
        console.log(`screenshot: ${args.screenshot}`);
    }
} finally {
    await browser.close();
}
