import { expect, test } from 'bun:test';

import IfType from '#/config/IfType.js';

test('embedded interface state shares definitions but isolates packet mutations', () => {
    const definition = new IfType();
    definition.text = 'definition';
    definition.linkObjType = new Int32Array([996, 0]);
    definition.linkObjNumber = new Int32Array([10, 0]);
    const definitions: IfType[] = [];
    definitions[3214] = definition;

    const alice = IfType.cloneState(definitions);
    const bob = IfType.cloneState(definitions);

    expect(Object.getPrototypeOf(alice[3214])).toBe(definition);
    expect(Object.getPrototypeOf(bob[3214])).toBe(definition);
    expect(alice[3214]).not.toBe(bob[3214]);
    expect(alice[3214].linkObjType).not.toBe(bob[3214].linkObjType);
    expect(alice[3214].linkObjNumber).not.toBe(bob[3214].linkObjNumber);

    alice[3214].text = 'alice only';
    alice[3214].linkObjType![0] = 1338;
    alice[3214].linkObjNumber![0] = 42;

    expect(bob[3214].text).toBe('definition');
    expect(Array.from(bob[3214].linkObjType!)).toEqual([996, 0]);
    expect(Array.from(bob[3214].linkObjNumber!)).toEqual([10, 0]);
    expect(definition.text).toBe('definition');
    expect(Array.from(definition.linkObjType!)).toEqual([996, 0]);
    expect(Array.from(definition.linkObjNumber!)).toEqual([10, 0]);

    const richDefinition = new IfType();
    richDefinition.text = 'visual definition';
    richDefinition.buttonText = 'Use';
    const richDefinitions: IfType[] = [];
    richDefinitions[3214] = richDefinition;
    IfType.rebaseState(alice, richDefinitions);
    expect(alice[3214].text).toBe('alice only');
    expect(alice[3214].buttonText).toBe('Use');
    expect(Object.getPrototypeOf(alice[3214])).toBe(richDefinition);
});
