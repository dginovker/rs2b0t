import { actions, reader, WELCOME_SCREEN } from '../../adapter/ClientAdapter.js';
import { task } from './Task.js';

export const welcomeScreen = () =>
    task(
        () => reader.modals().main === WELCOME_SCREEN,
        async () => {
            const btn = reader.buttonByText(WELCOME_SCREEN, 'Click here to play');
            if (btn !== -1) {
                actions.ifButton(btn);
            }
        }
    );
