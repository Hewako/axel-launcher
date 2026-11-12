// Горячие клавиши с модификатором (решение владельца 12.11.2026): Alt 1–4, Ctrl Enter, Ctrl F.
// На Mac вместо Ctrl — ⌘, вместо Alt — ⌥, как принято в системе.
export const MAC = /Mac/i.test(navigator.userAgent);
/** Подпись модификатора для подсказок: «⌘» на Mac, «Ctrl» на остальных. */
export const MOD = MAC ? "⌘" : "Ctrl";
export const ALT = MAC ? "⌥" : "Alt";
/** Нажат ли «Ctrl» (на Mac — ⌘) без второго модификатора. */
export const isMod = (e: KeyboardEvent) => (MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey;
