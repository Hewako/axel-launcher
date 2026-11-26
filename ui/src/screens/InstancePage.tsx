import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogKind } from "./Catalog";
import { api, errText, loaderName, mods as modsApi, modsLabel, sizeText, snapshots, type Bisect, type DoctorReport, type Hooks, type JournalEntry, sourceName, type AccountRef, type Instance, type LaunchOverrides, type Resolved, type Source } from "../api";
import { isActive, type LaunchState } from "../launches";
import { useDialog } from "../ui/Dialog";
import { LaunchProgress, PlayButton, ProfileIcon, StatusBadge } from "../ui/common";
import { CrashCard } from "../ui/CrashCard";
import { MOD } from "../keys";
import { ModsTab } from "./ModsTab";
import { SnapshotsTab } from "./SnapshotsTab";
import { ProfileTab } from "./ProfileTab";
import { ServersTab } from "./ServersTab";
import { ResourcesTab } from "./ResourcesTab";
import { ConfigsTab } from "./ConfigsTab";
import { OptionsTab } from "./OptionsTab";
import { DepsTab } from "./DepsTab";
import { Overview } from "./Overview";
import { Icon } from "../ui/icons";
import { nick, useStreamer } from "../streamer";
import { t, tc } from "../i18n";

/** Адрес места в профиле: так на него ссылаются разбор краша и уведомления. */
/** Починка «Починить и играть» в процессе. */
export type FixRun = { step: 0 | 1 | 2 | 3; off: string[]; at: number; warnings: string[] };

export type Tab = "overview" | "mods" | "deps" | "resources" | "configs" | "options" | "launch" | "snapshots" | "servers" | "profile";
type Main = "overview" | "mods" | "rollback" | "game";
type Sub = "mods" | "resources" | "deps" | "launch" | "options" | "servers" | "profile";

/** Вариант F: 4 вкладки вместо 10, остальное — подвкладки (docs/INTERFACE_F.md). */
const MAIN: [Main, string][] = [["overview", t("Обзор")], ["mods", t("Моды")], ["rollback", t("Откат")], ["game", t("Игра")]];
const SUBS: Record<"mods" | "game", [Sub, string][]> = {
  mods: [["mods", t("Моды")], ["resources", t("Ресурсы и конфиги")], ["deps", t("Зависимости")]],
  game: [["launch", t("Запуск и память")], ["options", t("Настройки игры")], ["servers", t("Серверы")], ["profile", t("О сборке")]],
};
function place(tab: Tab): [Main, Sub | undefined] {
  switch (tab) {
    case "overview": return ["overview", undefined];
    case "mods": case "deps": return ["mods", tab];
    case "resources": case "configs": return ["mods", "resources"];
    case "snapshots": return ["rollback", undefined];
    default: return ["game", tab];
  }
}

/** Переключатель с ролью tablist: стрелки, Home и End, как у вкладок. */
function TabStrip<K extends string>({ items, value, onPick, className, label }: { items: [K, React.ReactNode][]; value: K; onPick: (k: K) => void; className: string; label: string }) {
  return (
    <div className={className} role="tablist" aria-label={label}>
      {items.map(([id, text], i) => (
        <button key={id} role="tab" aria-selected={value === id} tabIndex={value === id ? 0 : -1} className={value === id ? "on" : ""} onClick={() => onPick(id)}
          onKeyDown={(e) => {
            const next = e.key === "ArrowRight" ? (i + 1) % items.length : e.key === "ArrowLeft" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
            if (next < 0) return;
            e.preventDefault();
            onPick(items[next][0]);
            (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
          }}>{text}</button>
      ))}
    </div>
  );
}

/** Клавиша не должна срабатывать, пока фокус в поле, списке или диалоге. */
export const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable || !!document.querySelector("[role=dialog]"));
};

function SourceTag({ source, onReset }: { source: Source; onReset?: () => void }) {
  return (
    <div className="srcbox">
      <span className={`badge src ${source === "profile" ? "ok" : ""}`}>{sourceName[source]}</span>
      {source === "profile" && onReset && <button className="reset" onClick={onReset}>{t("сбросить")}</button>}
    </div>
  );
}

/** Ползунок памяти (макет 05): шкала, зелёная полоса «без предупреждений», клавиатура по WAI-ARIA slider. */
function MemSlider({ value, max, band, onChange }: { value: number; max: number; band?: [number, number] | null; onChange: (mb: number) => void }) {
  const MIN = 1024, STEP = 512;
  const track = useRef<HTMLDivElement>(null);
  const pct = (mb: number) => ((Math.min(max, Math.max(MIN, mb)) - MIN) / (max - MIN)) * 100;
  const snap = (mb: number) => Math.min(max, Math.max(MIN, Math.round(mb / STEP) * STEP));
  const fromX = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return snap(MIN + ((x - r.left) / r.width) * (max - MIN));
  };
  const gb = (mb: number) => `${(mb / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${t("ГБ")}`;
  const ticks = [1, 2, 4, 8, 16, 32].map((g) => g * 1024).filter((mb) => mb < max * 0.9); // у правого края — подпись максимума
  return (
    <div className="mem" onPointerDown={(e) => { if (!track.current) return; (e.target as Element).setPointerCapture?.(e.pointerId); onChange(fromX(e.clientX)); }}
      onPointerMove={(e) => { if (e.buttons === 1) onChange(fromX(e.clientX)); }}>
      <div className="memtrack" ref={track}>
        {band && <span className="memband" style={{ left: `${pct(band[0])}%`, width: `${pct(band[1]) - pct(band[0])}%` }} />}
        <span className="memfill" style={{ width: `${pct(value)}%` }} />
        <span className="memthumb" style={{ left: `${pct(value)}%` }} role="slider" tabIndex={0} aria-label={t("Память для игры")}
          aria-valuemin={MIN} aria-valuemax={max} aria-valuenow={value} aria-valuetext={gb(value)}
          onKeyDown={(e) => {
            const next = { ArrowRight: value + STEP, ArrowUp: value + STEP, ArrowLeft: value - STEP, ArrowDown: value - STEP, PageUp: value + 2048, PageDown: value - 2048, Home: MIN, End: max }[e.key];
            if (next !== undefined) { e.preventDefault(); onChange(snap(next)); }
          }} />
      </div>
      <div className="memticks" aria-hidden>{ticks.map((mb) => <span key={mb} style={{ left: `${pct(mb)}%` }}>{mb / 1024}</span>)}<span style={{ left: "100%" }}>{gb(max)}</span></div>
    </div>
  );
}

function LaunchTab({ inst, accounts, onChanged }: { inst: Instance; accounts: AccountRef[]; onChanged: (i: Instance) => void }) {
  const dialog = useDialog();
  const streamer = useStreamer();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.launchSettings>> | null>(null);
  const [draft, setDraft] = useState<LaunchOverrides>(inst.settings);
  // В сборке разработчика Ely.by работает и без Microsoft-аккаунта — подсказка это учитывает.
  const [devLaunch, setDevLaunch] = useState(false);
  useEffect(() => { api.appInfo().then((i) => setDevLaunch(i.dev_launch)).catch(() => {}); }, []);
  const [args, setArgs] = useState((inst.settings.jvm_args ?? []).join(" "));
  const [gameArgs, setGameArgs] = useState((inst.settings.game_args ?? []).join(" "));
  const [envText, setEnvText] = useState(Object.entries(inst.settings.env ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"));
  const [advice, setAdvice] = useState<string[]>([]);
  const [hooks, setHooks] = useState<Hooks>(inst.hooks ?? {});
  const saveHooks = async () => {
    const clean: Hooks = Object.fromEntries(Object.entries(hooks).filter(([k, v]) => k !== "approved" && typeof v === "string" && v.trim()).map(([k, v]) => [k, (v as string).trim()]));
    const lines = Object.entries(clean).map(([k, v]) => `${{ pre: t("до запуска"), post_exit: t("после выхода"), post_crash: t("после краша"), wrapper: t("обёртка") }[k]}: ${v}`);
    if (lines.length && !(await dialog.confirm({
      title: t("Разрешить эти команды?"),
      body: <><p style={{ marginTop: 0 }}>{t("Они будут выполняться на этом компьютере от вашего имени при каждом запуске сборки. Добавляйте только то, что понимаете.")}</p><pre className="cfgdiff" style={{ userSelect: "text" }}>{lines.join("\n")}</pre></>,
      confirm: t("Разрешить"),
      danger: true,
    }))) return;
    try { onChanged(await api.updateInstance(inst.id, { hooks: clean })); } catch (e) { await dialog.alert(t("Не сохранено"), errText(e)); }
  };
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState("");
  // Java: «Авто» по версии игры, найденные на компьютере, или свой путь.
  const [javaMajor, setJavaMajor] = useState(0);
  const [javas, setJavas] = useState<{ path: string; major: number; version: string; arch: string }[]>([]);
  const [customJava, setCustomJava] = useState(false);
  useEffect(() => {
    api.versionInfo(inst.game_version).then((v) => setJavaMajor(v.java_major)).catch(() => {});
    api.firstRunInfo().then((i) => { setJavas(i.javas); const p = inst.settings.java_path; setCustomJava(!!p && !i.javas.some((j) => j.path === p)); }).catch(() => {});
  }, [inst.game_version, inst.settings.java_path]);

  const load = useCallback(() => {
    api.launchSettings(inst.id).then((d) => {
      setData(d); setDraft(d.profile); setArgs((d.profile.jvm_args ?? []).join(" "));
      setGameArgs((d.profile.game_args ?? []).join(" "));
      setEnvText(Object.entries(d.profile.env ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"));
    }).catch(() => setData(null));
  }, [inst.id]);
  useEffect(load, [load]);
  useEffect(() => { api.previewCommand(inst.id).then(setPreview).catch((e) => setPreview(errText(e))); }, [inst.id, inst.settings, data]);
  const maxForAdvice = draft.max_memory_mb ?? inst.pack_settings.max_memory_mb ?? data?.global.max_memory_mb ?? 4096;
  useEffect(() => {
    const timer = setTimeout(() => api.memoryAdvice(maxForAdvice, inst.pack_settings.max_memory_mb).then(setAdvice).catch(() => setAdvice([])), 250);
    return () => clearTimeout(timer);
  }, [maxForAdvice, inst.pack_settings.max_memory_mb]);

  if (!data) return <p className="muted"><span className="spinner" /> {t("Загружаем настройки…")}</p>;

  // Итог с учётом несохранённых правок: профиль → сборка → глобальные → умолчание.
  const pick = <K extends keyof LaunchOverrides>(key: K, fallback: NonNullable<LaunchOverrides[K]>): Resolved<NonNullable<LaunchOverrides[K]>> => {
    const levels: [LaunchOverrides[K], Source][] = [[draft[key], "profile"], [inst.pack_settings[key], "pack"], [data.global[key], "global"]];
    const hit = levels.find(([v]) => v !== undefined && v !== null);
    return hit ? { value: hit[0] as NonNullable<LaunchOverrides[K]>, source: hit[1] } : { value: fallback, source: "default" };
  };
  const max = pick("max_memory_mb", 4096);
  const total = data.total_memory_mb;
  const ceiling = Math.max(1024, Math.min(total ? total - 1024 : 16384, 32768));

  const save = async () => {
    setSaving(true);
    try {
      const parsed = args.trim() ? args.trim().split(/\s+/) : undefined;
      const env: Record<string, string> = {};
      for (const line of envText.split("\n").map((l) => l.trim()).filter(Boolean)) {
        const i = line.indexOf("=");
        if (i < 1) throw new Error(t("Строка «{0}»: нужно ИМЯ=значение", line));
        env[line.slice(0, i).trim()] = line.slice(i + 1);
      }
      const updated = await api.updateInstance(inst.id, { settings: {
        ...draft, jvm_args: parsed,
        game_args: gameArgs.trim() ? gameArgs.trim().split(/\s+/) : undefined,
        env: Object.keys(env).length ? env : undefined,
      } });
      onChanged(updated);
      load();
    } catch (e) {
      await dialog.alert(t("Настройки не сохранены"), errText(e));
    } finally {
      setSaving(false);
    }
  };

  const ms = accounts.filter((a) => a.provider === "microsoft");
  const ely = accounts.filter((a) => a.provider === "elyby");
  const javaEff = pick("java_path", "");
  const advanced = [args.trim() && t("аргументы JVM"), gameArgs.trim() && t("аргументы игры"), envText.trim() && t("переменные окружения"), Object.keys(inst.hooks ?? {}).some((k) => k !== "approved") && t("команды")].filter(Boolean);
  return (
    <div className="ov" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (!saving) save(); } }}>
      <div className="stack">
        <div className="card">
          <div className="setting">
            <div className="lbl">{t("Память")}<span className="hint">{t("Игре сразу отдаётся вся выбранная память.")}</span></div>
            <div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="memval"><b>{(max.value / 1024).toFixed(1).replace(".0", "")} {t("ГБ")}</b>{total ? <span className="muted"> {t(" из {0} ГБ ОЗУ", Math.round(total / 1024)).trim()}</span> : null}</span>
                {data.memory_range && <span className="muted small">{t("Без предупреждений: {0}–{1} ГБ (зелёная полоса)", Math.round(data.memory_range[0] / 1024), Math.round(data.memory_range[1] / 1024))}</span>}
              </div>
              <MemSlider value={Math.min(max.value, ceiling)} max={ceiling} band={data.memory_range} onChange={(mb) => setDraft({ ...draft, max_memory_mb: mb, min_memory_mb: undefined })} />
              {inst.pack_settings.max_memory_mb ? <span className="muted small">{t(" Модпак рекомендует {0} МБ.", inst.pack_settings.max_memory_mb).trim()}</span> : null}
              {advice.map((a) => <span key={a} className="small" style={{ color: "var(--warn)" }}><Icon name="warn" size={14} /> {tc(a)}</span>)}
            </div>
            <SourceTag source={max.source} onReset={() => setDraft({ ...draft, max_memory_mb: undefined, min_memory_mb: undefined })} />
          </div>
          <div className="setting">
            <div className="lbl">Java<span className="hint">{t("по умолчанию подходящая для версии игры")}</span></div>
            <div className="stack tight">
              <select className="field" aria-label="Java" value={customJava ? "custom" : draft.java_path ?? ""}
                onChange={(e) => { const v = e.target.value; setCustomJava(v === "custom"); if (v !== "custom") setDraft({ ...draft, java_path: v || undefined }); }}>
                <option value="">{javaMajor ? t("Авто: Java {0}", javaMajor) : t("Авто: лаунчер подберёт или скачает нужную")}</option>
                {javas.map((j) => <option key={j.path} value={j.path}>Java {j.major} · {j.version} · {j.arch}{javaMajor && j.major !== javaMajor ? ` ${t("(не та версия)")}` : ""}</option>)}
                <option value="custom">{t("Указать путь…")}</option>
              </select>
              {customJava && <input className="field mono" placeholder="/path/to/java" aria-label={t("Путь к Java")} value={draft.java_path ?? ""} onChange={(e) => setDraft({ ...draft, java_path: e.target.value || undefined })} />}
            </div>
            <SourceTag source={javaEff.source} onReset={() => setDraft({ ...draft, java_path: undefined })} />
          </div>
          <div className="setting">
            <div className="lbl">{t("Размер окна игры")}<span className="hint">{t("пусто: как решит игра")}</span></div>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input className="field" type="number" min={320} aria-label={t("Ширина окна")} placeholder={t("ширина")} value={draft.resolution?.[0] ?? ""}
                onChange={(e) => setDraft({ ...draft, resolution: e.target.value ? [Number(e.target.value), draft.resolution?.[1] ?? 720] : undefined })} />
              <span className="muted">×</span>
              <input className="field" type="number" min={240} aria-label={t("Высота окна")} placeholder={t("высота")} value={draft.resolution?.[1] ?? ""}
                onChange={(e) => setDraft({ ...draft, resolution: e.target.value ? [draft.resolution?.[0] ?? 1280, Number(e.target.value)] : undefined })} />
            </div>
            <SourceTag source={draft.resolution ? "profile" : inst.pack_settings.resolution ? "pack" : data.global.resolution ? "global" : "default"} onReset={() => setDraft({ ...draft, resolution: undefined })} />
          </div>
          <div className="setting">
            <div className="lbl">{t("Вход")}{!devLaunch && <span className="hint">{t("Ely.by работает вместе с Microsoft-аккаунтом, на котором куплена игра")}</span>}</div>
            <select className="field" value={inst.auth_mode} onChange={async (e) => {
              try { onChanged(await api.updateInstance(inst.id, { authMode: e.target.value as Instance["auth_mode"] })); }
              catch (err) { await dialog.alert(t("Нельзя переключить вход"), errText(err)); }
            }}>
              <option value="microsoft">{t("Microsoft: официальные серверы")}</option>
              <option value="ely_by" disabled={ely.length === 0}>{t("Ely.by: только совместимые серверы")}</option>
            </select>
            <span />
          </div>
          {(inst.auth_mode === "microsoft" ? ms : ely).length > 1 && (
            <div className="setting">
              <div className="lbl">{t("Аккаунт")}<span className="hint">{t("для этой сборки")}</span></div>
              <select className="field" value={inst.account ?? ""} onChange={async (e) => {
                try { onChanged(await api.updateInstance(inst.id, { account: e.target.value || null })); }
                catch (err) { await dialog.alert(t("Не удалось сменить аккаунт"), errText(err)); }
              }}>
                <option value="">{t("По умолчанию")}</option>
                {(inst.auth_mode === "microsoft" ? ms : ely).map((a) => <option key={a.uuid} value={`${a.provider}:${a.uuid}`}>{nick(a.name, streamer)}</option>)}
              </select>
              <SourceTag source={inst.account ? "profile" : "global"} />
            </div>
          )}
        </div>

        <details className="card adv" open={!!inst.hooks && !inst.hooks.approved}>
          <summary>
            <span><b>{t("Расширенные")}</b>
            <span className="muted small">{t("Аргументы JVM и игры, переменные окружения, команды до и после запуска.")}{advanced.length ? ` ${t("Изменено: {0}.", advanced.join(", "))}` : ""}</span></span>
          </summary>
          <div className="setting">
            <div className="lbl">{t("Аргументы JVM")}<span className="hint">{t("через пробел; -Xmx и -javaagent запрещены")}</span></div>
            <input className="field mono" placeholder={t("например -XX:+UseG1GC")} value={args} onChange={(e) => setArgs(e.target.value)} />
            <SourceTag source={args.trim() ? "profile" : inst.pack_settings.jvm_args ? "pack" : data.global.jvm_args ? "global" : "default"} onReset={() => setArgs("")} />
          </div>
          <div className="setting">
            <div className="lbl">{t("Аргументы игры")}<span className="hint">{t("через пробел, в конце команды; вход и папки задаёт лаунчер")}</span></div>
            <input className="field mono" placeholder={t("например --fullscreen")} value={gameArgs} onChange={(e) => setGameArgs(e.target.value)} />
            <SourceTag source={gameArgs.trim() ? "profile" : inst.pack_settings.game_args ? "pack" : data.global.game_args ? "global" : "default"} onReset={() => setGameArgs("")} />
          </div>
          <div className="setting">
            <div className="lbl">{t("Переменные окружения")}<span className="hint">{t("ИМЯ=значение, по одной в строке; LD_*, DYLD_* и JAVA_TOOL_OPTIONS запрещены")}</span></div>
            <textarea className="field mono" rows={2} placeholder="MESA_GL_VERSION_OVERRIDE=4.5" value={envText} onChange={(e) => setEnvText(e.target.value)} />
            <SourceTag source={envText.trim() ? "profile" : inst.pack_settings.env ? "pack" : data.global.env ? "global" : "default"} onReset={() => setEnvText("")} />
          </div>
          <h4 className="subhead">{t("Команды до и после запуска (для опытных)")}</h4>
          {inst.hooks && Object.keys(inst.hooks).some((k) => k !== "approved") && !inst.hooks.approved && (
            <div className="alert warn"><span>{t("Команды изменены вне лаунчера и не выполняются, пока вы их не подтвердите.")}</span></div>
          )}
          {([["pre", t("Перед запуском"), "./backup.sh"], ["post_exit", t("После выхода"), ""], ["post_crash", t("После краша"), ""], ["wrapper", t("Обёртка (только Linux)"), "gamemoderun"]] as const).map(([k, label, ph]) => (
            <div className="setting" key={k}>
              <div className="lbl">{label}</div>
              <input className="field mono" placeholder={ph} value={hooks[k] ?? ""} onChange={(e) => setHooks({ ...hooks, [k]: e.target.value })} />
              <span />
            </div>
          ))}
          <p className="muted small">{t("Команда выполняется в папке игры; доступны переменные AXEL_PROFILE и AXEL_GAME_DIR. Если команда перед запуском завершится с ошибкой, игра не запустится.")}</p>
          <button className="btn" onClick={saveHooks}>{t("Сохранить команды…")}</button>
        </details>

        <div className="row">
          <button className="btn pri" onClick={save} disabled={saving} aria-keyshortcuts="Control+S Meta+S">{saving ? t("Сохраняем…") : <>{t("Сохранить")}<kbd aria-hidden>{MOD} S</kbd></>}</button>
          <button className="btn" disabled={saving} onClick={load}>{t("Отменить правки")}</button>
        </div>
      </div>

      <div className="stack">
        <section className="card">
          <h3>{t("Итоговая команда")}</h3>
          <div className="cmd">{preview || "…"}</div>
          <div className="row foot">
            <span className="muted small grow">{t("Команда по сохранённым настройкам. Токен и UUID скрыты.")}</span>
            <button className="btn link" disabled={!preview} onClick={() => navigator.clipboard.writeText(preview).catch(() => {})}>{t("Копировать")}</button>
          </div>
        </section>
        <section className="card">
          <h3>{t("Откуда берутся значения")}</h3>
          <p className="muted">{t("Значение сборки важнее значения модпака, а оно важнее общих настроек. Метка рядом показывает, откуда значение, «сбросить» возвращает общее.")}</p>
        </section>
      </div>
    </div>
  );
}

export function InstancePage({ inst, mods: modCount, instances, state, accounts, initialTab, onChanged, onTrashed, onCloned, onLogs, onNew, onDoctor, onCatalog }: {
  inst: Instance;
  mods?: number;
  instances: Instance[];
  onCloned: (i: Instance) => void;
  state?: LaunchState;
  accounts: AccountRef[];
  initialTab?: Tab;
  onChanged: (i: Instance) => void;
  onTrashed: () => void;
  onLogs: () => void;
  onNew: () => void;
  onDoctor: (id: string, r: DoctorReport) => void;
  /** Экран «Каталог» с этим профилем. */
  onCatalog: (kind: CatalogKind, query: string) => void;
}) {
  const dialog = useDialog();
  const [[main, sub], setPlace] = useState<[Main, Sub | undefined]>(() => place(initialTab ?? "overview"));
  const go = (tab: Tab) => setPlace(place(tab));
  const subOf = (m: "mods" | "game") => (main === m && sub ? sub : SUBS[m][0][0]);
  const [reload, setReload] = useState(0);
  const [disk, setDisk] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [profileAction, setProfileAction] = useState<{ kind: "clone" | "export"; n: number } | null>(null);
  const ask = (kind: "clone" | "export") => { setMore(false); setPlace(["game", "profile"]); setProfileAction({ kind, n: Date.now() }); };
  useEffect(() => { api.diskUsage(inst.id).then((u) => setDisk(u.total)).catch(() => setDisk(null)); }, [inst.id, reload]);
  useEffect(() => { if (initialTab) setPlace(place(initialTab)); }, [initialTab]);
  // Mod Doctor для «Обзора», счётчика на «Моды» и главной кнопки; перечитываем после смены вкладки и запуска.
  const [doctor, setDoctor] = useState<{ report: DoctorReport; journal: JournalEntry[] } | null>(null);
  useEffect(() => { modsApi.view(inst.id).then((d) => { setDoctor(d); onDoctor(inst.id, d.report); }).catch(() => setDoctor(null)); }, [inst.id, main, reload, state?.phase]);
  const blocking = doctor?.report.findings.filter((f) => f.severity === "blocking") ?? [];
  // «Починить и играть» — только если каждое блокирующее замечание чинится выключением мода (как в Mod Doctor).
  // Ход починки для карточки «Чиним профиль» (макет 12): 0 — снимок, 1 — выключаем, 2 — проверяем, 3 — запуск.
  const [fixRun, setFixRun] = useState<FixRun | null>(null);
  const fix = blocking.length > 0 && blocking.every((f) => f.fixes.some((x) => x.kind !== "install")) ? async () => {
    const run: FixRun = { step: 0, off: [], at: Date.now(), warnings: [] };
    setFixRun(run);
    try {
      await snapshots.create(inst.id, t("Перед «Починить и играть»"));
      setFixRun({ ...run, step: 1 });
      for (const f of blocking) {
        const x = f.fixes.find((k) => k.kind !== "install");
        const off = x?.kind === "disable" ? [x.file_name] : x?.kind === "keep_one" ? x.file_names.slice(1) : [];
        for (const file of off) { await modsApi.toggle(inst.id, file, false); run.off.push(file); }
      }
      setFixRun({ ...run, step: 2 });
      const v = await modsApi.view(inst.id);
      setDoctor(v);
      onDoctor(inst.id, v.report);
      run.warnings = v.report.findings.filter((f) => f.severity !== "blocking").map((f) => f.title);
      setFixRun({ ...run, step: 3 });
    } catch (e) { setFixRun(null); throw e; }
  } : undefined;
  // Починка закончилась вместе с запуском: игра вышла или не стартовала.
  useEffect(() => { if (state?.phase === "done" || state?.phase === "failed") setFixRun((r) => (r && r.step === 3 ? null : r)); }, [state?.phase]);
  // Замечания для точки на «Моды» — как чип «Замечания» в таблице: находки Mod Doctor и моды с предупреждением или без метаданных.
  const issues = Math.max(doctor?.report.findings.length ?? 0, doctor?.report.mods.filter((m) => m.state === "blocked" || m.state === "warning" || m.state === "unknown").length ?? 0);
  // Поиск виновника краша идёт несколько запусков: полоса видна на любой вкладке.
  const [bisect, setBisect] = useState<Bisect | null>(null);
  useEffect(() => { modsApi.bisectStatus(inst.id).then(setBisect).catch(() => setBisect(null)); }, [inst.id, reload, state?.phase]);
  const bisectStep = async (action: "start" | "answer" | "cancel", crashed?: boolean) => {
    if (action === "start" && !(await dialog.confirm({
      title: t("Найти мод, из-за которого падает игра?"),
      body: t("Лаунчер будет по очереди выключать половину модов (вместе с теми, кому они нужны). После каждого шага запустите игру и ответьте, повторился ли краш. Обычно хватает 3–6 запусков. Перед началом сохраняется снимок."),
      confirm: t("Начать"),
    }))) return;
    try {
      const r = await modsApi.bisectStep(inst.id, action, crashed);
      if (r?.kind === "found") {
        const off = await dialog.confirm({
          title: t("Вероятный виновник: {0}", r.file),
          body: t("Все моды снова включены. Выключить этот мод? Его можно будет включить обратно в любой момент."),
          confirm: t("Выключить"),
          cancel: t("Оставить"),
        });
        if (off) await modsApi.toggle(inst.id, r.file, false);
      }
    } catch (e) { await dialog.alert(t("Не получилось"), errText(e)); }
    setReload((n) => n + 1);
  };
  const tabs: [Main, React.ReactNode][] = MAIN.map(([m, l]) => [m, m === "mods" && issues > 0
    // Точка вместо числа (решение владельца 12.11.2026): красная — мешает запуску, оранжевая — только замечания.
    ? <>{l} <span className={`mdot ${blocking.length ? "err" : "warn"}`} role="img" aria-label={t("замечаний: {0}", issues) + (blocking.length ? `, ${t("мешает запуску: {0}", blocking.length)}` : "")} /></> : l]);
  // Меню «Ещё» закрывается кликом мимо него.
  useEffect(() => {
    if (!more) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".menuwrap")) setMore(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [more]);
  // Запуск закончился ошибкой или крашем — разбор на «Обзоре».
  const failed = state?.phase === "failed" || (state?.phase === "done" && !!state.exit?.analysis);
  useEffect(() => { if (failed) setPlace(["overview", undefined]); }, [failed]);
  // Alt 1–4 — вкладки (подсказка в нижней панели). Цифру берём по коду клавиши: на Mac ⌥1 печатает «¡».
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || !e.altKey || e.ctrlKey || e.metaKey || !/^Digit\d$/.test(e.code)) return;
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= MAIN.length) { e.preventDefault(); setPlace([MAIN[n - 1][0], undefined]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const trash = async () => {
    const ok = await dialog.confirm({
      title: t("Убрать «{0}» в корзину?", inst.name),
      body: <>{t("Сборка вместе с мирами, модами и конфигами переместится в папку")} <span className="mono">trash/</span> {t("внутри папки данных Axel'. Ничего не удаляется: чтобы вернуть, перенесите папку обратно в")} <span className="mono">instances/</span>.</>,
      confirm: t("Убрать в корзину"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.trashInstance(inst.id);
      onTrashed();
    } catch (e) {
      await dialog.alert(t("Не получилось"), errText(e));
    }
  };

  const modTabs = <TabStrip className="seg subtabs" label={t("Разделы модов")} items={SUBS.mods} value={subOf("mods")} onPick={(s) => setPlace(["mods", s])} />;
  return (
    <>
      <div className="phead">
        <ProfileIcon id={inst.id} color={inst.color} size={44} className="pi phead-ico" />
        <div className="phead-text">
          <h2>{inst.name}</h2>
          <p className="sub">Minecraft {inst.game_version}, {loaderName[inst.loader]}{inst.loader_version ? ` ${inst.loader_version}` : ""}{modCount !== undefined && inst.loader !== "vanilla" ? `, ${modsLabel(modCount)}` : ""}{disk !== null ? `, ${t("{0} на диске", sizeText(disk))}` : ""} · <StatusBadge inst={inst} state={state} /></p>
        </div>
        <div className="phead-acts">
          <button className="btn square wide-only" aria-label={t("Папка")} title={t("Папка")} onClick={() => api.openFolder(inst.id).catch((e) => dialog.alert(t("Не удалось открыть папку"), errText(e)))}><Icon name="folder" /></button>
          <div className="menuwrap">
            <button className="btn square" aria-label={t("Ещё")} aria-haspopup="menu" aria-expanded={more} onClick={() => setMore(!more)}><Icon name="more" /></button>
            {more && (
              <div className="menu" role="menu" onKeyDown={(e) => { if (e.key === "Escape") setMore(false); }}>
                <button role="menuitem" className="narrow-only" onClick={() => { setMore(false); api.openFolder(inst.id).catch((e) => dialog.alert(t("Не удалось открыть папку"), errText(e))); }}>{t("Папка")}</button>
                <button role="menuitem" onClick={() => ask("clone")}>{t("Сделать копию сборки…")}</button>
                <button role="menuitem" onClick={() => ask("export")}>{t("Экспорт в .mrpack…")}</button>
                <button role="menuitem" className="danger" disabled={isActive(state)} onClick={() => { setMore(false); trash(); }}>{t("В корзину")}</button>
              </div>
            )}
          </div>
          <PlayButton inst={inst} state={state} compact fix={fixRun ? undefined : fix} />
        </div>
      </div>
      {bisect && (
        <div className="alert warn bisectbar">
          <div className="h">{t("Поиск виновника краша · шаг {0}", bisect.round)}</div>
          <span>{t("Выключено модов: {0}. Подозреваемых осталось: {1}. Запустите игру и ответьте:", bisect.disabled.length, bisect.suspects.length)}</span>
          <div className="row">
            <button className="btn" disabled={isActive(state)} onClick={() => bisectStep("answer", true)}>{t("Игра снова упала")}</button>
            <button className="btn" disabled={isActive(state)} onClick={() => bisectStep("answer", false)}>{t("Игра работает")}</button>
            <button className="btn link small" disabled={isActive(state)} onClick={() => bisectStep("cancel")}>{t("Прекратить поиск")}</button>
          </div>
        </div>
      )}
      <div className="tabsrow">
        <TabStrip className="mtabs" label={t("Вкладки сборки")} items={tabs} value={main} onPick={(m) => setPlace([m, undefined])} />
      </div>
      {state && isActive(state) && !(main === "overview" && state.phase === "running") && <LaunchProgress state={state} />}
      {main === "overview" && (
        <div className="stack">
          {state?.phase === "failed" && state.error && <div className="alert err" style={{ whiteSpace: "pre-line" }}><div className="h">{t("Запуск не удался")}</div><span>{state.error}</span></div>}
          {state?.phase === "done" && state.exit?.analysis && <CrashCard inst={inst} a={state.exit.analysis} code={state.exit.code} onOpenTab={go} />}
          <Overview inst={inst} state={state} doctor={doctor} accounts={accounts} fix={fixRun ? undefined : fix} fixRun={fixRun} onGo={go} onLogs={onLogs} onNew={onNew} liveCrash={!!(state?.phase === "done" && state.exit?.analysis)} bisecting={!!bisect} onBisect={() => bisectStep("start")} />
        </div>
      )}
      {main === "mods" && (
        <>
          {subOf("mods") !== "mods" && modTabs}
          {subOf("mods") === "mods" && <ModsTab key={`${inst.id}-${reload}`} inst={inst} running={isActive(state)} tabs={modTabs} bisecting={!!bisect} onBisect={() => bisectStep("start")} onCatalog={onCatalog} />}
          {subOf("mods") === "resources" && (
            <div className="split2">
              <ResourcesTab key={`r-${inst.id}`} inst={inst} running={isActive(state)} onCatalog={onCatalog} />
              <ConfigsTab key={`c-${inst.id}`} inst={inst} running={isActive(state)} />
            </div>
          )}
          {subOf("mods") === "deps" && <DepsTab key={inst.id} inst={inst} running={isActive(state)} onChanged={() => setReload((n) => n + 1)} onCatalog={onCatalog} />}
        </>
      )}
      {main === "rollback" && <SnapshotsTab inst={inst} running={isActive(state)} journal={doctor?.journal ?? []} onRestored={() => setReload((n) => n + 1)} />}
      {main === "game" && (
        <>
          <TabStrip className="seg subtabs" label={t("Разделы игры")} items={SUBS.game} value={subOf("game")} onPick={(s) => setPlace(["game", s])} />
          {subOf("game") === "launch" && <LaunchTab key={inst.id} inst={inst} accounts={accounts} onChanged={onChanged} />}
          {subOf("game") === "options" && <OptionsTab key={inst.id} inst={inst} running={isActive(state)} />}
          {subOf("game") === "servers" && <ServersTab key={inst.id} inst={inst} running={isActive(state)} />}
          {subOf("game") === "profile" && <ProfileTab key={inst.id} inst={inst} instances={instances} running={isActive(state)} onChanged={onChanged} onCloned={onCloned} onTrash={trash} action={profileAction} />}
        </>
      )}
    </>
  );
}
