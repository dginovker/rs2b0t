export type RenderMode = 'focused' | 'background' | 'hidden';

export const DEFAULT_FOCUSED_FPS = 50;
export const MIN_FOCUSED_FPS = 1;
export const MAX_FOCUSED_FPS = 50;

export class RenderGateController {
    mode: RenderMode = 'focused';
    drawn = 0;
    backgroundIntervalMs = 300;

    private rendererEnabled = true;
    private focusedFrameRate = DEFAULT_FOCUSED_FPS;
    private nextDrawAt: number | null = null;

    get enabled(): boolean {
        return this.rendererEnabled;
    }

    get focusedFps(): number {
        return this.focusedFrameRate;
    }

    shouldDraw(now: number): boolean {
        if (!this.rendererEnabled || this.mode === 'hidden') {
            return false;
        }
        return this.nextDrawAt === null || now >= this.nextDrawAt;
    }

    markDrawn(now: number): void {
        this.drawn++;
        const interval = this.mode === 'focused' ? 1000 / this.focusedFrameRate : Math.max(0, this.backgroundIntervalMs);
        if (this.nextDrawAt === null || now - this.nextDrawAt > interval) {
            this.nextDrawAt = now + interval;
            return;
        }
        this.nextDrawAt += interval;
        if (this.nextDrawAt <= now) {
            this.nextDrawAt = now + interval;
        }
    }

    setMode(mode: RenderMode): void {
        if (mode === this.mode) {
            return;
        }
        this.mode = mode;
        this.nextDrawAt = null;
    }

    setEnabled(enabled: boolean): void {
        if (enabled === this.rendererEnabled) {
            return;
        }
        this.rendererEnabled = enabled;
        this.nextDrawAt = null;
    }

    setFocusedFps(fps: number): void {
        const normalized = Number.isFinite(fps) ? Math.max(MIN_FOCUSED_FPS, Math.min(MAX_FOCUSED_FPS, Math.round(fps))) : DEFAULT_FOCUSED_FPS;
        if (normalized === this.focusedFrameRate) {
            return;
        }
        this.focusedFrameRate = normalized;
        this.nextDrawAt = null;
    }
}

export const RenderGate = new RenderGateController();
