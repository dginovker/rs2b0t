import { describe, expect, test } from 'bun:test';

import { EventBus } from '#/bot/events/EventBus.js';
import { EVENT_POLL_INTERVAL_MS, eventPollDue } from '#/bot/events/producers.js';

describe('EventBus listener demand', () => {
    test('tracks active listeners through unsubscribe', () => {
        const bus = new EventBus();
        expect(bus.hasListeners('varp.changed')).toBe(false);

        const off = bus.on('varp.changed', () => {});
        expect(bus.hasListeners('varp.changed')).toBe(true);

        off();
        expect(bus.hasListeners('varp.changed')).toBe(false);
    });
});

describe('producer polling cadence', () => {
    test('polls at 10Hz and immediately after a clock reset', () => {
        expect(eventPollDue(EVENT_POLL_INTERVAL_MS - 1, 0)).toBe(false);
        expect(eventPollDue(EVENT_POLL_INTERVAL_MS, 0)).toBe(true);
        expect(eventPollDue(10, 20)).toBe(true);
    });
});
