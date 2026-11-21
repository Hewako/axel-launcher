// Комната для игры с друзьями в одной сети. Живёт в ядре (одна на лаунчер), здесь — её состояние
// для интерфейса: переживает переходы между экранами.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

type CoreEvent =
  | { kind: "waiting" }
  | { kind: "world_open"; motd: string; port: number }
  | { kind: "guest_found"; ip: string }
  | { kind: "searching" }
  | { kind: "joined"; motd: string; host: string; port: number }
  | { kind: "error"; message: string };

export type RoomState =
  | { role: "none"; error?: string }
  | { role: "host"; code: string; world?: string; guests: number }
  | { role: "guest"; code: string; world?: string };

let state: RoomState = { role: "none" };
const subs = new Set<(s: RoomState) => void>();
const set = (s: RoomState) => { state = s; subs.forEach((f) => f(s)); };
const seen = new Set<string>();

listen<CoreEvent>("room-event", ({ payload: e }) => {
  if (e.kind === "error") set({ role: "none", error: e.message });
  else if (state.role === "host" && e.kind === "world_open") set({ ...state, world: e.motd });
  else if (state.role === "host" && e.kind === "guest_found" && !seen.has(e.ip)) { seen.add(e.ip); set({ ...state, guests: seen.size }); }
  else if (state.role === "guest" && e.kind === "joined") set({ ...state, world: e.motd });
}).catch(() => {});

export const room = {
  create: async () => { seen.clear(); set({ role: "host", code: await invoke<string>("room_create"), guests: 0 }); },
  join: async (code: string) => set({ role: "guest", code: await invoke<string>("room_join", { code }) }),
  leave: async () => { await invoke("room_leave"); set({ role: "none" }); },
};

export function useRoom(): RoomState {
  const [s, setS] = useState(state);
  useEffect(() => { subs.add(setS); return () => { subs.delete(setS); }; }, []);
  return s;
}
