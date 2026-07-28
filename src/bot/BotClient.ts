import { Client } from '#/client/Client.js';
import { sleep } from '#/util/JsUtil.js';
import { WorkerClock } from '#/util/WorkerClock.js';

import { BotHost } from './BotHost.js';
import { RenderGate } from './runtime/RenderGate.js';

export default class BotClient extends Client {
    constructor(nodeid: number, lowmem: boolean, members: boolean, shellMode: boolean = false) {
        super(nodeid, lowmem, members, shellMode);
        BotHost.attach(this);
    }

    protected override async frameDelay(ms: number): Promise<void> {
        if (this.shellMode) {
            await sleep(ms);
        } else {
            await WorkerClock.sleep(ms);
        }
    }

    get pumpFps(): number {
        return this.fps;
    }

    override async mainloop(): Promise<void> {
        await super.mainloop();
        BotHost.onFrame();
    }

    override async mainredraw(): Promise<void> {
        const now = performance.now();
        if (!RenderGate.shouldDraw(now)) {
            return;
        }
        await super.mainredraw();
        RenderGate.markDrawn(now);
        BotHost.onDraw();
    }
}
