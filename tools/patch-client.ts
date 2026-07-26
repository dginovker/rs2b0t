import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const clientDir = 'node_modules/client2';
const client = resolve(root, clientDir);
const patch = resolve(root, 'patches/client2-rs2b0t.patch');

if (!existsSync(client) || !existsSync(patch)) {
    console.error('client2 or its rs2b0t patch is missing; run bun install');
    process.exit(1);
}

function gitApply(inherit: boolean, ...args: string[]): Bun.SyncSubprocess {
    return Bun.spawnSync(['git', 'apply', '--unidiff-zero', `--directory=${clientDir}`, ...args, patch], {
        cwd: root,
        stdout: inherit ? 'inherit' : 'pipe',
        stderr: inherit ? 'inherit' : 'pipe'
    });
}

if (gitApply(false, '--check').exitCode === 0) {
    const applied = gitApply(true);
    if (applied.exitCode !== 0) {
        process.exit(applied.exitCode);
    }
    console.log('applied rs2b0t client integration patch');
} else if (gitApply(false, '--reverse', '--check').exitCode === 0) {
    console.log('rs2b0t client integration patch already applied');
} else {
    console.error('client2 does not match the pinned revision');
    process.exit(1);
}
