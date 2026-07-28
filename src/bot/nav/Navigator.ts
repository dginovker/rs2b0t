import type { NavPoint, NavResponse, PathOutcome } from './PathFinder.js';

export type PathResult = PathOutcome & { elapsedMs?: number };

const FIND_TIMEOUT_MS = 20_000;
const SERVICE_KEY = '__rs2b0tNavigatorService';

interface NavigatorClient {
    recordTiming(elapsedMs: number): void;
}

interface PendingRequest {
    owner: NavigatorClient;
    resolve: (result: PathResult) => void;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * One Window-wide path service. Embedded MultiBox runtimes intentionally have
 * private script modules, but they live in one Window and can share the large,
 * immutable collision graph plus its Worker. Normal clients still get one
 * service because each tab has its own globalThis.
 */
class NavigatorService {
    private worker: Worker | null = null;
    private state: 'idle' | 'starting' | 'ready' | 'failed' = 'idle';
    private failReason = '';
    private nextId = 1;
    private readonly clients = new Set<NavigatorClient>();
    private readonly pending = new Map<number, PendingRequest>();
    private readonly readyWaiters: Array<() => void> = [];

    mapsquares = 0;
    doorEdges = 0;
    transportEdges = 0;

    isReady(): boolean {
        return this.state === 'ready';
    }

    start(owner: NavigatorClient): void {
        this.clients.add(owner);
        if (this.state !== 'idle') {
            return;
        }
        this.state = 'starting';

        const configuredBase = (globalThis as typeof globalThis & { __rs2b0tAssetBase?: string }).__rs2b0tAssetBase;
        const workerUrl = new URL('navworker.js', configuredBase ?? import.meta.url);
        const collisionUrl = new URL('collision.lcnav.gz', configuredBase ?? import.meta.url);
        const build = process.env.BUILD_TIME ?? 'dev';
        workerUrl.searchParams.set('v', build);
        collisionUrl.searchParams.set('v', build);

        const worker = new Worker(workerUrl, { type: 'module' });
        this.worker = worker;
        worker.onmessage = (event: MessageEvent): void => this.onMessage(event.data as NavResponse);
        worker.onerror = (event: ErrorEvent): void => this.fail(`worker error: ${event.message}`);

        fetch(collisionUrl)
            .then(res => {
                if (!res.ok) {
                    throw new Error(`collision pack fetch failed: HTTP ${res.status}`);
                }
                return res.arrayBuffer();
            })
            .then(pack => {
                if (this.worker === worker) {
                    worker.postMessage({ type: 'init', pack }, [pack]);
                }
            })
            .catch(err => {
                if (this.worker === worker) {
                    this.fail(err instanceof Error ? err.message : String(err));
                }
            });
    }

    async findPath(owner: NavigatorClient, from: NavPoint, to: NavPoint, opts?: { avoidDoors?: { x: number; z: number }[]; timeoutMs?: number; maxExpansions?: number }): Promise<PathResult> {
        this.start(owner);

        if (this.state === 'starting') {
            await new Promise<void>(resolve => this.readyWaiters.push(resolve));
        }
        if (this.state !== 'ready' || !this.worker) {
            return { ok: false, reason: `navigator unavailable: ${this.failReason || this.state}`, expanded: 0 };
        }

        const timeoutMs = opts?.timeoutMs ?? FIND_TIMEOUT_MS;
        const id = this.nextId++;
        return new Promise<PathResult>(resolve => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                resolve({ ok: false, reason: `path request timed out after ${timeoutMs}ms`, expanded: 0 });
            }, timeoutMs);
            this.pending.set(id, { owner, resolve, timer });
            this.worker!.postMessage({ type: 'path', id, from, to, avoid: opts?.avoidDoors, maxExpansions: opts?.maxExpansions });
        });
    }

    release(owner: NavigatorClient): void {
        this.clients.delete(owner);
        for (const [id, request] of this.pending) {
            if (request.owner !== owner) {
                continue;
            }
            clearTimeout(request.timer);
            request.resolve({ ok: false, reason: 'navigator client closed', expanded: 0 });
            this.pending.delete(id);
        }
        if (this.clients.size !== 0) {
            return;
        }

        this.worker?.terminate();
        this.worker = null;
        this.state = 'idle';
        this.failReason = '';
        this.mapsquares = 0;
        this.doorEdges = 0;
        this.transportEdges = 0;
        this.flushReadyWaiters();
    }

    private onMessage(message: NavResponse): void {
        if (message.type === 'ready') {
            this.mapsquares = message.mapsquares;
            this.doorEdges = message.doorEdges;
            this.transportEdges = message.transportEdges;
            this.state = 'ready';
            console.log(`[rs2b0t] shared nav worker ready: ${message.mapsquares} mapsquares, ${message.doorEdges} door edges, ${message.transportEdges} transport edges`);
            this.flushReadyWaiters();
        } else if (message.type === 'error') {
            this.fail(message.message);
        } else if (message.type === 'path') {
            const request = this.pending.get(message.id);
            if (!request) {
                return;
            }
            this.pending.delete(message.id);
            clearTimeout(request.timer);
            request.owner.recordTiming(message.elapsedMs);
            request.resolve(message);
        }
    }

    private fail(reason: string): void {
        console.error(`[rs2b0t] navigator failed: ${reason}`);
        this.failReason = reason;
        this.state = 'failed';
        this.flushReadyWaiters();
        for (const [, request] of this.pending) {
            clearTimeout(request.timer);
            request.resolve({ ok: false, reason: `navigator failed: ${reason}`, expanded: 0 });
        }
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
    }

    private flushReadyWaiters(): void {
        const waiters = this.readyWaiters.splice(0);
        for (const waiter of waiters) {
            waiter();
        }
    }
}

function service(): NavigatorService {
    const root = globalThis as typeof globalThis & { [SERVICE_KEY]?: NavigatorService };
    root[SERVICE_KEY] ??= new NavigatorService();
    return root[SERVICE_KEY];
}

class NavigatorImpl implements NavigatorClient {
    readonly timings: number[] = [];
    private joined = false;

    get mapsquares(): number {
        return service().mapsquares;
    }

    get doorEdges(): number {
        return service().doorEdges;
    }

    get transportEdges(): number {
        return service().transportEdges;
    }

    isReady(): boolean {
        return service().isReady();
    }

    start(): void {
        this.joined = true;
        service().start(this);
    }

    findPath(from: NavPoint, to: NavPoint, opts?: { avoidDoors?: { x: number; z: number }[]; timeoutMs?: number; maxExpansions?: number }): Promise<PathResult> {
        this.joined = true;
        return service().findPath(this, from, to, opts);
    }

    stop(): void {
        if (!this.joined) {
            return;
        }
        this.joined = false;
        service().release(this);
    }

    recordTiming(elapsedMs: number): void {
        this.timings.push(elapsedMs);
    }
}

export const Navigator = new NavigatorImpl();
