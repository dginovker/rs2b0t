import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Skills } from '../../../api/hud/Skills.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { reader } from '../../../adapter/ClientAdapter.js';
import { once, task } from '../Task.js';
import { doorAt, MINE_Z, QUEST_GUIDE_DOOR, walkToward } from './helpers.js';

const GUIDE = 'Quest Guide';
const QUEST_TAB = 2;
const HALL_INSIDE = { x: 3086, z: 3123 };
const noDialog = () => !ChatDialog.isOpen();
const nearGuide = () => Npcs.query().name(GUIDE).within(10).exists();
const beforeMine = () => Skills.xp('mining') === 0;
const insideHall = () => {
    const tile = Game.tile();
    return tile !== null && tile.z < QUEST_GUIDE_DOOR.z && tile.z >= 3110;
};
const northOfHall = () => {
    const tile = Game.tile();
    return tile !== null && tile.z >= QUEST_GUIDE_DOOR.z && tile.z <= QUEST_GUIDE_DOOR.z + 8 && tile.x >= QUEST_GUIDE_DOOR.x - 8 && tile.x <= QUEST_GUIDE_DOOR.x + 8;
};

async function talkToGuide(): Promise<boolean> {
    const npc = Npcs.query().name(GUIDE).nearest();
    if (!npc) return false;
    await npc.interact('Talk-to');
    return Execution.delayUntil(ChatDialog.isOpen, 8000);
}

export function questGuideStages(): Task[] {
    let talkedAgain = false;
    return [
        task(
            () => noDialog() && beforeMine() && northOfHall() && Npcs.query().name(GUIDE).within(12).exists(),
            async () => {
                const door = doorAt(QUEST_GUIDE_DOOR).nearest();
                if (!door) return walkToward(HALL_INSIDE);
                if (door.distance() > 5) return walkToward(QUEST_GUIDE_DOOR);
                await door.interact('Open');
                await Execution.delayUntil(insideHall, 8000);
                await Execution.delayTicks(2);
            }
        ),
        once(() => noDialog() && beforeMine() && insideHall() && nearGuide(), talkToGuide),
        once(
            () => noDialog() && beforeMine() && reader.sideTabInterface(QUEST_TAB) !== -1 && reader.activeSideTab() !== QUEST_TAB,
            () => Game.openSideTab(QUEST_TAB)
        ),
        once(
            () => noDialog() && beforeMine() && insideHall() && nearGuide() && reader.activeSideTab() === QUEST_TAB,
            async () => (talkedAgain = await talkToGuide())
        ),
        once(
            () => noDialog() && beforeMine() && talkedAgain && Locs.query().name('Ladder').action('Climb-down').within(10).exists(),
            async () => {
                const ladder = Locs.query().name('Ladder').action('Climb-down').within(10).nearest();
                if (!ladder) return false;
                if (ladder.distance() > 5) {
                    await walkToward(ladder.tile());
                    return false;
                }
                await ladder.interact('Climb-down');
                return Execution.delayUntil(() => {
                    const tile = Game.tile();
                    return tile !== null && tile.z >= MINE_Z;
                }, 8000);
            }
        )
    ];
}
