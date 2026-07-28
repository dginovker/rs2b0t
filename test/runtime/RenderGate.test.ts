import { describe, expect, test, beforeEach } from 'bun:test';
import { RenderGateController } from '#/bot/runtime/RenderGate.js';

describe('RenderGate', () => {
    let gate: RenderGateController;

    beforeEach(() => {
        gate = new RenderGateController();
    });

    test('focused drawing obeys its cap without slowing the logical loop', () => {
        gate.setFocusedFps(20);
        expect(gate.shouldDraw(0)).toBe(true);
        gate.markDrawn(0);
        expect(gate.shouldDraw(49)).toBe(false);
        expect(gate.shouldDraw(50)).toBe(true);
    });

    test('hidden never draws', () => {
        gate.setMode('hidden');
        expect(gate.shouldDraw(1000)).toBe(false);
    });

    test('background throttles to the interval', () => {
        gate.backgroundIntervalMs = 300;
        gate.setMode('background');
        gate.markDrawn(1000);
        expect(gate.shouldDraw(1299)).toBe(false);
        expect(gate.shouldDraw(1300)).toBe(true);
    });

    test('markDrawn advances the counter', () => {
        gate.markDrawn(5);
        gate.markDrawn(25);
        expect(gate.drawn).toBe(2);
    });

    test('disabled never draws and re-enabling draws immediately', () => {
        gate.markDrawn(0);
        gate.setEnabled(false);
        expect(gate.shouldDraw(10_000)).toBe(false);
        gate.setEnabled(true);
        expect(gate.shouldDraw(10_000)).toBe(true);
    });

    test('focused FPS is clamped to safe values', () => {
        gate.setFocusedFps(0);
        expect(gate.focusedFps).toBe(1);
        gate.setFocusedFps(500);
        expect(gate.focusedFps).toBe(50);
        gate.setFocusedFps(Number.NaN);
        expect(gate.focusedFps).toBe(50);
    });
});
