/**
 * Tracks whether a person is actually using the page. Pollers consult `isIdle()`
 * so a tab left open on an unattended machine stops hitting the API, and they
 * subscribe with `onWake` to refetch as soon as someone comes back.
 */

/** No interaction for this long and the page counts as idle. */
export const IDLE_MS = 5 * 60 * 1000;

const EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

let lastActivity = Date.now();
let installed = false;
const wakeListeners = new Set<() => void>();

function touch(): void {
  const wasIdle = isIdle();
  lastActivity = Date.now();
  if (wasIdle) {
    for (const fn of wakeListeners) {
      fn();
    }
  }
}

function install(): void {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;
  for (const ev of EVENTS) {
    window.addEventListener(ev, touch, { passive: true, capture: true });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      touch();
    }
  });
}

export function isIdle(): boolean {
  return Date.now() - lastActivity > IDLE_MS;
}

/** Calls `fn` when interaction resumes after an idle stretch. Returns an unsubscribe. */
export function onWake(fn: () => void): () => void {
  install();
  wakeListeners.add(fn);
  return () => {
    wakeListeners.delete(fn);
  };
}
