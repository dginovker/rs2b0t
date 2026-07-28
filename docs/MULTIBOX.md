[Manual](README.md) › MultiBox

# MultiBox

The wall runs several accounts in **one browser tab**. That is the whole point: one
tab per account means every tab but the front one is throttled to about 1 fps and its
bot starves. In a single tab they all hold full speed while that tab is visible.

`multibox.html` locally, or `/rs2b0t/wall` on the hosted build.

## Contents

- [Live clients and renderers](#live-clients-and-renderers)
- [Profiles and the vault](#profiles-and-the-vault)
- [Login coordination](#login-coordination)
- [Large-fleet performance](#large-fleet-performance)
- [Resource telemetry](#resource-telemetry)
- [Viewers and the launcher](#viewers-and-the-launcher)

## Live clients and renderers

Every slot is the ordinary bot client and full bot panel. The focused client draws
at full speed; rail clients keep their live previews at about 1 fps. Each runtime is
an isolated dynamic module, while immutable client/config code and cache workers are
shared across the wall instead of being duplicated in one iframe per account.

The **Game renderer** checkbox below each bot's log is per account and persisted.
Turning it off keeps that exact client, game socket, decoded state, script, and panel
running while releasing its canvas surfaces, minimap, and rendered scene. Turning it
back on rebuilds the scene from retained map/state data; it does not reconnect,
re-login, or restart the script. An account saved with its renderer off starts on the
compact path without first allocating visual resources.

[`MultiBoxController`](../src/bot/multibox/MultiBoxController.ts) owns the shared
model and [`DomSlotOps`](../src/bot/multibox/DomSlotOps.ts) owns the live DOM slots.

A slot exposes a narrow handle rather than its internals:

```ts
export interface SlotHandle {
    setRenderMode(mode: RenderMode): void;
    setRendererEnabled(enabled: boolean): void;
    startScript(name: string): void;
    setCredentials(username: string, password: string): void;
    setAutoLogin(on: boolean): void;
    setLoginCoordination(coordination: LoginCoordination | null): void;
    status(): SlotStatus;
}
```

Four details that are not guessable from the outside:

- **Rail slots pump protocol state at 5 Hz and paint at ~1 fps; the focused slot
  pumps and draws at 50 fps.** The logical client clock remains 50 Hz in both cases.
- **Tiles carry a click-catching overlay** (`.mbx-hit`) so selecting or dragging a
  tile does not send accidental input to the game canvas.
- **Storage is boxed per account.** Same-origin clients share one `sessionStorage`,
  so every slot would otherwise overwrite the others' credentials or settings — see
  [per-instance storage](ARCHITECTURE.md#per-instance-storage).
- `SlotStatus.player` is the logged-in character *once known*: a bot is added empty
  and has its account typed into its own panel, so the rail tile cannot show a name
  before that.

Reordering changes CSS order without moving or rebuilding a live client. Focus and
renderer changes likewise preserve the client object and its socket.

## Large-fleet performance

Renderer-off clients release per-account visual surfaces and modelled scenes. Large
immutable client/config modules are parsed once, while each account still owns its
mutable protocol, interface, inventory, script, map, and storage state. The fleet
shares one on-demand cache worker and one navigation worker.

The repeatable local-server benchmark is:

```sh
bun tools/multibox-perf-test.ts --base http://localhost:8890 \
  --renderers off --bots 20 --seconds 60 --label renderers-off-20
```

It waits for all clients to enter the game and for every selected script to loop,
then measures wall-clock CPU over the complete Chrome process tree, Linux PSS/RSS,
event-loop delay, focus latency, logical game-clock rate, actual client-pump rate,
server ticks, and script loops. It writes JSON plus a full-page screenshot under
`out/`. Use `--renderers on` against the same build for the visual control run.

For an active navigation check, the harness can also require every account to
change tiles during the sample:

```sh
bun tools/multibox-perf-test.ts --base http://localhost:8890 \
  --renderers off --bots 20 --seconds 120 --script TutorialBot \
  --require-movement --label renderers-off-tutorial
```

The issue-99 local-server validation kept 20 renderer-off accounts running for
600 seconds at 0.05 Chrome CPU cores and 490.7 MiB PSS. All accounts held a 50 Hz
logical clock, 1.67 server ticks/s, running scripts, and login-stream generation
1. A separate 120-second TutorialBot run moved every account 10–11 tiles with the
same tick and connection invariants.

## Profiles and the vault

Saved accounts live in [`ProfileVault`](../src/bot/multibox/ProfileVault.ts),
encrypted at rest in `localStorage` with **AES-GCM under a PBKDF2-derived key**
(SHA-256, 310 000 iterations, per-vault salt and IV). It uses WebCrypto, which is
native to both Bun and Chromium — no dependency.

```ts
export type VaultStatus = 'empty' | 'locked' | 'plaintext-legacy' | 'unlocked';
```

`plaintext-legacy` is the migration state: an older build stored profiles unencrypted
under a different key, and that is detected rather than silently discarded.

[`ProfileChooser`](../src/bot/multibox/ProfileChooser.ts) is the load-or-create screen
and [`VaultPrompt`](../src/bot/multibox/VaultPrompt.ts) the unlock prompt. Both are
DOM view modules, and are named explicitly in the
[DOM fence](ARCHITECTURE.md#the-fences) alongside `src/bot/ui/`.

## Login coordination

Logging a wall in is not "log everyone in at once". The production server permits
**four attempts for one client UID, then rejects the fifth** until that UID has been
idle for 15 seconds — and every attempt refreshes that server-side TTL, so the
cooldown is measured from the *latest* permit, not the first.

[`LoginCoordinator`](../src/bot/multibox/LoginCoordinator.ts) hands out permits across
every client in the wall to stay inside that budget:

```ts
export const LOGIN_BATCH_SIZE = 4;
export const LOGIN_ATTEMPT_SPACING_MS = 1000;
export const LOGIN_BATCH_COOLDOWN_MS = 16000;
```

Slots request a permit through the [`LoginCoordination`](../src/bot/runtime/LoginCoordination.ts)
interface, which the single-instance client also implements as a no-op — so the same
client code runs both standalone and in a wall.

## Resource telemetry

The rail shows bot count, CPU, RAM, and bot traffic
([`ResourcePanel`](../src/bot/multibox/ResourcePanel.ts)).

On Linux, every managed viewer is launched in its own transient systemd cgroup-v2
scope: CPU is the delta of cumulative `cpu.stat usage_usec`, and RAM is
`memory.current`. Those counters cover every browser thread and process, and remain
valid when Firefox or Chrome creates or exits content processes. On macOS the monitor
uses the dedicated viewer's process tree instead. Each bot client and cache worker
counts its actual WebSocket application payload in both directions and publishes
deltas to the wall, so direct production sockets are included even when they bypass
the local proxy. HTTP assets, headers, and transport overhead are not counted. The
card updates once per second by changing its own text only — it never reloads or
reparents a bot client.

Bot count and traffic are measured inside the browser, so they work on any wall. CPU
and RAM come from the local proxy's `/__rs2b0t/resources`; a wall served straight from
an engine (hosted, or `deploy-local.sh`) has no such endpoint, and those two rows are
hidden rather than shown as permanently `offline`. A monitor that answers but
misbehaves is a different case and still reports loudly on every row.

### Honesty rules

The card **never substitutes guessed or zero values for missing telemetry.**

| Reading | Means |
|---|---|
| `measuring…` | a real second sample is still pending |
| `unavailable` | this metric's source cannot currently be measured |
| `offline` | the resource endpoint cannot be reached |
| `monitor error` | the endpoint answered, but its response was invalid |

Traffic shows a numeric `0 B/s` only after two unchanged browser-counter samples while
at least one bot publisher is present. An empty wall reports that no publisher
appeared. There are no last-known values, no host or headroom estimates, and no
zero-value substitutes for missing data.

## Viewers and the launcher

`bun run b0t` runs the wall against live through a local proxy, in a dedicated
browser. A dedicated profile is not incidental — a shared browser includes unrelated
tabs and cannot give honest bot-only CPU/RAM attribution.

The viewer choices, the DevTools MCP wiring, the viewer/proxy lifecycle rules, and the
checkout-wide launcher lock are documented in [Dev and deploy](DEV.md#live-wall-viewers-and-the-launcher).

The wall does **not** survive being backgrounded: the game loop is `setTimeout`-driven
and Chrome clamps hidden tabs to 1/sec, so minimising it starves every bot at once.
For unattended running use the [Electron shell](../desktop/README.md), which disables
background throttling.

## See also

- [Manual index](README.md)
- [Architecture](ARCHITECTURE.md#per-instance-storage) — why storage is boxed per account
- [Dev and deploy](DEV.md) — run modes, viewers, and the hosting pipeline
- [Running locally](RUNNING.md#the-multibox-wall) — opening a wall
- [`desktop/README.md`](../desktop/README.md) — the unthrottled shell
