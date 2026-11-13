import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useState } from "react";
import { api, isPackPath, mb, mods, statusOf, type AccountRef, type AppInfo, type DoctorReport, type GlobalSettings, type Instance } from "./api";
import { isActive, launches, useLaunches } from "./launches";
import { Accounts } from "./screens/Accounts";
import { AllProfiles } from "./screens/AllProfiles";
import { CreateInstance } from "./screens/CreateInstance";
import { ImportDialog } from "./screens/Import";
import { InstancePage, typing, type Tab } from "./screens/InstancePage";
import { Logs } from "./screens/Logs";
import { Settings } from "./screens/Settings";
import { FirstRun } from "./screens/FirstRun";
import { Avatar } from "./ui/Avatar";
import { PauseButton, ProfileIcon, progressOf } from "./ui/common";
import { Icon } from "./ui/icons";
import { DialogProvider } from "./ui/Dialog";
import { nick, path, setStreamer, useStreamer } from "./streamer";
import { markRead, pushNote, useNotes } from "./notify";
import { src, syncLang, t } from "./i18n";
import { ALT, MOD, isMod } from "./keys";

/** Профиль с вкладками или один из общих экранов, открытых с рельсы. */
type Screen = "profile" | "all" | "logs" | "accounts" | "settings" | "new";

function applyTheme(theme: string) {
  const dark = theme === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : theme !== "light";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

/** Цвет текста на акцентном фоне: белый или тёмный — что контрастнее (WCAG). */
function inkFor(hex: string): string {
  const [r, g, b] = (hex.match(/\w\w/g) ?? ["0", "0", "0"]).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? "#ffffff" : "#06210f";
}

/** Акцентный цвет, масштаб и плотность интерфейса из настроек. */
const FONTS: Record<string, string> = {
  readable: 'Verdana, "DejaVu Sans", Tahoma, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};

export function applyAppearance(g: Pick<GlobalSettings, "accent" | "ui_scale" | "compact" | "font">) {
  const root = document.documentElement;
  if (FONTS[g.font]) root.style.setProperty("--font", FONTS[g.font]); else root.style.removeProperty("--font");
  if (g.accent) {
    root.style.setProperty("--accent", g.accent);
    root.style.setProperty("--accent-ink", inkFor(g.accent));
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-ink");
  }
  root.style.setProperty("zoom", `${(g.ui_scale || 100) / 100}`);
  root.dataset.density = g.compact ? "compact" : "normal";
}


/** Подпись строки настроек (div.lbl) называет поле этой строки для экранных читалок. */
function useSettingLabels() {
  useEffect(() => {
    let n = 0;
    const link = () => document.querySelectorAll<HTMLElement>(".setting").forEach((row) => {
      const lbl = row.querySelector<HTMLElement>(".lbl");
      const field = row.querySelector<HTMLElement>("input:not([type=checkbox]):not([type=radio]), select, textarea");
      if (!lbl || !field || field.hasAttribute("aria-label") || field.hasAttribute("aria-labelledby")) return;
      lbl.id ||= `setting-lbl-${++n}`;
      field.setAttribute("aria-labelledby", lbl.id);
    });
    const obs = new MutationObserver(link);
    obs.observe(document.body, { childList: true, subtree: true });
    link();
    return () => obs.disconnect();
  }, []);
}

function Shell() {
  useSettingLabels();
  const streamer = useStreamer();
  const states = useLaunches();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [broken, setBroken] = useState<{ dir: string; reason: string }[]>([]);
  const [modsCount, setModsCount] = useState<Record<string, number>>({});
  const [accounts, setAccounts] = useState<AccountRef[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [screen, setScreen] = useState<Screen>("profile");
  const [profileTab, setProfileTab] = useState<Tab | undefined>();
  const [theme, setTheme] = useState("dark");
  const [loadError, setLoadError] = useState("");
  const [firstRun, setFirstRun] = useState(false);
  const [release, setRelease] = useState<{ version: string; url: string } | null>(null);
  const notes = useNotes();
  // Сборку можно бросить в любое место окна: откроется «Новый профиль» с импортом (моды ловит ModsTab).
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<{ path: string; n: number } | null>(null);
  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    let webview: ReturnType<typeof getCurrentWebview>;
    try { webview = getCurrentWebview(); } catch { return; } // в предпросмотре без Tauri окна нет
    webview.onDragDropEvent((e) => {
      if (e.payload.type === "over" || e.payload.type === "enter") setDragging(true);
      else if (e.payload.type === "leave") setDragging(false);
      else if (e.payload.type === "drop") {
        setDragging(false);
        const pack = e.payload.paths.find(isPackPath);
        if (pack) { setScreen("new"); setDropped({ path: pack, n: Date.now() }); }
      }
    }).then((u) => { if (alive) off = u; else u(); }).catch(() => {});
    return () => { alive = false; off?.(); };
  }, []);
  // Вердикт Mod Doctor по профилям для точек на рельсе.
  const [doctors, setDoctors] = useState<Record<string, { blocked: number; warnings: number }>>({});
  const noteDoctor = useCallback((id: string, r: DoctorReport) => {
    const count = (s: string) => r.findings.filter((f) => f.severity === s).length;
    setDoctors((d) => ({ ...d, [id]: { blocked: count("blocking"), warnings: count("warning") } }));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api.listInstances();
      setInstances(r.instances);
      setBroken(r.broken);
      setModsCount(r.mods ?? {});
      setSelectedId((cur) => (cur && r.instances.some((i) => i.id === cur) ? cur : r.instances[0]?.id));
      setLoadError("");
    } catch (e) {
      setLoadError(String(e));
    }
  }, []);
  const [defaultKey, setDefaultKey] = useState<string | undefined>();
  const refreshAccounts = useCallback(() => {
    api.listAccounts().then(setAccounts).catch(() => setAccounts([]));
    api.globalSettings().then((g) => { setDefaultKey(g.default_account); setStreamer(g.streamer_mode); }).catch(() => {});
  }, []);

  useEffect(() => {
    launches.start();
    api.appInfo().then(setInfo);
    api.globalSettings().then((g) => { setTheme(g.theme); applyTheme(g.theme); applyAppearance(g); setFirstRun(!g.first_run_done); syncLang(g.language); }).catch(() => applyTheme("dark"));
    refresh();
    refreshAccounts();
    api.launcherUpdate().then((r) => {
      if (!r) return;
      setRelease(r);
      pushNote({ kind: "info", title: src("Вышла новая версия Axel' {0}", r.version) });
    }).catch(() => {});
    const off = listen("launch-finished", () => refresh());
    // Esc — назад к профилю. Enter (играть) — ниже, ему нужен выбранный профиль.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !typing(e)) setScreen("profile");
    };
    window.addEventListener("keydown", onKey);
    return () => { off.then((f) => f()); window.removeEventListener("keydown", onKey); };
  }, [refresh, refreshAccounts]);

  const changeTheme = (t: string) => {
    setTheme(t);
    applyTheme(t);
    api.globalSettings().then((g) => api.saveGlobalSettings({ ...g, theme: t })).catch(() => {});
  };

  // Проверяем профили по очереди: у больших сборок чтение модов занимает заметное время.
  const instanceIds = instances.filter((i) => i.loader !== "vanilla" && !i.archived).map((i) => i.id).join("\n");
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const id of instanceIds.split("\n").filter(Boolean)) {
        if (!alive) return;
        await mods.view(id).then((v) => noteDoctor(id, v.report)).catch(() => {});
      }
    })();
    return () => { alive = false; };
  }, [instanceIds, noteDoctor]);

  const selected = instances.find((i) => i.id === selectedId);
  // states — одна и та же Map, которая меняется на месте: считаем на каждой отрисовке, без useMemo.
  let downloading: { name: string; s: NonNullable<ReturnType<typeof states.get>> } | null = null;
  for (const [id, s] of states) {
    if (s.phase === "preparing" && s.progress && s.progress.files_total > 0) {
      downloading = { name: instances.find((i) => i.id === id)?.name ?? id, s };
      break;
    }
  }
  const runningCount = [...states.values()].filter(isActive).length;
  const msAll = accounts.filter((a) => a.provider === "microsoft");
  const ms = msAll.find((a) => `${a.provider}:${a.uuid}` === defaultKey) ?? msAll[0];

  // Ctrl Enter (⌘ Enter на Mac) — главная кнопка в шапке профиля («Играть» или «Починить и играть»), но не из поля и не из диалога.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !isMod(e) || typing(e) || screen !== "profile" || !selectedId || isActive(states.get(selectedId))) return;
      e.preventDefault();
      document.querySelector<HTMLButtonElement>(".phead .play .go")?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, selectedId, states]);

  if (!info) return <div className="content muted">{t("Загрузка…")}</div>;
  const open = (id: string, tab?: Tab) => { setSelectedId(id); setProfileTab(tab); setScreen("profile"); };
  // Рельса: сначала избранные, потом по последнему запуску; архивные — в самом конце, приглушённые.
  const rail = [...instances].sort((a, b) =>
    Number(!!a.archived) - Number(!!b.archived) || Number(!!b.favorite) - Number(!!a.favorite) || (b.last_launch?.at ?? 0) - (a.last_launch?.at ?? 0));
  const status = (i: Instance) => {
    const st = states.get(i.id);
    const s = statusOf(i, isActive(st) ? st!.phase : undefined);
    if (isActive(st)) return s;
    const d = doctors[i.id];
    if (d?.blocked) return { text: t("мешает запуску: {0}", d.blocked), cls: "err" as const };
    if (s.cls === "err") return s;
    if (d?.warnings) return { text: t("есть замечания: {0}", d.warnings), cls: "warn" as const };
    // Пустое кольцо — только «новый, ещё не запускался»; остановленная игра — обычный «готов».
    return { ...s, cls: i.last_launch ? s.cls || ("ok" as const) : ("idle" as const) };
  };
  const selStatus = selected ? status(selected) : null;
  const dlPct = progressOf(downloading?.s).pct;

  return (
    <div className="app">
      <a href="#main" className="skip">{t("Перейти к содержимому")}</a>
      <nav className="rail" aria-label={t("Профили и разделы")}>
        <div className="rail-logo" title={`Axel' ${info.version}`}><img src="/logo.png" alt="" width={34} height={34} /></div>
        <button className={`rail-btn ${screen === "all" ? "on" : ""}`} aria-label={t("Все профили")} title={t("Все профили")} aria-current={screen === "all" ? "page" : undefined} onClick={() => setScreen("all")}><Icon name="grid" size={20} /></button>
        <div className="rail-div" aria-hidden />
        <div className="rail-list">
          {rail.map((i, n) => {
            const s = status(i);
            const prev = rail[n - 1];
            const sep = n > 0 && ((prev.favorite && !i.favorite) || (!prev.archived && i.archived));
            return (
              <div key={i.id} className={sep ? "rail-sep" : undefined}>
                <button className={`tile ${screen === "profile" && i.id === selectedId ? "on" : ""} ${i.archived ? "archived" : ""}`}
                  aria-label={`${i.name}, ${i.archived ? `${t("в архиве")}, ` : ""}${s.text}`} title={`${i.name} · ${i.archived ? `${t("в архиве")} · ` : ""}${s.text}`}
                  aria-current={screen === "profile" && i.id === selectedId ? "page" : undefined} onClick={() => open(i.id)}>
                  <ProfileIcon id={i.id} color={i.color} size={34} />
                  <span className={`sdot ${s.cls}`} aria-hidden />
                </button>
              </div>
            );
          })}
          <button className={`tile add ${screen === "new" ? "on" : ""}`} aria-label={t("Новый профиль")} title={t("Новый профиль")} onClick={() => setScreen("new")}>+</button>
        </div>
        <div className="rail-tools">
          <button aria-current={screen === "logs" ? "page" : undefined} className={`rail-btn ${screen === "logs" ? "on" : ""}`} aria-label={t("Логи и краши{0}", notes.unread ? t(": новых {0}", notes.unread) : "")} title={t("Логи и краши")}
            onClick={() => { markRead(); setScreen("logs"); }}>
            <Icon name="bell" size={20} />{notes.unread > 0 && <span className="adot" aria-hidden />}
          </button>
          <button aria-current={screen === "settings" ? "page" : undefined} className={`rail-btn ${screen === "settings" ? "on" : ""}`} aria-label={t("Настройки")} title={t("Настройки")} onClick={() => setScreen("settings")}><Icon name="gear" size={20} /></button>
          <button aria-current={screen === "accounts" ? "page" : undefined} className={`rail-btn avatar ${screen === "accounts" ? "on" : ""}`} aria-label={t("Аккаунты и скины: {0}", ms ? nick(ms.name, streamer) : t("нет аккаунта"))} title={t("Аккаунты и скины")} onClick={() => setScreen("accounts")}>
            <Avatar account={ms} />
          </button>
        </div>
      </nav>

      <div className="main">
        {info.dev_launch && (
          <div className="devbar" role="status">{t("Сборка разработчика (dev-launch): разрешён запуск без входа для отладки на собственной копии игры. В релизе этого режима нет.")}</div>
        )}
        {release && (
          <div className="banner info" role="status">
            <Icon name="info" size={16} />
            <span className="grow"><b>{t("Вышла новая версия Axel' {0}.", release.version)}</b> {t("Её можно скачать на странице релизов.")}</span>
            <button className="btn" onClick={() => api.openLink(release.url).catch(() => {})}>{t("Открыть страницу загрузки")}</button>
            <button className="btn" onClick={() => setRelease(null)}>{t("Позже")}</button>
          </div>
        )}

        <main className="content" id="main" tabIndex={-1}>
          {loadError && <div className="alert err"><div className="h">{t("Не удалось прочитать профили")}</div><span>{loadError}</span></div>}
          {broken.length > 0 && (
            <div className="alert warn"><div className="h">{t("Не удалось прочитать профили:")} {broken.length}</div>
              {broken.map((b) => <span key={b.dir} className="small mono">{path(b.dir, streamer)}</span>)}
            </div>
          )}
          {screen === "profile" && (selected ? (
            <InstancePage key={selected.id} inst={selected} mods={modsCount[selected.id]} instances={instances} state={states.get(selected.id)} accounts={accounts} initialTab={profileTab}
              onCloned={async (i) => { await refresh(); open(i.id, "profile"); }}
              onChanged={(i) => setInstances((list) => list.map((x) => (x.id === i.id ? i : x)))}
              onTrashed={() => { refresh(); setProfileTab(undefined); }} onLogs={() => setScreen("logs")} onNew={() => setScreen("new")} onDoctor={noteDoctor} />
          ) : (
            <div className="card empty">
              <p>{t("Профилей нет.")}</p>
              <div className="row" style={{ justifyContent: "center" }}>
                <button className="btn pri" onClick={() => setScreen("new")}>{t("+ Новый профиль")}</button>
              </div>
            </div>
          ))}
          {screen === "all" && <AllProfiles instances={instances} mods={modsCount} states={states} status={status} onOpen={(id) => open(id)} onNew={() => setScreen("new")} />}
          {screen === "logs" && <Logs instances={instances} states={states} id={selectedId} onPick={setSelectedId} />}
          {screen === "accounts" && <Accounts info={info} accounts={accounts} defaultKey={defaultKey} onChanged={refreshAccounts} instances={instances} onInstance={(i) => setInstances((list) => list.map((x) => (x.id === i.id ? i : x)))} />}
          {screen === "new" && (
            <>
              <div className="shead">
                <div>
                  <h2>{t("Новый профиль")}</h2>
                  <p className="sub">{t("Создать с нуля или импортировать готовую сборку.")}</p>
                </div>
                {/* Главная кнопка экрана — в шапке; отправляет форму «Создать с нуля». */}
                <button type="submit" form="create-form" className="btn cta"><Icon name="plus" size={16} /> {t("Создать")}</button>
              </div>
              <div className="split2">
                <CreateInstance onCreated={(i) => refresh().then(() => open(i.id))} />
                <div className="stack">
                  <ImportDialog dragging={dragging} dropped={dropped} onDone={(i) => refresh().then(() => open(i.id))} />
                  <section className="card">
                    <h3>{t("Что появится")}</h3>
                    <ul className="facts">
                      <li>{t("Папка профиля — сразу. Файлы игры скачаются при первом запуске.")}</li>
                      <li>{t("Java подберётся по версии игры, при необходимости скачается.")}</li>
                      <li>{t("Первый снимок сохранится сам перед первым изменением модов.")}</li>
                    </ul>
                  </section>
                </div>
              </div>
            </>
          )}
          {screen === "settings" && <Settings info={info} theme={theme} onTheme={changeTheme} onAppearance={applyAppearance} />}
        </main>

        <footer className="bottombar">
          <span className="keys">
            {screen === "profile" && selected && <><kbd>{ALT} 1–4</kbd> {t("вкладки")}<kbd>{MOD} Enter</kbd> {t("играть")}</>}
            {screen !== "profile" && <><kbd>Esc</kbd> {t("назад")}</>}
          </span>
          <span className="status" aria-live="polite">
            {downloading && (
              <span className="dl">
                <Icon name="download" size={14} />
                <span title={`${downloading.s.progress!.files_done}/${downloading.s.progress!.files_total} · ${mb(downloading.s.progress!.bytes_done)} ${t("МБ")}`}>{downloading.name}: {t(downloading.s.stageLabel)}</span>
                <span className="dlbar" role="progressbar" aria-label={t("Загрузка: {0}", downloading.name)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(dlPct)}><i style={{ width: `${dlPct}%` }} /></span>
                <span className="mono">{Math.round(dlPct)}%</span>
              </span>
            )}
            {screen === "profile" && selected && selStatus ? t("Профиль «{0}»: {1}", selected.name, selStatus.text)
              : runningCount > 0 ? t("Запущено профилей: {0}", runningCount)
              : t("Профилей: {0}, требуют внимания: {1}", instances.filter((i) => !i.archived).length, instances.filter((i) => !i.archived && ["err", "warn"].includes(status(i).cls ?? "")).length)}
            <PauseButton downloading={progressOf(downloading?.s).downloading} />
          </span>
        </footer>
      </div>

      {firstRun && (
        <FirstRun onDone={(next) => {
          setFirstRun(false);
          if (next === "accounts") setScreen("accounts");
          else if (next === "create" || next === "import") setScreen("new");
        }} />
      )}

    </div>
  );
}

export default function App() {
  return (
    <DialogProvider>
      <Shell />
    </DialogProvider>
  );
}
