import { describe, expect, test } from 'bun:test';
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { BotHost } from '#/bot/BotHost.js';
import { AutoRelogin } from '#/bot/runtime/AutoRelogin.js';
import type { LoginCoordination } from '#/bot/runtime/LoginCoordination.js';

describe('AutoRelogin title-screen flag (#215)', () => {
    test('isAutoLogin mirrors setAutoLogin', () => {
        AutoRelogin.setAutoLogin(true);
        expect(AutoRelogin.isAutoLogin()).toBe(true);
        AutoRelogin.setAutoLogin(false);
        expect(AutoRelogin.isAutoLogin()).toBe(false);
    });
});

describe('AutoRelogin multibox permit state', () => {
    test('tracks denial and clears before login or when its inputs are cancelled', () => {
        const original = {
            ingame: reader.ingame,
            loginMessage: reader.loginMessage,
            login: actions.login
        };
        let permit = false;
        let loginCalls = 0;
        const coordination: LoginCoordination = {
            requestPermit: () => permit,
            holdFor: () => {}
        };

        try {
            reader.ingame = () => false;
            reader.loginMessage = () => '';
            actions.login = () => {
                loginCalls++;
                return true;
            };
            AutoRelogin.setCredentials('queue-state-test', 'test');
            AutoRelogin.setLoginCoordination(coordination);
            AutoRelogin.setAutoLogin(true);
            AutoRelogin.enable();

            BotHost.onFrame();
            expect(AutoRelogin.isWaitingForLoginPermit()).toBe(true);
            expect(loginCalls).toBe(0);

            permit = true;
            BotHost.onFrame();
            expect(AutoRelogin.isWaitingForLoginPermit()).toBe(false);
            expect(loginCalls).toBe(1);

            AutoRelogin.setAutoLogin(false);
            expect(AutoRelogin.isWaitingForLoginPermit()).toBe(false);
            permit = false;
            AutoRelogin.setAutoLogin(true);
            BotHost.onFrame();
            expect(AutoRelogin.isWaitingForLoginPermit()).toBe(true);

            AutoRelogin.setCredentials('', '');
            expect(AutoRelogin.isWaitingForLoginPermit()).toBe(false);

            AutoRelogin.setCredentials('queue-state-test', 'test');
            BotHost.onFrame();
            expect(AutoRelogin.isWaitingForLoginPermit()).toBe(true);
            AutoRelogin.setLoginCoordination(null);
            expect(AutoRelogin.isWaitingForLoginPermit()).toBe(false);

            AutoRelogin.setLoginCoordination(coordination);
            BotHost.onFrame();
            expect(AutoRelogin.isWaitingForLoginPermit()).toBe(true);
            reader.ingame = () => true;
            BotHost.onFrame();
            expect(AutoRelogin.isWaitingForLoginPermit()).toBe(false);
        } finally {
            AutoRelogin.setAutoLogin(false);
            AutoRelogin.setCredentials('', '');
            AutoRelogin.setLoginCoordination(null);
            reader.ingame = original.ingame;
            reader.loginMessage = original.loginMessage;
            actions.login = original.login;
        }
    });
});
