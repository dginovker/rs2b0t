import type { EmbeddedBot, EmbeddedBotOptions } from '../embedded.js';
import type { LoginCoordination } from '../runtime/LoginCoordination.js';
import { paintThumbnail } from './ThumbnailPainter.js';
import type { Account, RenderMode, SlotHandle, SlotOps, SlotStatus } from './types.js';

const LOGICAL_W = 1100;
const LOGICAL_H = 620;
const RAIL_W = 264;
const TILE_W = 236;
const TILE_H = 155;
const PANEL_W = 330;
const ROOT_GAP = 8;
const STAGE_W = 765;
const STAGE_H = 503;
const WRAP_W = LOGICAL_W - PANEL_W - ROOT_GAP;
const STAGE_K = Math.min(WRAP_W / STAGE_W, LOGICAL_H / STAGE_H);
const GAME_W = STAGE_W * STAGE_K;
const GAME_H = STAGE_H * STAGE_K;
const GAME_X = (WRAP_W - GAME_W) / 2;
const GAME_Y = (LOGICAL_H - GAME_H) / 2;
const CROP_K = Math.max(TILE_W / GAME_W, TILE_H / GAME_H);
const CROP_TX = TILE_W / 2 - (GAME_X + GAME_W / 2) * CROP_K;
const CROP_TY = TILE_H / 2 - (GAME_Y + GAME_H / 2) * CROP_K;
const CROP_TRANSFORM = `translate(${CROP_TX}px, ${CROP_TY}px) scale(${CROP_K})`;
const RAIL_BACKGROUND_INTERVAL_MS = 1000;

interface EmbeddedModule {
    createEmbeddedBot(options: EmbeddedBotOptions): EmbeddedBot;
}

let nextRuntimeId = 1;

function railWidth(): number {
    return document.getElementById('mbx-rail')?.offsetWidth ?? RAIL_W;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
    const result = document.createElement(tag);
    result.className = className;
    return result;
}

class DomSlotHandle implements SlotHandle {
    readonly el: HTMLDivElement;

    private readonly scaler: HTMLDivElement;
    private readonly clientRoot: HTMLDivElement;
    private readonly canvas: HTMLCanvasElement;
    private readonly overlay: HTMLCanvasElement;
    private readonly panel: HTMLDivElement;
    private readonly mirror: HTMLCanvasElement;
    private readonly mirrorTimer: number;
    private readonly pending: Array<(runtime: EmbeddedBot) => void> = [];
    private runtime: EmbeddedBot | null = null;
    private destroyed = false;
    private mode: RenderMode = 'background';
    private readonly onResize = (): void => this.applyLayout();

    constructor(private readonly account: Account) {
        this.el = node('div', 'mbx-slot');
        this.el.draggable = true;

        const cap = node('div', 'mbx-cap');
        const dot = node('span', 'mbx-dot');
        const name = node('span', 'mbx-name');
        name.textContent = account.username;
        const close = node('button', 'mbx-close');
        close.type = 'button';
        close.title = 'remove bot';
        close.textContent = '✕';
        cap.append(dot, name, close);

        const body = node('div', 'mbx-body');
        const clip = node('div', 'mbx-clip');
        this.scaler = node('div', 'mbx-scaler');
        this.clientRoot = node('div', 'mbx-frame rs2b0t-root');

        const gameWrap = node('div', 'game-wrap');
        const gameStage = node('div', 'game-stage');
        this.canvas = node('canvas', 'game-canvas');
        this.canvas.width = STAGE_W;
        this.canvas.height = STAGE_H;
        this.overlay = node('canvas', 'game-overlay');
        this.overlay.width = STAGE_W;
        this.overlay.height = STAGE_H;
        const rendererOff = node('div', 'renderer-off');
        rendererOff.innerHTML = '<strong>Renderer off</strong><span>bot, script, and connection still running</span>';
        gameStage.append(this.canvas, this.overlay, rendererOff);
        gameWrap.append(gameStage);

        this.panel = node('div', 'bot-panel');
        this.panel.textContent = 'loading bot runtime…';
        this.clientRoot.append(gameWrap, this.panel);
        this.scaler.append(this.clientRoot);
        clip.append(this.scaler);

        this.mirror = node('canvas', 'mbx-mirror');
        this.mirror.width = TILE_W;
        this.mirror.height = TILE_H;
        const hit = node('div', 'mbx-hit');
        body.append(clip, this.mirror, hit);
        this.el.append(cap, body);

        this.mirrorTimer = window.setInterval(this.paintMirror, 1000);
        this.applyLayout();
        void this.load();
    }

    setRenderMode(mode: RenderMode): void {
        this.mode = mode;
        this.withRuntime(runtime => {
            runtime.renderGate.backgroundIntervalMs = RAIL_BACKGROUND_INTERVAL_MS;
            runtime.setRenderMode(mode);
        });
        this.applyLayout();
    }

    setRendererEnabled(enabled: boolean): void {
        this.withRuntime(runtime => {
            void runtime.setRendererEnabled(enabled).catch(error => console.error('[rs2b0t] renderer transition failed', error));
        });
    }

    startScript(name: string): void {
        this.withRuntime(runtime => runtime.startScript(name));
    }

    setCredentials(username: string, password: string): void {
        this.withRuntime(runtime => runtime.setCredentials(username, password));
    }

    setAutoLogin(on: boolean): void {
        this.withRuntime(runtime => runtime.setAutoLogin(on));
    }

    setLoginCoordination(coordination: LoginCoordination | null): void {
        this.withRuntime(runtime => runtime.setLoginCoordination(coordination));
    }

    status(): SlotStatus {
        if (!this.runtime) {
            return { ready: false, ingame: false, player: null, loopCycle: 0, drawn: 0, scriptState: 'idle' };
        }
        const snapshot = this.runtime.snapshot();
        return {
            ready: true,
            ingame: snapshot.ingame,
            player: snapshot.player,
            tile: snapshot.tile,
            loopCycle: snapshot.loopCycle,
            drawn: this.runtime.renderGate.drawn,
            scriptState: snapshot.scriptState,
            tickCount: snapshot.tickCount,
            tickMeanMs: snapshot.tickMeanMs,
            scriptLoops: snapshot.scriptLoops,
            clientFps: snapshot.clientFps,
            rendererEnabled: snapshot.rendererEnabled,
            streamGeneration: snapshot.streamGeneration
        };
    }

    destroy(): void {
        this.destroyed = true;
        window.clearInterval(this.mirrorTimer);
        window.removeEventListener('resize', this.onResize);
        this.runtime?.destroy();
        this.runtime = null;
        this.el.remove();
    }

    private async load(): Promise<void> {
        try {
            const url = new URL('./embedded/embedded.js', import.meta.url);
            url.searchParams.set('instance', `${nextRuntimeId++}-${this.account.username}`);
            url.searchParams.set('build', process.env.BUILD_TIME ?? 'dev');
            const module = (await import(url.href)) as EmbeddedModule;
            if (this.destroyed) {
                return;
            }
            this.runtime = module.createEmbeddedBot({
                box: this.account.username,
                username: this.account.username,
                password: this.account.password,
                autoLogin: false,
                canvas: this.canvas,
                overlay: this.overlay,
                panel: this.panel,
                presentation: this.clientRoot
            });
            for (const callback of this.pending.splice(0)) {
                callback(this.runtime);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.panel.textContent = `Bot runtime failed: ${message}`;
            this.panel.classList.add('rs2b0t-banner-error');
        }
    }

    private withRuntime(callback: (runtime: EmbeddedBot) => void): void {
        if (this.runtime) {
            callback(this.runtime);
        } else {
            this.pending.push(callback);
        }
    }

    private readonly paintMirror = (): void => {
        if (this.mode !== 'focused' || railWidth() === 0) {
            return;
        }
        paintThumbnail(this.mirror.getContext('2d')!, this.canvas, this.overlay, TILE_W, TILE_H);
    };

    private applyLayout(): void {
        const focused = this.mode === 'focused';
        this.el.classList.toggle('is-focused', focused);
        if (focused) {
            const mainW = window.innerWidth - railWidth();
            const mainH = window.innerHeight;
            const scale = Math.min(mainW / LOGICAL_W, mainH / LOGICAL_H);
            const dx = (mainW - LOGICAL_W * scale) / 2;
            const dy = (mainH - LOGICAL_H * scale) / 2;
            this.scaler.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
            window.addEventListener('resize', this.onResize);
        } else {
            this.scaler.style.transform = CROP_TRANSFORM;
            window.removeEventListener('resize', this.onResize);
        }
    }
}

function flexOrder(el: HTMLElement): number {
    const order = Number.parseInt(el.style.order, 10);
    return Number.isFinite(order) ? order : 0;
}

/** DOM order stays fixed because moving live clients can reset browser state. */
export function orderedSlotElements(root: ParentNode): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('.mbx-slot')).sort((a, b) => flexOrder(a) - flexOrder(b));
}

export class DomSlotOps implements SlotOps {
    constructor(private readonly railEl: HTMLElement, private readonly beforeEl: HTMLElement) {}

    spawn(account: Account): SlotHandle {
        const handle = new DomSlotHandle(account);
        this.railEl.insertBefore(handle.el, this.beforeEl);
        this.applyVisualOrder(orderedSlotElements(this.railEl));
        return handle;
    }

    move(handle: SlotHandle, before: SlotHandle | null): void {
        const moving = handle as DomSlotHandle;
        const target = before as DomSlotHandle | null;
        const slots = orderedSlotElements(this.railEl);
        const fromIndex = slots.indexOf(moving.el);
        if (fromIndex < 0 || target === moving) return;
        slots.splice(fromIndex, 1);
        const toIndex = target === null ? slots.length : slots.indexOf(target.el);
        if (toIndex < 0) return;
        slots.splice(toIndex, 0, moving.el);
        this.applyVisualOrder(slots);
    }

    private applyVisualOrder(slots: HTMLElement[]): void {
        const first = -slots.length;
        slots.forEach((slot, index) => {
            slot.style.order = String(first + index);
        });
    }
}
