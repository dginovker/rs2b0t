import { reader } from '../adapter/ClientAdapter.js';
import { bus } from './EventBus.js';

let lastTick = 0;
let lastXp: number[] | null = null;
let lastLevel: number[] | null = null;
let lastInvIds: number[] | null = null;
let lastInvCounts: number[] | null = null;
let lastVarps: number[] | null = null;
let lastChatSig: string | null = null;
let lastPollAt = Number.NEGATIVE_INFINITY;

export const EVENT_POLL_INTERVAL_MS = 100;

export function eventPollDue(now: number, previous: number): boolean {
    return now < previous || now - previous >= EVENT_POLL_INTERVAL_MS;
}

export function pumpProducers(tickCount: number): void {
    if (!reader.ingame()) {
        lastXp = lastLevel = lastInvIds = lastInvCounts = lastVarps = null;
        lastChatSig = null;
        lastPollAt = Number.NEGATIVE_INFINITY;
        return;
    }

    if (tickCount !== lastTick) {
        lastTick = tickCount;
        bus.emit('tick', { tick: tickCount });
    }

    const now = performance.now();
    if (!eventPollDue(now, lastPollAt)) {
        return;
    }
    lastPollAt = now;

    if (bus.hasListeners('skill.xp') || bus.hasListeners('skill.level')) {
        diffSkills();
    } else {
        lastXp = lastLevel = null;
    }
    if (bus.hasListeners('inventory.changed')) {
        diffInventory();
    } else {
        lastInvIds = lastInvCounts = null;
    }
    if (bus.hasListeners('varp.changed')) {
        diffVarps();
    } else {
        lastVarps = null;
    }
    if (bus.hasListeners('chat.message')) {
        diffChat();
    } else {
        lastChatSig = null;
    }
}

function diffSkills(): void {
    const count = reader.skillCount();
    const xp: number[] = new Array(count);
    const level: number[] = new Array(count);

    for (let i = 0; i < count; i++) {
        const stat = reader.stat(i);
        xp[i] = stat.xp;
        level[i] = stat.base;

        if (lastXp && stat.xp > lastXp[i]) {
            bus.emit('skill.xp', { skill: i, name: stat.name, xp: stat.xp, delta: stat.xp - lastXp[i] });
        }

        if (lastLevel && stat.base !== lastLevel[i] && lastLevel[i] > 0) {
            bus.emit('skill.level', { skill: i, name: stat.name, level: stat.base, previous: lastLevel[i] });
        }
    }

    lastXp = xp;
    lastLevel = level;
}

function diffInventory(): void {
    const items = reader.inventory();
    const size = reader.inventorySize();
    if (size === 0) {
        return;
    }

    const ids: number[] = new Array(size).fill(-1);
    const counts: number[] = new Array(size).fill(0);
    const names: (string | null)[] = new Array(size).fill(null);

    for (const item of items) {
        ids[item.slot] = item.id;
        counts[item.slot] = item.count;
        names[item.slot] = item.name;
    }

    if (lastInvIds && lastInvCounts) {
        for (let slot = 0; slot < size; slot++) {
            if (ids[slot] !== lastInvIds[slot] || counts[slot] !== lastInvCounts[slot]) {
                bus.emit('inventory.changed', {
                    slot,
                    id: ids[slot],
                    name: names[slot],
                    count: counts[slot],
                    previousId: lastInvIds[slot],
                    previousCount: lastInvCounts[slot]
                });
            }
        }
    }

    lastInvIds = ids;
    lastInvCounts = counts;
}

const VARP_SCAN = 300;

function diffVarps(): void {
    const varps: number[] = new Array(VARP_SCAN);
    for (let i = 0; i < VARP_SCAN; i++) {
        varps[i] = reader.varp(i);
    }

    if (lastVarps) {
        for (let i = 0; i < VARP_SCAN; i++) {
            if (varps[i] !== lastVarps[i]) {
                bus.emit('varp.changed', { index: i, value: varps[i], previous: lastVarps[i] });
            }
        }
    }

    lastVarps = varps;
}

function diffChat(): void {
    const lines = reader.chat(20);
    if (lines.length === 0) {
        return;
    }

    const sig = (l: { type: number; username: string | null; text: string }) => `${l.type}|${l.username ?? ''}|${l.text}`;

    if (lastChatSig === null) {
        lastChatSig = sig(lines[0]);
        return;
    }

    const fresh = [];
    for (const line of lines) {
        if (sig(line) === lastChatSig) {
            break;
        }

        fresh.push(line);
    }

    lastChatSig = sig(lines[0]);

    for (const line of fresh.reverse()) {
        bus.emit('chat.message', line);
    }
}
