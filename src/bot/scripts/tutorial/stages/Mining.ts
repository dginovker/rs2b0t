import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Locs, type Loc } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { once, task } from '../Task.js';
import { MINE_Z, walkToward } from './helpers.js';

const DEZZICK = 'Mining Instructor';
const COPPER_ROCK_ID = 3042;
const TIN_ROCK_ID = 3043;
const USE_ON_RANGE = 12;
const EXIT_GATE_X = 3094;
const EXIT_GATE_BOX = { minX: EXIT_GATE_X - 3, maxX: EXIT_GATE_X + 3, minZ: 9498, maxZ: 9507 };

const noDialog = () => !ChatDialog.isOpen();
const inMine = () => {
    const tile = Game.tile();
    return tile !== null && tile.z >= MINE_Z;
};
const rockQuery = (id: number) =>
    Locs.query()
        .name('Rocks')
        .where((rock: Loc) => rock.id === id);

async function talkUntil(done: () => boolean): Promise<boolean> {
    const npc = Npcs.query().name(DEZZICK).within(40).nearest();
    if (!npc) return false;
    if (npc.distance() > 5) {
        await walkToward(npc.tile());
        return false;
    }
    await npc.interact('Talk-to');
    return Execution.delayUntil(done, 8000);
}

async function workRock(id: number, action: string, done: () => boolean, timeout: number): Promise<boolean> {
    const rock = rockQuery(id).within(40).nearest();
    if (!rock) return false;
    if (rock.distance() > 5) {
        await walkToward(rock.tile());
        return false;
    }
    await rock.interact(action);
    return Execution.delayUntil(done, timeout);
}

export function miningStages(): Task[] {
    let prospectedCopper = false;
    let prospectedTin = false;
    return [
        once(
            () => inMine() && noDialog(),
            () => talkUntil(ChatDialog.isOpen)
        ),
        once(
            () => inMine() && noDialog(),
            async () => (prospectedCopper = await workRock(COPPER_ROCK_ID, 'Prospect', ChatDialog.isOpen, 8000))
        ),
        once(
            () => inMine() && noDialog() && prospectedCopper,
            async () => (prospectedTin = await workRock(TIN_ROCK_ID, 'Prospect', ChatDialog.isOpen, 8000))
        ),
        once(
            () => inMine() && noDialog() && prospectedTin && !Inventory.contains('Bronze pickaxe'),
            () => talkUntil(() => Inventory.contains('Bronze pickaxe'))
        ),
        once(
            () => inMine() && noDialog() && Inventory.contains('Bronze pickaxe') && !Inventory.contains('Copper ore') && !Game.animating(),
            () => workRock(COPPER_ROCK_ID, 'Mine', () => Inventory.contains('Copper ore'), 15000)
        ),
        once(
            () => inMine() && noDialog() && Inventory.contains('Copper ore') && !Inventory.contains('Tin ore') && !Game.animating(),
            () => workRock(TIN_ROCK_ID, 'Mine', () => Inventory.contains('Tin ore'), 15000)
        ),
        task(
            () => inMine() && noDialog() && Inventory.contains('Copper ore') && Inventory.contains('Tin ore'),
            async () => {
                const furnace = Locs.query().name('Furnace').action('Use').within(40).nearest();
                if (!furnace) return;
                if (furnace.distance() > USE_ON_RANGE) return walkToward(furnace.tile());
                const ore = Inventory.first('Copper ore');
                if (!ore) return;
                await ore.useOn(furnace);
                await Execution.delayUntil(() => Inventory.contains('Bronze bar'), 15000);
            }
        ),
        once(
            () => inMine() && noDialog() && Inventory.contains('Bronze bar') && !Inventory.contains('Hammer'),
            () => talkUntil(() => Inventory.contains('Hammer'))
        ),
        task(
            () => (noDialog() || ChatDialog.isMainMakePanel()) && inMine() && Inventory.contains('Bronze bar') && Inventory.contains('Hammer'),
            async () => {
                if (ChatDialog.isMainMakePanel()) {
                    await ChatDialog.makeFromPanel('dagger');
                    await Execution.delayUntil(() => Inventory.contains('Bronze dagger'), 10000);
                    return;
                }
                const anvil = Locs.query().name('Anvil').within(40).nearest();
                if (!anvil) return;
                if (anvil.distance() > USE_ON_RANGE) return walkToward(anvil.tile());
                const bar = Inventory.first('Bronze bar');
                if (!bar) return;
                await bar.useOn(anvil);
                await Execution.delayUntil(ChatDialog.isMainMakePanel, 8000);
            }
        ),
        once(
            () => {
                const tile = Game.tile();
                return inMine() && noDialog() && Inventory.contains('Bronze dagger') && tile !== null && tile.x <= EXIT_GATE_X;
            },
            async () => {
                const gate = Locs.query().name('Gate').action('Open').inside(EXIT_GATE_BOX).nearest();
                if (!gate) return false;
                if (gate.distance() > 5) {
                    await walkToward(gate.tile());
                    return false;
                }
                await gate.interact('Open');
                return Execution.delayUntil(() => {
                    const tile = Game.tile();
                    return tile !== null && tile.x > EXIT_GATE_X;
                }, 8000);
            }
        )
    ];
}
