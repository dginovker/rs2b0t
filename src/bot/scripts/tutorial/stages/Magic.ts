import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Skills } from '../../../api/hud/Skills.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { reader } from '../../../adapter/ClientAdapter.js';
import { once, task } from '../Task.js';
import { walkToward } from './helpers.js';

const TERROVA = 'Magic Instructor';
const CHICKEN = 'Chicken';
const MAGIC_TAB = 6;
const CHICKEN_PEN = { x: 3139, z: 3092 };
const noDialog = () => !ChatDialog.isOpen();
const inMagicArea = () => {
    const tile = Game.tile();
    return tile !== null && tile.x >= 3118 && tile.x <= 3155 && tile.z >= 3076 && tile.z <= 3102;
};
const hasRunes = () => Inventory.contains('Air rune') && Inventory.contains('Mind rune');

async function talkUntil(done: () => boolean): Promise<void> {
    const npc = Npcs.query().name(TERROVA).within(40).nearest();
    if (!npc) return;
    if (npc.distance() > 5) return walkToward(npc.tile());
    await npc.interact('Talk-to');
    await Execution.delayUntil(done, 8000);
}

export function magicStages(): Task[] {
    let casts = 0;
    return [
        task(
            () => noDialog() && inMagicArea() && reader.sideTabInterface(MAGIC_TAB) === -1,
            async () => {
                const npc = Npcs.query().name(TERROVA).within(40).nearest();
                if (!npc) return walkToward({ x: 3141, z: 3089 });
                if (npc.distance() > 5) return walkToward(npc.tile());
                await npc.interact('Talk-to');
                await Execution.delayUntil(() => reader.sideTabInterface(MAGIC_TAB) !== -1, 8000);
            }
        ),
        once(
            () => noDialog() && inMagicArea() && reader.sideTabInterface(MAGIC_TAB) !== -1 && reader.activeSideTab() !== MAGIC_TAB,
            () => Game.openSideTab(MAGIC_TAB)
        ),
        task(
            () => casts < 2 && noDialog() && inMagicArea() && reader.sideTabInterface(MAGIC_TAB) !== -1 && !hasRunes(),
            () => talkUntil(hasRunes)
        ),
        task(
            () => casts < 2 && noDialog() && inMagicArea() && hasRunes() && !Game.inCombat(),
            async () => {
                const chicken = Npcs.query().name(CHICKEN).within(20).nearest();
                if (!chicken) return walkToward(CHICKEN_PEN);
                if (chicken.distance() > 10) return walkToward(chicken.tile());
                const before = Skills.xp('magic');
                if (!(await Game.castOnNpc('Wind Strike', chicken))) return;
                if (await Execution.delayUntil(() => Skills.xp('magic') > before, 10000)) casts += 1;
            }
        ),
        task(
            () => casts >= 2 && noDialog() && inMagicArea(),
            () => talkUntil(ChatDialog.isOpen)
        )
    ];
}
