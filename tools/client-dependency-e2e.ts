import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { boot, bringUpOffIsland, fail, launchBrowser, login, startFromLibrary, type } from './lib/harness.js';

const base = process.argv[2] ?? 'http://localhost:19660';
const screenshot = resolve(process.argv[3] ?? 'docs/e2e/issue-86-client-dependency.png');
const username = `size${Date.now().toString(36).slice(-7)}`.slice(0, 12);
mkdirSync(dirname(screenshot), { recursive: true });

interface Snapshot {
    state: string;
    loops: number;
    combatXp: number;
    buried: number;
    tile: { x: number; z: number; level: number } | null;
    log: string[];
}

interface TrafficProbe {
    receivedBytes: number;
    sentBytes: number;
    messages: number;
}

const browser = await launchBrowser();
try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(String(error)));

    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, username))) {
        fail(`${username}: initial login failed`);
    }
    await bringUpOffIsland(page, { user: username, typeWaitMs: 900 });
    await page.evaluate(() => {
        const probe = { receivedBytes: 0, sentBytes: 0, messages: 0 };
        const channel = new BroadcastChannel('rs2b0t:traffic:v1');
        channel.onmessage = ({ data }) => {
            if (data?.type === 'rs2b0t:traffic' && data.status === 'available') {
                probe.receivedBytes += data.receivedBytes;
                probe.sentBytes += data.sentBytes;
                probe.messages++;
            }
        };
        (globalThis as typeof globalThis & { __issue86Traffic?: TrafficProbe }).__issue86Traffic = probe;
    });
    await type(page, '::tele 0,50,51,32,34', 1200);
    await page.waitForFunction(() => {
        const tile = (globalThis as never as {
            rs2b0t: { reader: { worldTile(): { x: number; z: number; level: number } | null } };
        }).rs2b0t.reader.worldTile();
        return tile !== null && tile.x >= 3228 && tile.x <= 3236 && tile.z >= 3294 && tile.z <= 3302;
    }, undefined, { timeout: 12_000 });

    await startFromLibrary(page, 'Combat', 'ChickenKiller');
    const combatStart = await page.evaluate(() => {
        const api = (globalThis as never as {
            __rs2b0t: { Skills: { xp(name: string): number } };
        }).__rs2b0t;
        return ['attack', 'strength', 'defence', 'hitpoints'].reduce((sum, skill) => sum + api.Skills.xp(skill), 0);
    });
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    const sample = (): Promise<Snapshot> => page.evaluate(() => {
        const root = globalThis as never as {
            __rs2b0t: { Skills: { xp(name: string): number } };
            rs2b0t: {
                reader: { worldTile(): { x: number; z: number; level: number } | null };
                runner: { state: string; ctx: { loopCount: number; log: { msg: string }[] } | null };
            };
        };
        const log = root.rs2b0t.runner.ctx?.log.map(line => line.msg) ?? [];
        return {
            state: root.rs2b0t.runner.state,
            loops: root.rs2b0t.runner.ctx?.loopCount ?? 0,
            combatXp: ['attack', 'strength', 'defence', 'hitpoints'].reduce((sum, skill) => sum + root.__rs2b0t.Skills.xp(skill), 0),
            buried: log.filter(line => line === 'buried bones').length,
            tile: root.rs2b0t.reader.worldTile(),
            log
        };
    });

    const deadline = Date.now() + 120_000;
    let snapshot = await sample();
    while (Date.now() < deadline) {
        await page.waitForTimeout(5000);
        snapshot = await sample();
        console.log(`state=${snapshot.state} loops=${snapshot.loops} combat+${snapshot.combatXp - combatStart} buried=${snapshot.buried}`);
        if (snapshot.state === 'crashed' || snapshot.state === 'stopped') {
            break;
        }
    }

    const traffic = await page.evaluate(() => {
        const probe = (globalThis as typeof globalThis & { __issue86Traffic: TrafficProbe }).__issue86Traffic;
        return {
            receivedBytes: probe.receivedBytes,
            sentBytes: probe.sentBytes,
            messages: probe.messages
        };
    });
    await page.screenshot({ path: screenshot, fullPage: true });

    if (pageErrors.length > 0) {
        fail(`browser page errors: ${pageErrors.join(' | ')}`);
    }
    if (snapshot.state !== 'running' || snapshot.loops < 10 || snapshot.combatXp <= combatStart || snapshot.buried < 1) {
        fail(`bot did not complete a combat cycle: ${JSON.stringify(snapshot)}`);
    }
    if (traffic.messages < 2 || traffic.receivedBytes <= 0 || traffic.sentBytes <= 0) {
        fail(`client traffic meter did not report both directions: ${JSON.stringify(traffic)}`);
    }

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.waitForFunction(() => (globalThis as never as {
        rs2b0t: { runner: { state: string } };
    }).rs2b0t.runner.state === 'stopped', undefined, { timeout: 10_000 });

    console.log(JSON.stringify({
        result: 'PASS',
        username,
        loops: snapshot.loops,
        combatXp: snapshot.combatXp - combatStart,
        buried: snapshot.buried,
        traffic,
        screenshot
    }, null, 2));
} finally {
    await browser.close();
}
