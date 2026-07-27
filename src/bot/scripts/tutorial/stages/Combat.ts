import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Equipment } from '../../../api/hud/Equipment.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs, type Npc } from '../../../api/queries/Npcs.js';
import { reader } from '../../../adapter/ClientAdapter.js';
import { once, task } from '../Task.js';
import { MINE_Z, walkToward } from './helpers.js';

const VANNAKA = 'Combat Instructor';
const RAT = 'Giant rat';
const WORN_TAB = 4;
const COMBAT_TAB = 0;
const MINE_GATE_X = 3094;
const PEN_EAST_X = 3110;
const PEN_SOUTH_Z = 9512;
const PEN_GATE_BOX = { minX: 3109, maxX: 3113, minZ: 9516, maxZ: 9521 };
const EXIT_LADDER_BOX = { minX: 3106, maxX: 3116, minZ: 9522, maxZ: 9530 };

const noDialog = () => !ChatDialog.isOpen();
const inCombatArea = () => {
    const tile = Game.tile();
    return tile !== null && tile.z >= MINE_Z && tile.x > MINE_GATE_X;
};
const inPen = () => {
    const tile = Game.tile();
    return tile !== null && tile.z >= MINE_Z && tile.x <= PEN_EAST_X && tile.z >= PEN_SOUTH_Z;
};
const hasSwordOrShield = () => Inventory.contains('Bronze sword') || Inventory.contains('Wooden shield') || Equipment.contains('Bronze sword') || Equipment.contains('Wooden shield');
const hasBow = () => Inventory.contains('Shortbow') || Equipment.contains('Shortbow');
const penGate = () => Locs.query().name('Gate').action('Open').inside(PEN_GATE_BOX).nearest();

async function talkUntil(done: () => boolean): Promise<void> {
    const npc = Npcs.query().name(VANNAKA).within(40).nearest();
    if (!npc) return;
    if (npc.distance() > 5) return walkToward(npc.tile());
    await npc.interact('Talk-to');
    await Execution.delayUntil(done, 8000);
}

function ratFight(): (range: number) => Promise<boolean> {
    let targetIndex = -1;
    return async range => {
        if (targetIndex !== -1) {
            const target = Npcs.query()
                .name(RAT)
                .where((npc: Npc) => npc.index === targetIndex)
                .first();
            if (!target) {
                targetIndex = -1;
                return true;
            }
            if (Game.inCombat() || target.inCombat) {
                await Execution.delayTicks(5);
                return false;
            }
            targetIndex = -1;
        }
        const rat = Npcs.query().name(RAT).action('Attack').within(range).nearest();
        if (!rat) return false;
        await rat.interact('Attack');
        const index = rat.index;
        const engaged = await Execution.delayUntil(
            () =>
                Game.inCombat() ||
                Npcs.query()
                    .name(RAT)
                    .where((npc: Npc) => npc.index === index)
                    .results()
                    .some(npc => npc.inCombat),
            8000
        );
        if (engaged) targetIndex = index;
        return false;
    };
}

export function combatStages(): Task[] {
    let meleeKillDone = false;
    let rangedKillDone = false;
    const meleeFight = ratFight();
    const rangedFight = ratFight();
    return [
        task(
            () => noDialog() && inCombatArea() && reader.sideTabInterface(WORN_TAB) === -1,
            () => talkUntil(() => reader.sideTabInterface(WORN_TAB) !== -1)
        ),
        once(
            () => noDialog() && inCombatArea() && reader.sideTabInterface(WORN_TAB) !== -1 && reader.activeSideTab() !== WORN_TAB,
            () => Game.openSideTab(WORN_TAB)
        ),
        task(
            () => noDialog() && inCombatArea() && reader.activeSideTab() === WORN_TAB && Inventory.contains('Bronze dagger') && !Equipment.contains('Bronze dagger') && !hasSwordOrShield(),
            () => Equipment.equip('Bronze dagger')
        ),
        task(
            () => noDialog() && inCombatArea() && Equipment.contains('Bronze dagger') && !hasSwordOrShield(),
            () => talkUntil(() => Inventory.contains('Bronze sword') || Inventory.contains('Wooden shield'))
        ),
        once(
            () => noDialog() && inCombatArea() && !hasBow() && (Inventory.contains('Bronze sword') || Inventory.contains('Wooden shield')) && !(Equipment.contains('Bronze sword') && Equipment.contains('Wooden shield')),
            async () => {
                if (Inventory.contains('Bronze sword')) await Equipment.equip('Bronze sword');
                if (Inventory.contains('Wooden shield')) await Equipment.equip('Wooden shield');
                return Equipment.contains('Bronze sword') && Equipment.contains('Wooden shield');
            }
        ),
        once(
            () => noDialog() && inCombatArea() && Equipment.contains('Bronze sword') && Equipment.contains('Wooden shield') && reader.sideTabInterface(COMBAT_TAB) !== -1 && reader.activeSideTab() !== COMBAT_TAB,
            () => Game.openSideTab(COMBAT_TAB)
        ),
        once(
            () => noDialog() && inCombatArea() && !inPen() && !meleeKillDone && reader.activeSideTab() === COMBAT_TAB && !Game.inCombat(),
            async () => {
                const gate = penGate();
                if (!gate) return false;
                if (gate.distance() > 5) {
                    await walkToward(gate.tile());
                    return false;
                }
                await gate.interact('Open');
                return Execution.delayUntil(inPen, 8000);
            }
        ),
        task(
            () => !meleeKillDone && noDialog() && inPen() && Equipment.contains('Bronze sword'),
            async () => {
                if (await meleeFight(12)) meleeKillDone = true;
            }
        ),
        task(
            () => meleeKillDone && noDialog() && inCombatArea() && !hasBow() && !Game.inCombat(),
            async () => {
                if (inPen()) {
                    const gate = penGate();
                    if (!gate) return;
                    if (gate.distance() > 5) return walkToward(gate.tile());
                    await gate.interact('Open');
                    await Execution.delayUntil(() => !inPen(), 8000);
                    return;
                }
                await talkUntil(() => Inventory.contains('Shortbow'));
            }
        ),
        task(
            () => !rangedKillDone && meleeKillDone && noDialog() && inCombatArea() && !inPen() && hasBow(),
            async () => {
                if (!Equipment.contains('Shortbow')) return void (await Equipment.equip('Shortbow'));
                if (!Equipment.contains('Bronze arrow')) return void (await Equipment.equip('Bronze arrow'));
                if (await rangedFight(15)) rangedKillDone = true;
            }
        ),
        once(
            () => rangedKillDone && noDialog() && Locs.query().name('Ladder').action('Climb-up').inside(EXIT_LADDER_BOX).exists(),
            async () => {
                const ladder = Locs.query().name('Ladder').action('Climb-up').inside(EXIT_LADDER_BOX).nearest();
                if (!ladder) return false;
                if (ladder.distance() > 5) {
                    await walkToward(ladder.tile());
                    return false;
                }
                await ladder.interact('Climb-up');
                return Execution.delayUntil(() => {
                    const tile = Game.tile();
                    return tile !== null && tile.z < MINE_Z;
                }, 8000);
            }
        )
    ];
}
