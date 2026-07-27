import type { Task } from '../../../api/Bot.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Skills } from '../../../api/hud/Skills.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { reader } from '../../../adapter/ClientAdapter.js';
import { once, task } from '../Task.js';

const GUIDE = 'RuneScape Guide';
const EXPERT = 'Survival Expert';
const INVENTORY_TAB = 3;
const STATS_TAB = 1;
const GUIDE_SIDE_MAX_X = 3097;

const noDialog = () => !ChatDialog.isOpen();
const inGuideRoom = () => Npcs.query().name(GUIDE).within(10).exists();
const expertInScene = () => Npcs.query().name(EXPERT).within(30).exists();
const onGuideSide = () => {
    const tile = Game.tile();
    return tile !== null && tile.x <= GUIDE_SIDE_MAX_X;
};

async function talkTo(name: string, timeout: number): Promise<boolean> {
    const npc = Npcs.query().name(name).nearest();
    if (!npc) return false;
    await npc.interact('Talk-to');
    return Execution.delayUntil(ChatDialog.isOpen, timeout);
}

export function survivalStages(): Task[] {
    return [
        once(
            () => noDialog() && inGuideRoom(),
            () => talkTo(GUIDE, 8000)
        ),
        task(
            () => noDialog() && onGuideSide() && inGuideRoom() && Locs.query().name('Door').action('Open').within(10).exists(),
            async () => {
                const door = Locs.query().name('Door').action('Open').within(10).nearest();
                if (!door) return;
                await door.interact('Open');
                await Execution.delayTicks(3);
            }
        ),
        once(
            () => noDialog() && !onGuideSide() && expertInScene(),
            () => talkTo(EXPERT, 10000)
        ),
        task(
            () => noDialog() && reader.sideTabInterface(INVENTORY_TAB) !== -1 && !Inventory.contains('Bronze axe') && reader.activeSideTab() !== INVENTORY_TAB,
            () => Game.openSideTab(INVENTORY_TAB)
        ),
        task(
            () => noDialog() && Skills.xp('firemaking') === 0 && Inventory.contains('Bronze axe') && !Inventory.contains('Logs') && !Game.animating(),
            async () => {
                const tree = Locs.query().name('Tree').action('Chop down').within(15).nearest();
                if (!tree) return;
                await tree.interact('Chop down');
                await Execution.delayUntil(() => Game.animating() || Inventory.contains('Logs'), 8000);
                await Execution.delayUntil(() => Inventory.contains('Logs') || !Game.animating(), 15000);
            }
        ),
        task(
            () => noDialog() && Skills.xp('firemaking') === 0 && Inventory.contains('Logs') && Inventory.contains('Tinderbox') && !Game.animating(),
            async () => {
                const logs = Inventory.first('Logs');
                const box = Inventory.first('Tinderbox');
                if (!logs || !box) return;
                await logs.useOn(box);
                await Execution.delayUntil(() => !Inventory.contains('Logs'), 15000);
            }
        ),
        once(
            () => noDialog() && Skills.xp('firemaking') > 0 && reader.sideTabInterface(STATS_TAB) !== -1 && reader.activeSideTab() !== STATS_TAB,
            () => Game.openSideTab(STATS_TAB)
        ),
        task(
            () => noDialog() && Skills.xp('firemaking') > 0 && !Inventory.contains('Small fishing net') && expertInScene(),
            () => talkTo(EXPERT, 10000)
        ),
        task(
            () => noDialog() && Skills.xp('cooking') === 0 && Inventory.contains('Small fishing net') && !Inventory.contains('Raw shrimps') && !Game.animating(),
            async () => {
                const spot = Npcs.query().name('Fishing spot').action('Net').within(20).nearest();
                if (!spot) return;
                await spot.interact('Net');
                await Execution.delayUntil(() => Game.animating() || Inventory.contains('Raw shrimps'), 8000);
                await Execution.delayUntil(() => Inventory.contains('Raw shrimps') || !Game.animating(), 20000);
            }
        ),
        task(
            () => noDialog() && Skills.xp('cooking') === 0 && Inventory.contains('Raw shrimps'),
            async () => {
                const fire = Locs.query().name('Fire').within(10).nearest();
                if (!fire) {
                    const logs = Inventory.first('Logs');
                    if (!logs) {
                        const tree = Locs.query().name('Tree').action('Chop down').within(15).nearest();
                        if (tree) {
                            await tree.interact('Chop down');
                            await Execution.delayUntil(() => Inventory.contains('Logs'), 15000);
                        }
                        return;
                    }
                    const box = Inventory.first('Tinderbox');
                    if (box) {
                        await logs.useOn(box);
                        await Execution.delayUntil(() => Locs.query().name('Fire').within(10).exists(), 15000);
                    }
                    return;
                }
                const raw = Inventory.first('Raw shrimps');
                if (!raw) return;
                const before = Inventory.items().filter(item => item.name === 'Raw shrimps').length;
                await raw.useOn(fire);
                await Execution.delayUntil(() => Inventory.items().filter(item => item.name === 'Raw shrimps').length < before, 15000);
            }
        ),
        once(
            () => noDialog() && Skills.xp('cooking') > 0 && Locs.query().name('Gate').action('Open').within(20).exists(),
            async () => {
                const gate = Locs.query().name('Gate').action('Open').within(20).nearest();
                if (!gate) return false;
                const dispatched = await gate.interact('Open');
                await Execution.delayTicks(3);
                return dispatched;
            }
        )
    ];
}
