import { expect, test } from 'bun:test';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import '#/bot/scripts/index.js';

test('Firemaker appears in the Firemaking category', () => {
    expect(ScriptRegistry.get('Firemaker')?.category).toBe('Firemaking');
});
