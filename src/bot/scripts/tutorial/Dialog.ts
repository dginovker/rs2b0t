import { Execution } from '../../api/Execution.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { task } from './Task.js';

const DECLINE_SKIP = ['no, thank you'];

const MOVE_ON = ['ready to move on', 'yes.', 'nothing, thanks'];

export const advanceDialog = () =>
    task(ChatDialog.isOpen, async () => {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            return;
        }

        const opts = ChatDialog.options();
        if (opts.length === 0) {
            return;
        }

        const lowered = opts.map(o => o.toLowerCase());
        let pick = lowered.findIndex(o => DECLINE_SKIP.some(d => o.includes(d)));
        if (pick === -1) {
            pick = lowered.findIndex(o => MOVE_ON.some(m => o.includes(m)));
        }
        if (pick === -1) {
            pick = opts.length - 1;
        }

        await ChatDialog.chooseOption(opts[pick]);
        await Execution.delayTicks(1);
    });
