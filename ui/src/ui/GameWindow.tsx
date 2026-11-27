// Окно лаунчера во время игры (идея 30), уведомления системы (44, 64) и трей (57).
// Связывает события запуска с окном: свернуть или спрятать при старте игры, вернуть после
// выхода, уведомить, если окно не на виду, и открыть нужный экран по уведомлению.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { api, errText, type Instance } from "../api";
import { src, t } from "../i18n";
import { launchHooks, launches } from "../launches";
import { notifyPrefs, pushNote, systemNotify, takeJump, type JumpTarget } from "../notify";
import { Modal } from "./Dialog";

type Action = "minimize" | "tray" | "keep";

const windowDo = (action: "minimize" | "hide" | "show") => invoke("main_window", { action }).catch(() => {});

/** Подключить окно к событиям запуска. `onJump` — открыть экран по уведомлению. */
export function useGameWindow(instances: Instance[], onJump: (t: JumpTarget) => void) {
  const [ask, setAsk] = useState(false);
  const hidden = useRef(false);
  const list = useRef(instances);
  list.current = instances;
  const name = (id: string) => list.current.find((i) => i.id === id)?.name ?? "";

  const apply = (a: Action) => {
    if (a === "keep") return;
    hidden.current = true;
    windowDo(a === "tray" ? "hide" : "minimize");
  };

  useEffect(() => {
    launchHooks.started = (id, downloaded) => {
      if (downloaded) systemNotify(t("Игра скачана"), t("{0} запускается", name(id)), { screen: "profile", id });
      const a = notifyPrefs.on_game_start;
      if (a === "ask") setAsk(true);
      else apply(a as Action);
    };
    launchHooks.exited = (id, crashed, title) => {
      setAsk(false);
      if (hidden.current) { hidden.current = false; windowDo("show"); }
      if (crashed) systemNotify(t("Игра упала: {0}", name(id)), title ?? t("Откройте «Логи», там разбор краша."), { screen: "logs" });
    };
    launchHooks.failed = (id, error) => {
      if (hidden.current) { hidden.current = false; windowDo("show"); }
      systemNotify(t("Запуск не удался: {0}", name(id)), error, { screen: "profile", id });
    };
    // Окно снова на виду после уведомления — открыть то, о чём оно было.
    const onFocus = () => { const j = takeJump(); if (j) onJump(j); };
    window.addEventListener("focus", onFocus);
    // Запуск из меню трея.
    const off = listen<string>("tray-launch", async ({ payload: id }) => {
      if (!list.current.some((i) => i.id === id)) return;
      try { launches.begin(id); await api.launch(id); }
      catch (e) { pushNote({ kind: "err", title: src("Запуск не удался"), body: errText(e), profile: id }); }
    });
    return () => { window.removeEventListener("focus", onFocus); off.then((f) => f()); };
  }, [onJump]);

  // Меню трея: три последние запущенные сборки, подписи на языке окна.
  const recent = instances
    .filter((i) => !i.archived && i.last_launch?.at)
    .sort((a, b) => (b.last_launch?.at ?? 0) - (a.last_launch?.at ?? 0))
    .slice(0, 3)
    .map((i) => [i.id, i.name] as [string, string]);
  const recentKey = JSON.stringify(recent);
  useEffect(() => {
    invoke("tray_update", { recent, open: t("Открыть Axel'"), quit: t("Выйти") }).catch(() => {});
  }, [recentKey]);

  const dialog = ask ? <AskWindow onPick={async (a, remember) => {
    setAsk(false);
    if (remember) {
      notifyPrefs.on_game_start = a;
      try { const g = await api.globalSettings(); await api.saveGlobalSettings({ ...g, on_game_start: a }); } catch { /* спросим в следующий раз */ }
    }
    apply(a);
  }} /> : null;
  return dialog;
}

/** Первый запуск игры: что делать с окном лаунчера. */
function AskWindow({ onPick }: { onPick: (a: Action, remember: boolean) => void }) {
  const [remember, setRemember] = useState(true);
  return (
    <Modal title={t("Игра запущена. Что сделать с окном Axel'?")} onClose={() => onPick("keep", false)}>
      <p className="muted small" style={{ marginTop: 0 }}>{t("Когда игра закроется, окно вернётся само. Изменить можно в «Настройках».")}</p>
      <label className="row small"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t("Запомнить выбор")}</label>
      <div className="acts">
        <button className="btn" onClick={() => onPick("keep", remember)}>{t("Оставить")}</button>
        <button className="btn" onClick={() => onPick("tray", remember)}>{t("Спрятать в трей")}</button>
        <button className="btn pri" data-autofocus onClick={() => onPick("minimize", remember)}>{t("Свернуть")}</button>
      </div>
    </Modal>
  );
}
