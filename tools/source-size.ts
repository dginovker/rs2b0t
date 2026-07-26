import { readFileSync } from 'node:fs';

const BASELINE = 72_927;
const files = [...new Bun.Glob('src/**/*.{ts,tsx}').scanSync({ onlyFiles: true })];
const lines = files.reduce((sum, file) => sum + (readFileSync(file, 'utf8').match(/\n/g)?.length ?? 0), 0);
const reduction = ((BASELINE - lines) / BASELINE) * 100;

console.log(`${lines} production TypeScript lines (${reduction.toFixed(1)}% below ${BASELINE})`);
if (lines > Math.floor(BASELINE / 2)) {
    console.error(`issue #86 target missed: ${lines} > ${Math.floor(BASELINE / 2)}`);
    process.exit(1);
}
