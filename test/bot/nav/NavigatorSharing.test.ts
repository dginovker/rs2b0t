import { expect, test } from 'bun:test';

test('headless runtimes share one Window-wide navigator worker', async () => {
    const root = globalThis as typeof globalThis & {
        __rs2b0tAssetBase?: string;
        __rs2b0tNavigatorService?: unknown;
    };
    const originalWorker = globalThis.Worker;
    const originalFetch = globalThis.fetch;

    class FakeWorker {
        static instances: FakeWorker[] = [];

        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        terminated = false;

        constructor(readonly url: URL) {
            FakeWorker.instances.push(this);
        }

        postMessage(message: { type: string; id?: number }): void {
            if (message.type === 'init') {
                queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', mapsquares: 100, doorEdges: 2, transportEdges: 3 } } as MessageEvent));
            } else if (message.type === 'path') {
                queueMicrotask(() =>
                    this.onmessage?.({
                        data: {
                            type: 'path',
                            id: message.id,
                            ok: true,
                            waypoints: [{ x: 1, z: 1, level: 0 }],
                            cost: 1,
                            expanded: 1,
                            elapsedMs: message.id
                        }
                    } as MessageEvent)
                );
            }
        }

        terminate(): void {
            this.terminated = true;
        }
    }

    try {
        root.__rs2b0tAssetBase = 'http://localhost/bot/';
        delete root.__rs2b0tNavigatorService;
        globalThis.Worker = FakeWorker as unknown as typeof Worker;
        globalThis.fetch = (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as unknown as typeof fetch;

        // @ts-expect-error Bun accepts resource-query imports; the query gives each simulated runtime private module state.
        const first = (await import('../../../src/bot/nav/Navigator.ts?sharing=first')).Navigator;
        // @ts-expect-error Bun accepts resource-query imports; the query gives each simulated runtime private module state.
        const second = (await import('../../../src/bot/nav/Navigator.ts?sharing=second')).Navigator;

        const [a, b] = await Promise.all([first.findPath({ x: 0, z: 0, level: 0 }, { x: 1, z: 1, level: 0 }), second.findPath({ x: 2, z: 2, level: 0 }, { x: 1, z: 1, level: 0 })]);

        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        expect(FakeWorker.instances).toHaveLength(1);
        expect(first.timings).toEqual([1]);
        expect(second.timings).toEqual([2]);

        first.stop();
        expect(FakeWorker.instances[0].terminated).toBe(false);
        second.stop();
        expect(FakeWorker.instances[0].terminated).toBe(true);
    } finally {
        globalThis.Worker = originalWorker;
        globalThis.fetch = originalFetch;
        delete root.__rs2b0tAssetBase;
        delete root.__rs2b0tNavigatorService;
    }
});
