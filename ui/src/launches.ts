// Состояние запусков по профилям. Источник — события Rust `launch-event` / `launch-finished`,
// без таймеров и догадок: кнопка «Играть» разблокируется только по событию завершения.
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { ExitInfo, LaunchEvent, Progress } from "./api";
import { pushNote } from "./notify";
import { src, t, tc } from "./i18n";

export interface LaunchState {
  phase: "preparing" | "running" | "done" | "failed";
  stageLabel: string;
  progress?: Progress;
  account?: string;
  javaLabel?: string;
  javaReason?: string;
  warnings: string[];
  logs: string[];
  command?: string;
  exit?: ExitInfo;
  error?: string;
  startedAt: number;
  /** Когда игра реально запустилась (событие started) — для «Игра идёт 00:42». */
  runningAt?: number;
  /** Перед запуском что-то скачивалось (для уведомления «Игра скачана»). */
  downloaded?: boolean;
}

/** Что сделать окну при событиях запуска: уведомления, свернуть и вернуть окно (App). */
export const launchHooks: {
  started?: (id: string, downloaded: boolean) => void;
  exited?: (id: string, crashed: boolean, title?: string) => void;
  failed?: (id: string, error: string) => void;
} = {};

const MAX_LOG_LINES = 5000;
type Listener = () => void;

class LaunchStore {
  states = new Map<string, LaunchState>();
  private listeners = new Set<Listener>();
  private started = false;

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private notify() {
    this.listeners.forEach((l) => l());
  }

  begin(id: string) {
    this.states.set(id, { phase: "preparing", stageLabel: t("Подготовка"), warnings: [], logs: [], startedAt: Date.now() });
    this.notify();
  }

  private update(id: string, f: (s: LaunchState) => LaunchState) {
    const cur = this.states.get(id) ?? { phase: "preparing", stageLabel: t("Подготовка"), warnings: [], logs: [], startedAt: Date.now() };
    this.states.set(id, f(cur));
  }

  async start() {
    if (this.started) return;
    this.started = true;
    let pending = false;
    const schedule = () => {
      if (pending) return;
      pending = true;
      // Логи приходят сотнями строк в секунду — перерисовка не чаще 10 раз в секунду.
      setTimeout(() => { pending = false; this.notify(); }, 100);
    };
    await listen<{ id: string; event: LaunchEvent }>("launch-event", ({ payload }) => {
      const { id, event: e } = payload;
      this.update(id, (s) => {
        switch (e.type) {
          case "stage": return { ...s, stageLabel: tc(e.label), progress: undefined };
          case "progress": return { ...s, progress: e.progress, downloaded: s.downloaded || e.progress.files_total > 0 };
          case "account": return { ...s, account: `${e.name} (${e.provider})` };
          case "java": return { ...s, javaLabel: tc(e.label), javaReason: tc(e.reason) };
          case "warning": pushNote({ kind: "warn", title: e.message, profile: id }); return { ...s, warnings: [...s.warnings, tc(e.message)] };
          case "started": launchHooks.started?.(id, !!s.downloaded); return { ...s, phase: "running", stageLabel: t("Игра запущена"), command: e.command, progress: undefined, runningAt: Date.now() };
          case "log": {
            const logs = s.logs.length >= MAX_LOG_LINES ? s.logs.slice(-MAX_LOG_LINES + 1) : s.logs.slice();
            logs.push(e.line);
            return { ...s, logs };
          }
          case "exited":
            if (e.info.crashed) pushNote({ kind: "err", title: src("Игра упала"), body: e.info.analysis?.title, profile: id });
            launchHooks.exited?.(id, e.info.crashed, e.info.analysis?.title);
            return { ...s, exit: e.info, phase: "done", stageLabel: e.info.crashed ? t("Игра упала") : t("Игра закрыта") };
        }
      });
      schedule();
    });
    await listen<{ id: string; error?: string }>("launch-finished", ({ payload }) => {
      if (payload.error) {
        pushNote({ kind: "err", title: src("Запуск не удался"), body: payload.error, profile: payload.id });
        launchHooks.failed?.(payload.id, payload.error);
      }
      this.update(payload.id, (s) =>
        payload.error ? { ...s, phase: "failed", error: tc(payload.error) } : { ...s, phase: "done" },
      );
      this.notify();
    });
  }
}

export const launches = new LaunchStore();

export function useLaunches(): Map<string, LaunchState> {
  const [, force] = useState(0);
  useEffect(() => {
    const off = launches.subscribe(() => force((n) => n + 1));
    return () => { off(); };
  }, []);
  return launches.states;
}

export const isActive = (s?: LaunchState) => !!s && (s.phase === "preparing" || s.phase === "running");
