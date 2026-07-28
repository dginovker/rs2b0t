import type { RenderMode } from '../runtime/RenderGate.js';
import type { LoginCoordination } from '../runtime/LoginCoordination.js';

export type { RenderMode };

export interface Account {
    username: string;
    password: string;
    label?: string;
}

export interface SlotStatus {
    ready: boolean;
    ingame: boolean;
    // the logged-in character, once known — a bot is added empty and gets its
    // account typed into its own panel, so this is what the rail tile shows
    player: string | null;
    tile?: { x: number; z: number; level: number } | null;
    loopCycle: number;
    drawn: number;
    scriptState: string;
    // Optional runtime diagnostics used by the repeatable MultiBox load harness.
    tickCount?: number;
    tickMeanMs?: number;
    scriptLoops?: number;
    clientFps?: number;
    rendererEnabled?: boolean;
    streamGeneration?: number;
}

export interface SlotSnapshot extends SlotStatus {
    id: number;
    username: string;
    focused: boolean;
    mode: RenderMode;
}

export interface SlotHandle {
    setRenderMode(mode: RenderMode): void;
    setRendererEnabled(enabled: boolean): void;
    startScript(name: string): void;
    setCredentials(username: string, password: string): void;
    setAutoLogin(on: boolean): void;
    setLoginCoordination(coordination: LoginCoordination | null): void;
    status(): SlotStatus;
    destroy(): void;
}

export interface SlotOps {
    spawn(account: Account): SlotHandle;
    move(handle: SlotHandle, before: SlotHandle | null): void;
}
