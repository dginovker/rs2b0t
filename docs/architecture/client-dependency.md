# Client-TS dependency

rs2b0t owns the bot runtime and consumes the 2004scape browser client from
[`LostCityRS/Client-TS`](https://github.com/LostCityRS/Client-TS). The dependency
is pinned to commit `815ff2a5e54daef02dc761410ddfc4659d7c84d7`; `bun.lock`
also records its archive checksum.

## Size boundary

Before issue #86, `src/` contained 72,927 lines of production TypeScript:
35,680 bot lines and 37,247 vendored client lines. The client copy duplicated
an independently maintained upstream project. Removing it leaves 35,680 lines,
a 51.1% reduction. `bun run source:size` measures and enforces that boundary.

Tests, tools, navigation data, bundled scripts, and documentation do not count
toward that production-source metric and were not removed to reach it.

## rs2b0t integration patch

[`patches/client2-rs2b0t.patch`](../../patches/client2-rs2b0t.patch) is the delta
between the pinned upstream commit and the previous vendored client. It keeps
the build targets, RSA refresh, automated-login lifecycle, background clock,
traffic meter, and bot-facing render metadata byte-for-byte identical.

`bun install` runs `tools/patch-client.ts`. The installer applies the patch to a
clean dependency, accepts an already-patched dependency, and fails if either
the dependency or patch drifted. The patch changes only its own package files;
unchanged files remain in Bun's shared cache.

## Updating Client-TS

1. Pin the new Client-TS commit in `package.json` and run `bun install`.
2. Rebase the integration patch onto that exact upstream tree.
3. Run `bun install --force` to prove a clean patch application.
4. Run `bun run source:size`, `bunx tsc`, `bunx eslint .`, `bun test`, and both
   production builds.
5. Complete a private-server login and bot E2E before merging.

Client-TS and rs2b0t are both MIT licensed.
