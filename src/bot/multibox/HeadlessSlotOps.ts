import type { HeadlessBot, HeadlessBotOptions } from '../headless.js';
import type { LoginCoordination } from '../runtime/LoginCoordination.js';
import type { Account, RenderMode, SlotHandle, SlotOps, SlotStatus } from './types.js';

type HeadlessRuntime = HeadlessBot;

interface HeadlessModule {
    createHeadlessBot(options: HeadlessBotOptions): HeadlessRuntime;
}

let nextRuntimeId = 1;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    return node;
}

function isActive(state: string): boolean {
    return state === 'running' || state === 'paused' || state === 'stopping';
}

function storageKey(username: string): string {
    return `rs2b0t:${username}:selectedScript`;
}

class HeadlessSlotHandle implements SlotHandle {
    readonly el: HTMLDivElement;

    private readonly pane: HTMLElement;
    private readonly dot: HTMLElement;
    private readonly name: HTMLElement;
    private readonly thumbState: HTMLElement;
    private readonly thumbScript: HTMLElement;
    private readonly statusEl: HTMLElement;
    private readonly scriptSelect: HTMLSelectElement;
    private readonly description: HTMLElement;
    private readonly settings: HTMLElement;
    private readonly startButton: HTMLButtonElement;
    private readonly pauseButton: HTMLButtonElement;
    private readonly stopButton: HTMLButtonElement;
    private readonly log: HTMLElement;
    private readonly pending: Array<(runtime: HeadlessRuntime) => void> = [];
    private readonly refreshTimer: number;

    private runtime: HeadlessRuntime | null = null;
    private destroyed = false;
    private mode: RenderMode = 'background';
    private lastLogKey = '';

    constructor(
        private readonly account: Account,
        main: HTMLElement
    ) {
        this.el = element('div', 'mbx-slot mbx-headless-slot');
        this.el.draggable = true;

        const cap = element('div', 'mbx-cap');
        this.dot = element('span', 'mbx-dot');
        this.name = element('span', 'mbx-name');
        this.name.textContent = account.username;
        const close = element('button', 'mbx-close');
        close.type = 'button';
        close.title = 'remove bot';
        close.textContent = '✕';
        cap.append(this.dot, this.name, close);

        const body = element('div', 'mbx-body mbx-headless-thumb');
        const badge = element('div', 'mbx-headless-badge');
        badge.textContent = 'HEADLESS';
        this.thumbState = element('div', 'mbx-headless-state');
        this.thumbState.textContent = 'loading runtime…';
        this.thumbScript = element('div', 'mbx-headless-script');
        this.thumbScript.textContent = 'idle';
        const hit = element('div', 'mbx-hit');
        body.append(badge, this.thumbState, this.thumbScript, hit);
        this.el.append(cap, body);

        this.pane = element('section', 'mbx-headless-pane');
        const heading = element('div', 'mbx-headless-heading');
        const title = element('h1', 'mbx-headless-title');
        title.textContent = account.username;
        const tradeoff = element('span', 'mbx-headless-mode');
        tradeoff.textContent = 'high-efficiency · no game renderer';
        heading.append(title, tradeoff);
        this.statusEl = element('div', 'mbx-headless-status');

        const controls = element('div', 'mbx-headless-controls');
        const scriptLabel = element('label', 'mbx-headless-label');
        scriptLabel.textContent = 'Script';
        this.scriptSelect = element('select', 'mbx-headless-select');
        scriptLabel.append(this.scriptSelect);
        this.description = element('div', 'mbx-headless-description');
        this.settings = element('div', 'mbx-headless-settings');
        const buttons = element('div', 'mbx-headless-buttons');
        this.startButton = element('button', 'mbx-headless-button mbx-headless-start');
        this.startButton.textContent = 'Start';
        this.pauseButton = element('button', 'mbx-headless-button');
        this.pauseButton.textContent = 'Pause';
        this.stopButton = element('button', 'mbx-headless-button');
        this.stopButton.textContent = 'Stop';
        buttons.append(this.startButton, this.pauseButton, this.stopButton);
        controls.append(scriptLabel, this.description, this.settings, buttons);

        const logTitle = element('h2', 'mbx-headless-subtitle');
        logTitle.textContent = 'Log';
        this.log = element('div', 'mbx-headless-log');
        this.pane.append(heading, this.statusEl, controls, logTitle, this.log);
        main.append(this.pane);

        this.scriptSelect.addEventListener('change', () => {
            localStorage.setItem(storageKey(this.account.username), this.scriptSelect.value);
            this.renderSettings();
        });
        this.startButton.addEventListener('click', () => this.withRuntime(runtime => runtime.startScript(this.scriptSelect.value)));
        this.pauseButton.addEventListener('click', () =>
            this.withRuntime(runtime => {
                const state = runtime.snapshot().scriptState;
                if (state === 'paused') runtime.resumeScript();
                else runtime.pauseScript();
            })
        );
        this.stopButton.addEventListener('click', () => this.withRuntime(runtime => runtime.stopScript()));

        this.refreshTimer = window.setInterval(() => this.refresh(), 500);
        this.applyMode();
        void this.load();
    }

    setRenderMode(mode: RenderMode): void {
        this.mode = mode;
        this.applyMode();
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
            loopCycle: snapshot.loopCycle,
            drawn: 0,
            scriptState: snapshot.scriptState,
            tickCount: snapshot.tickCount,
            tickMeanMs: snapshot.tickMeanMs,
            scriptLoops: snapshot.scriptLoops,
            clientFps: snapshot.clientFps
        };
    }

    destroy(): void {
        this.destroyed = true;
        window.clearInterval(this.refreshTimer);
        this.runtime?.destroy();
        this.runtime = null;
        this.pane.remove();
        this.el.remove();
    }

    private async load(): Promise<void> {
        try {
            const url = new URL('./headless/headless.js', import.meta.url);
            url.searchParams.set('instance', `${nextRuntimeId++}-${this.account.username}`);
            url.searchParams.set('build', process.env.BUILD_TIME ?? 'dev');
            const module = (await import(url.href)) as HeadlessModule;
            if (this.destroyed) {
                return;
            }
            this.runtime = module.createHeadlessBot({
                box: this.account.username,
                username: this.account.username,
                password: this.account.password,
                autoLogin: false
            });
            for (const callback of this.pending.splice(0)) callback(this.runtime);
            this.buildScriptList();
            this.refresh();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.thumbState.textContent = 'runtime failed';
            this.statusEl.textContent = `Headless runtime failed: ${message}`;
            this.statusEl.classList.add('is-error');
        }
    }

    private withRuntime(callback: (runtime: HeadlessRuntime) => void): void {
        if (this.runtime) callback(this.runtime);
        else this.pending.push(callback);
    }

    private buildScriptList(): void {
        if (!this.runtime) return;
        const scripts = this.runtime.scripts();
        this.scriptSelect.replaceChildren();
        for (const script of scripts) {
            const option = document.createElement('option');
            option.value = script.name;
            option.textContent = script.category ? `${script.category} · ${script.name}` : script.name;
            this.scriptSelect.append(option);
        }
        const remembered = localStorage.getItem(storageKey(this.account.username));
        if (remembered && scripts.some(script => script.name === remembered)) {
            this.scriptSelect.value = remembered;
        }
        this.renderSettings();
    }

    private renderSettings(): void {
        this.settings.replaceChildren();
        if (!this.runtime) return;
        const script = this.runtime.scripts().find(item => item.name === this.scriptSelect.value);
        this.description.textContent = script?.description ?? '';
        if (!script || Object.keys(script.settings).length === 0) {
            const empty = element('div', 'mbx-headless-empty');
            empty.textContent = 'No parameters';
            this.settings.append(empty);
            return;
        }
        for (const [key, def] of Object.entries(script.settings)) {
            const row = element('label', 'mbx-headless-setting');
            const text = element('span', 'mbx-headless-setting-text');
            const label = element('span', 'mbx-headless-setting-label');
            label.textContent = def.label ?? key;
            text.append(label);
            if (def.help) {
                const help = element('span', 'mbx-headless-setting-help');
                help.textContent = def.help;
                text.append(help);
            }
            const value = this.runtime.setting(script.name, key);
            let control: HTMLInputElement | HTMLSelectElement;
            if (def.type === 'boolean') {
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = value === 'true';
                input.addEventListener('change', () => this.runtime?.saveSetting(script.name, key, input.checked ? 'true' : 'false'));
                control = input;
            } else if (def.type === 'string' && def.options && def.options.length > 0) {
                const select = element('select', 'mbx-headless-input') as HTMLSelectElement;
                for (const choice of def.options) {
                    const option = document.createElement('option');
                    option.value = choice;
                    option.textContent = choice;
                    select.append(option);
                }
                select.value = value;
                select.addEventListener('change', () => this.runtime?.saveSetting(script.name, key, select.value));
                control = select;
            } else {
                const input = element('input', 'mbx-headless-input') as HTMLInputElement;
                input.type = def.type === 'number' ? 'number' : 'text';
                if (def.min !== undefined) input.min = String(def.min);
                if (def.max !== undefined) input.max = String(def.max);
                input.value = value;
                if (def.type === 'string[]') input.placeholder = 'comma-separated';
                if (def.type === 'tile') input.placeholder = 'x,z,level';
                input.addEventListener('change', () => this.runtime?.saveSetting(script.name, key, input.value));
                control = input;
            }
            control.classList.add('mbx-headless-setting-control');
            row.append(text, control);
            this.settings.append(row);
        }
    }

    private refresh(): void {
        const runtime = this.runtime;
        if (!runtime) return;
        const snapshot = runtime.snapshot();
        this.dot.classList.toggle('is-online', snapshot.ingame);
        this.name.textContent = snapshot.player ?? this.account.username;
        this.thumbState.textContent = snapshot.ingame ? `${snapshot.player ?? this.account.username} · online` : 'connecting…';
        this.thumbScript.textContent = snapshot.scriptName ? `${snapshot.scriptName} · ${snapshot.scriptState} · ${snapshot.scriptLoops} loops` : snapshot.scriptState;
        const tile = snapshot.tile ? `${snapshot.tile.x}, ${snapshot.tile.z}, ${snapshot.tile.level}` : '—';
        this.statusEl.textContent = `${snapshot.ingame ? 'online' : 'offline'} · tile ${tile} · ${snapshot.tickCount} ticks · ${snapshot.tickMeanMs.toFixed(0)} ms/tick`;
        const active = isActive(snapshot.scriptState);
        this.startButton.disabled = active || !snapshot.ingame;
        this.pauseButton.disabled = snapshot.scriptState !== 'running' && snapshot.scriptState !== 'paused';
        this.pauseButton.textContent = snapshot.scriptState === 'paused' ? 'Resume' : 'Pause';
        this.stopButton.disabled = !active || snapshot.scriptState === 'stopping';
        this.scriptSelect.disabled = active;
        for (const control of Array.from(this.settings.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.mbx-headless-setting-control'))) {
            control.disabled = active;
        }
        const logKey = snapshot.log.map(line => `${line.time}:${line.msg}`).join('|');
        if (logKey !== this.lastLogKey) {
            this.lastLogKey = logKey;
            this.log.replaceChildren();
            for (const line of snapshot.log) {
                const row = element('div', `mbx-headless-log-line is-${line.level}`);
                row.textContent = `${new Date(line.time).toTimeString().slice(0, 8)} ${line.msg}`;
                this.log.append(row);
            }
            this.log.scrollTop = this.log.scrollHeight;
        }
    }

    private applyMode(): void {
        const focused = this.mode === 'focused';
        this.el.classList.toggle('is-focused', focused);
        this.pane.hidden = !focused;
    }
}

function visualOrder(el: HTMLElement): number {
    const value = Number.parseInt(el.style.order, 10);
    return Number.isFinite(value) ? value : 0;
}

export class HeadlessSlotOps implements SlotOps {
    constructor(
        private readonly main: HTMLElement,
        private readonly rail: HTMLElement,
        private readonly before: HTMLElement
    ) {}

    spawn(account: Account): SlotHandle {
        const handle = new HeadlessSlotHandle(account, this.main);
        this.rail.insertBefore(handle.el, this.before);
        this.applyOrder(this.ordered());
        return handle;
    }

    move(handle: SlotHandle, before: SlotHandle | null): void {
        const moving = handle as HeadlessSlotHandle;
        const target = before as HeadlessSlotHandle | null;
        const slots = this.ordered();
        const from = slots.indexOf(moving.el);
        if (from < 0 || target === moving) return;
        slots.splice(from, 1);
        const to = target === null ? slots.length : slots.indexOf(target.el);
        if (to < 0) return;
        slots.splice(to, 0, moving.el);
        this.applyOrder(slots);
    }

    private ordered(): HTMLElement[] {
        return Array.from(this.rail.querySelectorAll<HTMLElement>('.mbx-slot')).sort((a, b) => visualOrder(a) - visualOrder(b));
    }

    private applyOrder(slots: HTMLElement[]): void {
        const first = -slots.length;
        slots.forEach((slot, index) => {
            slot.style.order = String(first + index);
        });
    }
}
