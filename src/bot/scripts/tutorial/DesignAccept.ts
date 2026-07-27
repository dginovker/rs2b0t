import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/Execution.js';
import type TutorialBot from '../TutorialBot.js';
import { task } from './Task.js';

const DESIGN_MODAL = 3559;

export const designAccept = (bot: TutorialBot) =>
    task(
        () => reader.modals().main === DESIGN_MODAL,
        async () => {
            const accept = reader.buttonByText(DESIGN_MODAL, 'Accept');
            if (accept === -1) {
                bot.log('DesignAccept: no "Accept" button under the design modal — component renumbered?');
                return;
            }

            actions.ifButton(accept);
            await Execution.delayUntil(() => reader.modals().main !== DESIGN_MODAL, 3000);
        }
    );
