// Центр уведомлений: события лаунчера копятся здесь вместо всплывающих окон.
import { useSyncExternalStore } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

export interface Note { id: number; at: number; kind: "info" | "warn" | "err"; title: string; body?: string; profile?: string }

const KEY = "axel.notes";
/** Ключ до переименования лаунчера (Quarry): читаем, если нового ещё нет. */
const OLD_KEY = "quarry.notes";
// Лента сохраняется между запусками (только у этого пользователя, в localStorage).
let notes: Note[] = (() => { try { return JSON.parse((localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY)) ?? "[]") as Note[]; } catch { return []; } })();
let unread = 0;
let seq = notes.reduce((m, n) => Math.max(m, n.id), 0);
const listeners = new Set<() => void>();
const emit = () => {
  try { localStorage.setItem(KEY, JSON.stringify(notes)); } catch { /* не страшно */ }
  listeners.forEach((l) => l());
};

export function pushNote(n: Omit<Note, "id" | "at">) {
  notes = [{ ...n, id: ++seq, at: Date.now() }, ...notes].slice(0, 50);
  unread += 1;
  emit();
}
export function markRead() { if (unread) { unread = 0; emit(); } }
export function clearNotes() { notes = []; unread = 0; emit(); }

let snapshot = { notes, unread };
export function useNotes(): { notes: Note[]; unread: number } {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => (snapshot.notes === notes && snapshot.unread === unread ? snapshot : (snapshot = { notes, unread })),
  );
}

// Уведомления системы (идеи 44 и 64): только когда окно Axel' не на виду. Нажатие на
// уведомление выводит окно вперёд, а окно открывает то, о чём было уведомление.
export type JumpTarget = { screen: "logs" } | { screen: "profile"; id: string };
type Prefs = { system_notifications: boolean; notification_sound: boolean; on_game_start: string };
export const notifyPrefs: Prefs = { system_notifications: true, notification_sound: true, on_game_start: "ask" };
export function setNotifyPrefs(p: Partial<Prefs>) { Object.assign(notifyPrefs, p); }

let jump: { target: JumpTarget; at: number } | null = null;

export async function systemNotify(title: string, body?: string, target?: JumpTarget) {
  if (!notifyPrefs.system_notifications || document.hasFocus()) return;
  try {
    let ok = await isPermissionGranted();
    if (!ok) ok = (await requestPermission()) === "granted";
    if (!ok) return;
    sendNotification({ title, body, sound: notifyPrefs.notification_sound ? "default" : undefined });
    if (target) jump = { target, at: Date.now() };
  } catch { /* без уведомлений системы остаётся лента в «Логах» */ }
}

/** Куда перейти, когда окно снова на виду (уведомление не старше 10 минут). */
export function takeJump(): JumpTarget | null {
  const j = jump;
  jump = null;
  return j && Date.now() - j.at < 10 * 60_000 ? j.target : null;
}
