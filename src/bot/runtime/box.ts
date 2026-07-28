// docs/ARCHITECTURE.md#per-instance-storage
// Per-instance storage namespace. Every bot instance keeps its own credentials
// and settings under a "box" id so nothing bleeds between instances:
//   - a standalone bot.html tab -> box '' , isolated by its own sessionStorage
//   - an embedded MultiBox bot  -> box '<account>', isolated within the tab's
//     shared sessionStorage
// MultiBox configures the box before constructing each private runtime module.
let configuredBoxId: string | null = null;

/**
 * Set the storage namespace for an embedded bot runtime that does not own the
 * page URL (the embedded MultiBox fleet loads each runtime as an ES module in
 * the wall document). Module instances are isolated, so this value remains
 * private to one bot even though every bot shares the same Window.
 */
export function configureBoxId(id: string): void {
    configuredBoxId = id;
}

export function boxId(): string {
    if (configuredBoxId !== null) {
        return configuredBoxId;
    }
    if (typeof location === 'undefined') {
        return '';
    }
    return new URLSearchParams(location.search).get('box') ?? '';
}

export function boxKey(suffix: string): string {
    const id = boxId();
    return id ? `rs2b0t:${id}:${suffix}` : `rs2b0t:${suffix}`;
}

// Relative on purpose: one build serves /rs2b0t/index.html and local dev's
// /bot.html, and this resolves to a real file beside either. './wall' would
// only work under the hosted Caddy rewrite.
export function wallLinkHref(box: string): string | null {
    return box === '' ? './multibox.html' : null;
}
