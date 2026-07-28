import { actions, reader } from './adapter/ClientAdapter.js';
import BotClient from './BotClient.js';
import { BotHost } from './BotHost.js';
import { Navigator } from './nav/Navigator.js';
import { AutoRelogin } from './runtime/AutoRelogin.js';
import { configureBoxId } from './runtime/box.js';
import type { LoginCoordination } from './runtime/LoginCoordination.js';
import { RunManager } from './runtime/RunManager.js';
import { ScriptRegistry } from './runtime/ScriptRegistry.js';
import { ScriptRunner } from './runtime/ScriptRunner.js';
import { SettingsStore, type SettingDef } from './runtime/Settings.js';
import { StallGuard } from './runtime/StallGuard.js';
import { WelcomeDismisser } from './runtime/WelcomeScreen.js';
import './scripts/index.js';

export interface HeadlessBotOptions {
    box: string;
    username: string;
    password: string;
    nodeid?: number;
    lowmem?: boolean;
    members?: boolean;
    autoLogin?: boolean;
    loginCoordination?: LoginCoordination | null;
}

export interface HeadlessBot {
    readonly client: BotClient;
    readonly host: typeof BotHost;
    readonly reader: typeof reader;
    readonly actions: typeof actions;
    readonly runner: typeof ScriptRunner;
    readonly registry: typeof ScriptRegistry;
    setCredentials(username: string, password: string): void;
    setAutoLogin(on: boolean): void;
    setLoginCoordination(coordination: LoginCoordination | null): void;
    startScript(name: string): void;
    pauseScript(): void;
    resumeScript(): void;
    stopScript(): void;
    scripts(): Array<{ name: string; description: string; category?: string; settings: Record<string, SettingDef> }>;
    setting(name: string, key: string): string;
    saveSetting(name: string, key: string, value: string): void;
    snapshot(): {
        ingame: boolean;
        player: string | null;
        tile: { x: number; z: number; level: number } | null;
        loopCycle: number;
        clientFps: number;
        tickCount: number;
        tickMeanMs: number;
        scriptState: string;
        scriptName: string | null;
        scriptLoops: number;
        log: Array<{ time: number; level: string; msg: string }>;
    };
    destroy(): void;
}

/**
 * Create a graphics-free client in the current JS realm. MultiBox imports this
 * bundle with a unique query string per account; that gives every account an
 * isolated copy of module singletons without the cost of another iframe.
 */
export function createHeadlessBot(options: HeadlessBotOptions): HeadlessBot {
    configureBoxId(options.box);
    const root = globalThis as typeof globalThis & { __rs2b0tAssetBase?: string; __rs2b0tDisableAudio?: boolean };
    root.__rs2b0tAssetBase = new URL('../', import.meta.url).href;
    root.__rs2b0tDisableAudio = true;

    const client = new BotClient(options.nodeid ?? 10, options.lowmem ?? true, options.members ?? true, true);

    AutoRelogin.setCredentials(options.username, options.password);
    AutoRelogin.setLoginCoordination(options.loginCoordination ?? null);
    AutoRelogin.enable(options.autoLogin ?? true);
    StallGuard.enable();
    WelcomeDismisser.enable();
    RunManager.enable();

    const activate = (): void => client.activateHeadlessContext();
    const syncScriptActivity = (): void => client.setShellAutomationActive(ScriptRunner.state === 'running');

    return {
        client,
        host: BotHost,
        reader,
        actions,
        runner: ScriptRunner,
        registry: ScriptRegistry,
        setCredentials: (username, password) => {
            activate();
            AutoRelogin.setCredentials(username, password);
        },
        setAutoLogin: on => AutoRelogin.setAutoLogin(on),
        setLoginCoordination: coordination => AutoRelogin.setLoginCoordination(coordination),
        startScript: name => {
            activate();
            const meta = ScriptRegistry.get(name);
            if (!meta) {
                throw new Error(`Unknown script '${name}'`);
            }
            ScriptRunner.start(meta);
            syncScriptActivity();
        },
        pauseScript: () => {
            ScriptRunner.pause();
            syncScriptActivity();
        },
        resumeScript: () => {
            ScriptRunner.resume();
            syncScriptActivity();
        },
        stopScript: () => {
            ScriptRunner.stop();
            syncScriptActivity();
        },
        scripts: () =>
            ScriptRegistry.list().map(meta => ({
                name: meta.name,
                description: meta.description,
                category: meta.category,
                settings: meta.settingsSchema ?? {}
            })),
        setting: (name, key) => {
            const def = ScriptRegistry.get(name)?.settingsSchema?.[key];
            return def ? SettingsStore.displayString(name, key, def) : '';
        },
        saveSetting: (name, key, value) => SettingsStore.save(name, key, value),
        snapshot: () => {
            activate();
            syncScriptActivity();
            const ctx = ScriptRunner.ctx;
            return {
                ingame: reader.ingame(),
                player: reader.localPlayerName(),
                tile: reader.worldTile(),
                loopCycle: (client.constructor as unknown as { loopCycle: number }).loopCycle,
                clientFps: client.pumpFps,
                tickCount: BotHost.tickCount,
                tickMeanMs: BotHost.tickMeanMs,
                scriptState: ScriptRunner.state,
                scriptName: ScriptRunner.meta?.name ?? null,
                scriptLoops: ctx?.loopCount ?? 0,
                log: ctx?.log.slice(-200) ?? []
            };
        },
        destroy: () => {
            ScriptRunner.stop();
            syncScriptActivity();
            Navigator.stop();
            client.closeHeadless();
        }
    };
}
