import type { Task } from '../../api/Bot.js';

type Predicate = () => boolean | Promise<boolean>;
type Action = () => unknown | Promise<unknown>;

export const task = (validate: Predicate, action: Action): Task => ({
    validate,
    async execute() {
        await action();
    }
});

export function once(validate: Predicate, execute: () => boolean | Promise<boolean>): Task {
    let done = false;
    return task(
        () => !done && validate(),
        async () => {
            done = await execute();
        }
    );
}
