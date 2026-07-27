import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { Bank } from '../../../api/hud/Bank.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Skills } from '../../../api/hud/Skills.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { actions, reader } from '../../../adapter/ClientAdapter.js';
import { once, task } from '../Task.js';
import { doorAt, MINE_Z, walkToward } from './helpers.js';

const ADVISOR = 'Financial Advisor';
const BRACE = 'Brother Brace';
const PRAYER_TAB = 5;
const FRIENDS_TAB = 8;
const IGNORE_TAB = 9;
const BOOTH_BOX = { minX: 3119, maxX: 3123, minZ: 3123, maxZ: 3125 };
const ADVISOR_DOOR = { x: 3125, z: 3124 };
const ADVISOR_EXIT_DOOR = { x: 3130, z: 3124 };
const CHAPEL_DOOR_BOX = { minX: 3127, maxX: 3131, minZ: 3104, maxZ: 3109 };
const CHAPEL_INSIDE = { x: 3125, z: 3106 };
const CHAPEL_EXIT_DOOR = { x: 3122, z: 3102 };
const ADVISOR_ROOM = { minX: 3125, maxX: 3129, minZ: 3120, maxZ: 3128 };
const CHAPEL = { minX: 3118, maxX: 3128, minZ: 3103, maxZ: 3111 };
const CLICK_RANGE = 12;

const noDialog = () => !ChatDialog.isOpen();
const inBox = (box: { minX: number; maxX: number; minZ: number; maxZ: number }) => {
    const tile = Game.tile();
    return tile !== null && tile.x >= box.minX && tile.x <= box.maxX && tile.z >= box.minZ && tile.z <= box.maxZ;
};
const pastCombat = () => {
    const tile = Game.tile();
    return tile !== null && tile.z < MINE_Z && Skills.xp('ranged') > 0;
};
const preAdvisorArea = () => {
    const tile = Game.tile();
    return tile !== null && tile.x <= 3124 && tile.z >= 3112;
};
const chapelApproach = () => {
    const tile = Game.tile();
    return tile !== null && tile.x >= 3129 && tile.x <= 3140 && tile.z >= 3103 && tile.z <= 3126;
};
const inAdvisorRoom = () => inBox(ADVISOR_ROOM);
const insideChapel = () => inBox(CHAPEL);

async function crossDoor(tile: { x: number; z: number }, crossed: () => boolean): Promise<boolean> {
    const door = doorAt(tile).nearest();
    if (!door) {
        await walkToward(tile);
        return false;
    }
    if (door.distance() > CLICK_RANGE) {
        await walkToward(door.tile());
        return false;
    }
    await door.interact('Open');
    return Execution.delayUntil(crossed, 5000);
}

async function talkUntil(name: string, done: () => boolean): Promise<boolean> {
    const npc = Npcs.query().name(name).nearest();
    if (!npc) return false;
    await npc.interact('Talk-to');
    return Execution.delayUntil(done, 8000);
}

export function bankChapelStages(): Task[] {
    let bankOpened = false;
    let advisorTalked = false;
    let braceFinished = false;
    return [
        task(
            () => !bankOpened && noDialog() && pastCombat() && preAdvisorArea(),
            async () => {
                if (Bank.isOpen()) {
                    bankOpened = true;
                    return;
                }
                const booth = Locs.query().name('Bank booth').action('Use').inside(BOOTH_BOX).nearest();
                if (!booth) return walkToward({ x: 3121, z: 3123 });
                if (booth.distance() > CLICK_RANGE) return walkToward(booth.tile());
                await booth.interact('Use');
                await Execution.delayUntil(() => ChatDialog.isOpen() || Bank.isOpen(), 8000);
                bankOpened = Bank.isOpen();
            }
        ),
        task(
            () => Bank.isOpen() && pastCombat(),
            async () => {
                bankOpened = true;
                actions.closeModal();
                await Execution.delayUntil(() => !Bank.isOpen(), 3000);
            }
        ),
        once(
            () => bankOpened && !Bank.isOpen() && noDialog() && pastCombat() && preAdvisorArea(),
            async () => {
                const crossed = await crossDoor(ADVISOR_DOOR, () => {
                    const tile = Game.tile();
                    return tile !== null && tile.x >= ADVISOR_DOOR.x;
                });
                if (!crossed && ChatDialog.isOpen()) bankOpened = false;
                return crossed;
            }
        ),
        once(
            () => !advisorTalked && noDialog() && pastCombat() && inAdvisorRoom() && Npcs.query().name(ADVISOR).within(8).exists(),
            async () => (advisorTalked = await talkUntil(ADVISOR, ChatDialog.isOpen))
        ),
        once(
            () => advisorTalked && noDialog() && pastCombat() && inAdvisorRoom(),
            async () => {
                const crossed = await crossDoor(ADVISOR_EXIT_DOOR, () => {
                    const tile = Game.tile();
                    return tile !== null && tile.x >= ADVISOR_EXIT_DOOR.x;
                });
                if (!crossed && ChatDialog.isOpen()) advisorTalked = false;
                return crossed;
            }
        ),
        task(
            () => noDialog() && pastCombat() && chapelApproach(),
            async () => {
                const door = Locs.query().name('Large door').action('Open').inside(CHAPEL_DOOR_BOX).nearest();
                if (!door) return walkToward(CHAPEL_INSIDE);
                if (door.distance() > CLICK_RANGE) return walkToward(door.tile());
                await door.interact('Open');
                await Execution.delayTicks(4);
            }
        ),
        task(
            () => noDialog() && pastCombat() && insideChapel() && reader.sideTabInterface(PRAYER_TAB) === -1 && Npcs.query().name(BRACE).within(10).exists(),
            () => talkUntil(BRACE, () => reader.sideTabInterface(PRAYER_TAB) !== -1)
        ),
        once(
            () => noDialog() && pastCombat() && insideChapel() && reader.sideTabInterface(PRAYER_TAB) !== -1 && reader.activeSideTab() !== PRAYER_TAB,
            () => Game.openSideTab(PRAYER_TAB)
        ),
        task(
            () => noDialog() && pastCombat() && insideChapel() && reader.sideTabInterface(PRAYER_TAB) !== -1 && reader.sideTabInterface(FRIENDS_TAB) === -1 && Npcs.query().name(BRACE).within(10).exists(),
            () => talkUntil(BRACE, () => reader.sideTabInterface(FRIENDS_TAB) !== -1)
        ),
        once(
            () => noDialog() && pastCombat() && insideChapel() && reader.sideTabInterface(FRIENDS_TAB) !== -1 && reader.activeSideTab() !== FRIENDS_TAB,
            () => Game.openSideTab(FRIENDS_TAB)
        ),
        once(
            () => noDialog() && pastCombat() && insideChapel() && reader.sideTabInterface(IGNORE_TAB) !== -1 && reader.activeSideTab() !== IGNORE_TAB,
            () => Game.openSideTab(IGNORE_TAB)
        ),
        once(
            () => !braceFinished && noDialog() && pastCombat() && insideChapel() && reader.sideTabInterface(IGNORE_TAB) !== -1 && Npcs.query().name(BRACE).within(10).exists(),
            async () => (braceFinished = await talkUntil(BRACE, ChatDialog.isOpen))
        ),
        once(
            () => braceFinished && noDialog() && pastCombat() && insideChapel(),
            async () => {
                const crossed = await crossDoor(CHAPEL_EXIT_DOOR, () => {
                    const tile = Game.tile();
                    return tile !== null && tile.z <= CHAPEL_EXIT_DOOR.z;
                });
                if (!crossed && ChatDialog.isOpen()) braceFinished = false;
                return crossed;
            }
        )
    ];
}
