let counter = 0;

// Per-load random salt: the monotonic counter resets to 0 on every page load and
// is per-module-instance, and Date.now() is only ms-resolution — so without a random
// component a fresh session (or a second bundled copy of core) could mint an id that
// collides with a persisted one. The salt makes cross-load collisions astronomically
// unlikely while keeping ids stable within a session.
const salt = randomSalt();

function randomSalt(): string {
  try {
    const g = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (g?.randomUUID) return g.randomUUID().replace(/-/g, '').slice(0, 8);
  } catch {
    /* fall through */
  }
  // Fallback for environments without crypto.randomUUID.
  return Math.floor(Math.random() * 0xffffffff).toString(36);
}

export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${salt}-${counter.toString(36)}`;
}
