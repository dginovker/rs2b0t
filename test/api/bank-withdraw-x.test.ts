import { afterEach, beforeEach, expect, test } from 'bun:test';

import { actions, reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/Execution.js';
import { Bank } from '#/bot/api/hud/Bank.js';
import { Inventory } from '#/bot/api/hud/Inventory.js';
import { ActionRouter } from '#/bot/input/ActionRouter.js';

const original = {
    answerCountDialog: actions.answerCountDialog,
    delayUntil: Execution.delayUntil,
    bankItems: reader.bankItems,
    countDialogOpen: reader.countDialogOpen,
    inventoryCount: Inventory.count,
    invButton: ActionRouter.driver.invButton
};

let bankItems: InvItemSnapshot[];
let coal: number;
let dialogOpen: boolean;

beforeEach(() => {
    bankItems = [
        {
            id: 453,
            count: 100,
            slot: 0,
            name: 'Coal',
            comId: 5382,
            ops: ['Withdraw-1', 'Withdraw-5', 'Withdraw-10', 'Withdraw-All', 'Withdraw-X']
        }
    ];
    coal = 0;
    dialogOpen = false;

    reader.bankItems = () => bankItems;
    reader.countDialogOpen = () => dialogOpen;
    Inventory.count = name => (name.toLowerCase() === 'coal' ? coal : 0);
    ActionRouter.driver.invButton = () => {
        // The live bank list clears while the Withdraw-X dialog and inventory
        // update are in flight. This is not proof that the bank ran out.
        bankItems = [];
        dialogOpen = true;
        return true;
    };
    actions.answerCountDialog = () => true;
});

afterEach(() => {
    actions.answerCountDialog = original.answerCountDialog;
    Execution.delayUntil = original.delayUntil;
    reader.bankItems = original.bankItems;
    reader.countDialogOpen = original.countDialogOpen;
    Inventory.count = original.inventoryCount;
    ActionRouter.driver.invButton = original.invButton;
});

test('Withdraw-X waits for inventory progress while the bank list rehydrates', async () => {
    let wait = 0;
    Execution.delayUntil = async condition => {
        wait++;
        if (wait === 1) {
            return condition();
        }

        // Regression: the old Bank.count(name) === 0 condition returned true
        // here, before any Coal reached the inventory.
        expect(condition()).toBe(false);
        coal = 18;
        expect(condition()).toBe(true);
        return true;
    };

    expect(await Bank.withdrawX('Coal', 18)).toBe(true);
    expect(wait).toBe(2);
    expect(coal).toBe(18);
});
