import { actions, reader } from './adapter/ClientAdapter.js';
import BotClient from './BotClient.js';
import { BotHost } from './BotHost.js';
import { Navigator } from './nav/Navigator.js';
import { installPaintInput } from './ui/PaintInput.js';
import Overlay from './ui/Overlay.js';
import BotPanel from './ui/BotPanel.js';
import { AutoRelogin } from './runtime/AutoRelogin.js';
import { configureBoxId } from './runtime/box.js';
import type { LoginCoordination } from './runtime/LoginCoordination.js';
import { RenderGate, type RenderMode } from './runtime/RenderGate.js';
import { RunManager } from './runtime/RunManager.js';
import { ScriptRegistry } from './runtime/ScriptRegistry.js';
import { ScriptRunner } from './runtime/ScriptRunner.js';
import { SettingsStore, type SettingDef } from './runtime/Settings.js';
import { StallGuard } from './runtime/StallGuard.js';
import { WelcomeDismisser } from './runtime/WelcomeScreen.js';
import './scripts/index.js';

export interface EmbeddedBotOptions {
    box: string;
    username: string;
    password: string;
    canvas: HTMLCanvasElement;
    overlay: HTMLCanvasElement;
    panel: HTMLElement;
    presentation: HTMLElement;
    nodeid?: number;
    lowmem?: boolean;
    members?: boolean;
    autoLogin?: boolean;
    loginCoordination?: LoginCoordination | null;
}

export interface EmbeddedBot {
    readonly client: BotClient;
    readonly host: typeof BotHost;
    readonly reader: typeof reader;
    readonly actions: typeof actions;
    readonly runner: typeof ScriptRunner;
    readonly registry: typeof ScriptRegistry;
    readonly renderGate: typeof RenderGate;
    setRenderMode(mode: RenderMode): void;
    setRendererEnabled(enabled: boolean): Promise<void>;
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
        rendererEnabled: boolean;
        streamGeneration: number;
        log: Array<{ time: number; level: string; msg: string }>;
    };
    destroy(): void;
}

/**
 * Create a complete bot UI in the MultiBox realm. Each dynamic module instance
 * keeps bot runtime singletons private, while the large client/config module is
 * shared by every account instead of being parsed in one iframe per bot.
 */
export function createEmbeddedBot(options: EmbeddedBotOptions): EmbeddedBot {
    configureBoxId(options.box);
    const root = globalThis as typeof globalThis & { __rs2b0tAssetBase?: string; __rs2b0tDisableAudio?: boolean };
    root.__rs2b0tAssetBase = new URL('../', import.meta.url).href;
    root.__rs2b0tDisableAudio = true;

    const client = new BotClient(options.nodeid ?? 10, options.lowmem ?? true, options.members ?? true, options.canvas, true);

    const setRendererPresentation = (enabled: boolean): void => {
        options.presentation.classList.toggle('rs2b0t-renderer-off', !enabled);
        options.overlay.width = enabled ? 765 : 1;
        options.overlay.height = enabled ? 503 : 1;
    };
    const requestRenderer = async (enabled: boolean): Promise<void> => {
        if (!enabled || client.rendererEnabled) {
            setRendererPresentation(enabled);
        }
        await client.setRendererEnabled(enabled);
        setRendererPresentation(client.rendererEnabled);
    };

    new BotPanel(options.panel, BotHost, {
        enabled: () => client.rendererEnabled,
        setEnabled: requestRenderer
    });
    new Overlay(options.overlay);
    installPaintInput(options.canvas);

    AutoRelogin.setCredentials(options.username, options.password);
    AutoRelogin.setLoginCoordination(options.loginCoordination ?? null);
    AutoRelogin.enable(options.autoLogin ?? true);
    StallGuard.enable();
    WelcomeDismisser.enable();
    RunManager.enable();

    const activate = (): void => client.activateSharedContext();
    const syncScriptActivity = (): void => client.setAutomationActive(ScriptRunner.state === 'running');

    return {
        client,
        host: BotHost,
        reader,
        actions,
        runner: ScriptRunner,
        registry: ScriptRegistry,
        renderGate: RenderGate,
        setRenderMode: mode => {
            RenderGate.setMode(mode);
            client.setRendererFocused(mode === 'focused');
        },
        setRendererEnabled: requestRenderer,
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
                rendererEnabled: client.rendererEnabled,
                streamGeneration: client.streamGeneration,
                log: ctx?.log.slice(-200) ?? []
            };
        },
        destroy: () => {
            ScriptRunner.stop();
            syncScriptActivity();
            Navigator.stop();
            client.closeClient();
        }
    };
}
