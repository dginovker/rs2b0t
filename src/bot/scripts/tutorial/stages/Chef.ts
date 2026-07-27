import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Skills } from '../../../api/hud/Skills.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { actions, reader } from '../../../adapter/ClientAdapter.js';
import { once, task } from '../Task.js';
import { doorAt, QUEST_GUIDE_DOOR, walkToward } from './helpers.js';

const CHEF = 'Master Chef';
const MUSIC_TAB = 13;
const CONTROLS_TAB = 12;
const CHEF_DOOR_IN = { x: 3079, z: 3084 };
const CHEF_DOOR_OUT = { x: 3072, z: 3090 };
const CHEF_HOUSE = { minX: 3073, maxX: 3078, minZ: 3081, maxZ: 3091 };
const GATE_LINE_X = 3089;

const noDialog = () => !ChatDialog.isOpen();
const nearChef = () => Npcs.query().name(CHEF).within(8).exists();
const insideChefHouse = () => {
    const tile = Game.tile();
    return tile !== null && tile.x >= CHEF_HOUSE.minX && tile.x <= CHEF_HOUSE.maxX && tile.z >= CHEF_HOUSE.minZ && tile.z <= CHEF_HOUSE.maxZ;
};
const onChefSide = () => {
    const tile = Game.tile();
    return tile !== null && tile.x <= GATE_LINE_X;
};
const breadChainNotStarted = () => !Inventory.contains('Pot of flour') && !Inventory.contains('Bread dough') && !Inventory.contains('Bread');

export function chefStages(): Task[] {
    return [
        task(
            () => noDialog() && Skills.xp('cooking') > 0 && onChefSide() && !insideChefHouse() && breadChainNotStarted(),
            async () => {
                const door = doorAt(CHEF_DOOR_IN).nearest();
                if (!door || door.distance() > 5) return walkToward(CHEF_DOOR_IN);
                await door.interact('Open');
                await Execution.delayUntil(insideChefHouse, 5000);
            }
        ),
        once(
            () => noDialog() && insideChefHouse() && nearChef(),
            async () => {
                const npc = Npcs.query().name(CHEF).nearest();
                if (!npc) return false;
                await npc.interact('Talk-to');
                return Execution.delayUntil(ChatDialog.isOpen, 8000);
            }
        ),
        task(
            () => noDialog() && Inventory.contains('Pot of flour') && Inventory.contains('Bucket of water'),
            async () => {
                const flour = Inventory.first('Pot of flour');
                const water = Inventory.first('Bucket of water');
                if (!flour || !water) return;
                await flour.useOn(water);
                await Execution.delayUntil(() => Inventory.contains('Bread dough'), 5000);
            }
        ),
        task(
            () => noDialog() && Inventory.contains('Bread dough'),
            async () => {
                const dough = Inventory.first('Bread dough');
                const range = Locs.query().name('Range').within(8).nearest();
                if (!dough || !range) return;
                await dough.useOn(range);
                await Execution.delayUntil(() => !Inventory.contains('Bread dough'), 15000);
            }
        ),
        once(
            () => noDialog() && reader.sideTabInterface(MUSIC_TAB) !== -1 && reader.activeSideTab() !== MUSIC_TAB,
            () => Game.openSideTab(MUSIC_TAB)
        ),
        task(
            () => noDialog() && insideChefHouse() && Inventory.contains('Bread'),
            async () => {
                const door = doorAt(CHEF_DOOR_OUT).nearest();
                if (!door || door.distance() > 5) return walkToward(CHEF_DOOR_OUT);
                await door.interact('Open');
                await Execution.delayUntil(() => !insideChefHouse(), 5000);
            }
        ),
        once(
            () => noDialog() && reader.sideTabInterface(CONTROLS_TAB) !== -1 && reader.activeSideTab() !== CONTROLS_TAB,
            () => Game.openSideTab(CONTROLS_TAB)
        ),
        once(
            () => noDialog() && reader.activeSideTab() === CONTROLS_TAB && !Game.runEnabled() && Game.energy() >= 100,
            async () => {
                await actions.setRun(true);
                return Execution.delayUntil(Game.runEnabled, 3000);
            }
        ),
        once(
            () => {
                const tile = Game.tile();
                return noDialog() && Game.runEnabled() && Skills.xp('mining') === 0 && tile !== null && tile.z < QUEST_GUIDE_DOOR.z;
            },
            async () => {
                const door = doorAt(QUEST_GUIDE_DOOR).nearest();
                if (!door || door.distance() > 5) {
                    await walkToward(QUEST_GUIDE_DOOR);
                    return false;
                }
                await door.interact('Open');
                return Execution.delayUntil(() => {
                    const tile = Game.tile();
                    return tile !== null && tile.z >= QUEST_GUIDE_DOOR.z;
                }, 5000);
            }
        )
    ];
}
