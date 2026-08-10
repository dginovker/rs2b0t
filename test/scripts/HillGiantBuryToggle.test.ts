import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { Task } from '#/bot/api/Bot.js';
import { Execution } from '#/bot/api/Execution.js';
import { Game } from '#/bot/api/Game.js';
import { Inventory, type InvItem } from '#/bot/api/hud/Inventory.js';
import { SettingsBag, SettingsStore } from '#/bot/runtime/Settings.js';
import HillGiant from '#/bot/scripts/HillGiant.js';
import { BIG_BONES } from '#/bot/scripts/HillGiantLogic.js';

const original = {
    delayUntil: Execution.delayUntil,
    ingame: Game.ingame,
    tile: Game.tile,
    inventoryContains: Inventory.contains,
    inventoryFirst: Inventory.first,
    inventoryCount: Inventory.count
};

let activeBot: HillGiant | null;
let boneCount: number;
let interactions: string[];
let logs: string[];

beforeEach(() => {
    activeBot = null;
    boneCount = 1;
    interactions = [];
    logs = [];

    SettingsStore.clear('HillGiant', 'buryBones');
    Execution.delayUntil = async condition => condition();
    Game.ingame = () => true;
    Game.tile = () => ({ x: 3117, z: 9852, level: 0 });
    Inventory.contains = name => name === BIG_BONES && boneCount > 0;
    Inventory.first = name => name === BIG_BONES && boneCount > 0
        ? ({
            interact: async (op: string) => {
                interactions.push(op);
                boneCount--;
                return true;
            }
        } as unknown as InvItem)
        : null;
    Inventory.count = name => name === BIG_BONES ? boneCount : 0;
});

afterEach(() => {
    activeBot?.onStop();
    activeBot?.disposeSubscriptions();
    SettingsStore.clear('HillGiant', 'buryBones');

    Execution.delayUntil = original.delayUntil;
    Game.ingame = original.ingame;
    Game.tile = original.tile;
    Inventory.contains = original.inventoryContains;
    Inventory.first = original.inventoryFirst;
    Inventory.count = original.inventoryCount;
});

async function startBot(buryBones: boolean): Promise<HillGiant> {
    SettingsStore.save('HillGiant', 'buryBones', String(buryBones));
    const bot = new HillGiant();
    bot.settings = new SettingsBag({ buryBones });
    bot.bindLog(message => logs.push(message));
    await bot.onStart();
    activeBot = bot;
    return bot;
}

function burialTask(bot: HillGiant): Task {
    const tasks = (bot as unknown as { tasks: Task[] }).tasks;
    const task = tasks.find(candidate => candidate.constructor.name === 'BuryBones');
    if (!task) {
        throw new Error('HillGiant did not register its BuryBones task');
    }
    return task;
}

describe('HillGiant live burial toggle', () => {
    test('a change during the startup wait overrides the runner snapshot', async () => {
        let enteredStartupWait = false;
        const startupGate = { release: (): void => {
            throw new Error('HillGiant did not enter its startup wait');
        } };
        Execution.delayUntil = async () => new Promise<boolean>(resolve => {
            enteredStartupWait = true;
            startupGate.release = () => resolve(true);
        });
        SettingsStore.save('HillGiant', 'buryBones', 'true');
        const bot = new HillGiant();
        activeBot = bot;
        bot.settings = new SettingsBag({ buryBones: true });
        bot.bindLog(message => logs.push(message));

        const starting = bot.onStart();
        await Promise.resolve();
        SettingsStore.save('HillGiant', 'buryBones', 'false');
        if (!enteredStartupWait) {
            throw new Error('HillGiant did not enter its startup wait');
        }
        startupGate.release();
        await starting;

        const task = burialTask(bot);
        expect(bot.cfg().buryBones).toBe(false);
        expect(await task.validate()).toBe(false);
        await task.execute();
        expect(interactions).toEqual([]);
        expect(boneCount).toBe(1);
    });

    test('turning burial off while running prevents the next Bury interaction', async () => {
        const bot = await startBot(true);
        const task = burialTask(bot);
        expect(await task.validate()).toBe(true);

        SettingsStore.save('HillGiant', 'buryBones', 'false');

        expect(bot.cfg().buryBones).toBe(false);
        expect(await task.validate()).toBe(false);
        await task.execute();
        expect(interactions).toEqual([]);
        expect(boneCount).toBe(1);
        expect(logs).toContain('big-bone burial disabled — applies immediately');
    });

    test('turning burial on while running enables and records a real burial', async () => {
        const bot = await startBot(false);
        const task = burialTask(bot);
        expect(await task.validate()).toBe(false);

        SettingsStore.save('HillGiant', 'buryBones', 'true');

        expect(bot.cfg().buryBones).toBe(true);
        expect(await task.validate()).toBe(true);
        await task.execute();
        expect(interactions).toEqual(['Bury']);
        expect(boneCount).toBe(0);
        expect(logs).toContain('buried Big bones (burial toggle enabled)');
    });
});
