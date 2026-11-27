// Вкладка «Моды · Mod Doctor»: проверка сборки, список модов, каталог Modrinth, обновления.
// Любое изменение модов — через предпросмотр и автоматический снимок.
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { Dropdown, pressable } from "../ui/common";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errText, isPackPath, loaderName, mods, sizeText, type CatalogSource, type Change, type DoctorReport, type Finding, type Instance, type JournalEntry, type ModFile, type ModState, type Plan, type ProjectKind, type SearchHit } from "../api";
import { Modal, useDialog } from "../ui/Dialog";
import { Icon } from "../ui/icons";
import { t, tc } from "../i18n";
import { MOD, isMod } from "../keys";
import type { CatalogKind } from "./Catalog";

const stateCls: Record<ModState, string> = { ok: "ok", warning: "warn", blocked: "err", disabled: "", unknown: "warn" };
const sideName: Record<string, string> = { client: t("клиент"), server: t("сервер"), both: t("обе"), unknown: "—" };
const sourceName: Record<string, string> = { modrinth: "Modrinth", curseforge: "CurseForge", import: t("импорт"), manual: t("вручную") };

/** Предпросмотр изменений с галочками. Перед применением создаётся снимок. */
export function PlanDialog({ title, plan, onClose, onApply }: { title: string; plan: Plan; onClose: () => void; onApply: (p: Plan) => Promise<void> }) {
  const [on, setOn] = useState<boolean[]>(plan.changes.map(() => true));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = plan.changes.filter((_, i) => on[i]);
  const total = chosen.reduce((s, c) => s + c.size, 0);
  const apply = async () => {
    setBusy(true);
    setError("");
    try { await onApply({ ...plan, changes: chosen }); } catch (e) { setError(errText(e)); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} wide>
      {plan.changes.length === 0 ? <p className="muted">{t("Изменений нет.")}</p> : (
        <div className="planlist">
          {plan.changes.map((c, i) => (
            <label key={i}>
              <input type="checkbox" checked={on[i]} onChange={(e) => setOn(on.map((v, j) => (j === i ? e.target.checked : v)))} />
              <div>
                <b>{c.kind === "add" ? "+ " : c.kind === "update" ? "~ " : "− "}{c.title}</b>{" "}
                <span className="muted small">{c.old_version ? `${c.old_version} → ` : ""}{c.new_version ?? ""}</span>
                <small>{tc(c.reason)}{c.size ? ` · ${sizeText(c.size)}` : ""}</small>
              </div>
            </label>
          ))}
        </div>
      )}
      {plan.notes.map((n, i) => <span key={i} className="muted small">• {tc(n)}</span>)}
      <span className="muted small">{t("Перед изменением сохранится снимок, отменить можно на вкладке «Откат». Файлы скачиваются с Modrinth и проверяются по хэшу.")}</span>
      {error && <div className="alert err"><span>{error}</span></div>}
      <div className="acts">
        <button className="btn" onClick={onClose}>{t("Отмена")}</button>
        <button className="btn pri" disabled={busy || chosen.length === 0} onClick={apply}>
          {busy ? t("Применяем…") : t("Применить{0}", chosen.length ? ` (${chosen.length}${total ? `, ${sizeText(total)}` : ""})` : "")}
        </button>
      </div>
    </Modal>
  );
}

/** Категории Modrinth для фильтра каталога (подписи — для игрока). */
const MOD_CATS: [string, string][] = [["optimization", t("Оптимизация")], ["utility", t("Удобство")], ["decoration", t("Декор")], ["worldgen", t("Генерация мира")], ["technology", t("Техника")], ["magic", t("Магия")], ["adventure", t("Приключения")], ["storage", t("Хранение")], ["mobs", t("Мобы")], ["equipment", t("Снаряжение")], ["food", t("Еда")], ["transportation", t("Транспорт")], ["game-mechanics", t("Механики")], ["management", t("Управление")], ["library", t("Библиотеки")]];
export const CATS: Record<ProjectKind, [string, string][]> = {
  mod: MOD_CATS,
  datapack: MOD_CATS,
  resourcepack: [["vanilla-like", t("Как ванилла")], ["realistic", t("Реалистичные")], ["simplistic", t("Простые")], ["themed", t("Тематические")], ["tweaks", t("Мелкие правки")], ["16x", "16x"], ["32x", "32x"], ["64x", "64x"]],
  shader: [["vanilla-like", t("Как ванилла")], ["semi-realistic", t("Полуреалистичные")], ["realistic", t("Реалистичные")], ["fantasy", t("Сказочные")], ["potato", t("Для слабых ПК")], ["low", t("Лёгкие")], ["high", t("Тяжёлые")]],
};

const KINDS: [ProjectKind, string][] = [["mod", t("Моды")], ["resourcepack", t("Ресурспаки")], ["shader", t("Шейдеры")], ["datapack", t("Датапаки")]];

export function CatalogDialog({ inst, initial, onClose, kinds = ["mod", "resourcepack", "shader"], onInstalled, world }: {
  world?: string;
  inst: Instance;
  initial: string;
  onClose: () => void;
  kinds?: ProjectKind[];
  onInstalled?: () => void;
}) {
  const [query, setQuery] = useState(initial);
  const [kind, setKind] = useState<ProjectKind>(kinds[0]);
  // Состояние установки по каждому проекту: ставим по очереди в фоне, окно при этом живое.
  const [status, setStatus] = useState<Record<string, "queued" | "installing" | "done">>({});
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [category, setCategory] = useState("");
  const [source, setSource] = useState<CatalogSource>("modrinth");
  const [cf, setCf] = useState(false);
  useEffect(() => { api.appInfo().then((i) => setCf(i.curseforge)).catch(() => {}); }, []);
  const src: CatalogSource = cf ? source : "modrinth";
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState("");
  // Уже найденное запоминаем: переключение «Моды / Ресурспаки / Шейдеры» туда и обратно — сразу.
  const found = useRef(new Map<string, SearchHit[]>());
  const typed = useRef(query);
  useEffect(() => {
    const key = [kind, src, category, query.trim()].join("\u0000");
    const cached = found.current.get(key);
    setError("");
    setHits(cached ?? null);
    if (cached) return;
    let current = true;
    // Ждём паузы только пока человек печатает; смена вида, источника или категории — без задержки.
    const delay = typed.current !== query ? 300 : 0;
    typed.current = query;
    const timer = setTimeout(() => {
      mods.search(inst.id, query, kind, 0, src === "modrinth" && category ? { category } : {}, src)
        .then((r) => { found.current.set(key, r.hits); if (current) setHits(r.hits); })
        .catch((e) => { if (current) { setHits([]); setError(errText(e)); } });
    }, delay);
    return () => { current = false; clearTimeout(timer); };
  }, [inst.id, query, kind, category, src]);
  const pick = (h: SearchHit) => {
    const k = kind;
    setStatus((st) => ({ ...st, [h.project_id]: "queued" }));
    queue.current = queue.current.then(async () => {
      setStatus((st) => ({ ...st, [h.project_id]: "installing" }));
      try {
        if (k === "mod") await mods.apply(inst.id, await mods.planInstall(inst.id, h.project_id, "auto", src), t("Перед: установить {0}", h.title));
        else await api.installResource(inst.id, h.project_id, k, world, src);
        setStatus((st) => ({ ...st, [h.project_id]: "done" }));
        onInstalled?.();
      } catch (e) {
        setStatus((st) => { const { [h.project_id]: _, ...rest } = st; return rest; });
        setError(`${h.title}: ${errText(e)}`);
      }
    });
  };
  return (
    <Modal title={src === "curseforge" ? t("Каталог CurseForge") : t("Каталог Modrinth")} onClose={onClose} wide>
      <div className="row">
        <input className="field" style={{ flex: 1 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={{ mod: t("Найти мод…"), shader: t("Найти шейдер…"), resourcepack: t("Найти ресурспак…"), datapack: t("Найти датапак…") }[kind]} data-autofocus />
        <div className="seg">
          {KINDS.filter(([k]) => kinds.includes(k)).map(([k, l]) => (
            <button key={k} className={kind === k ? "on" : ""} onClick={() => { setKind(k); setCategory(""); }}>{l}</button>
          ))}
        </div>
      </div>
      <div className="row">
        {cf && (
          <div className="seg" role="group" aria-label={t("Источник")}>
            <button className={source === "modrinth" ? "on" : ""} onClick={() => setSource("modrinth")}>Modrinth</button>
            <button className={source === "curseforge" ? "on" : ""} onClick={() => { setSource("curseforge"); setCategory(""); }}>CurseForge</button>
          </div>
        )}
        {src === "modrinth" && <select className="field auto" aria-label={t("Категория")} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t("Все категории")}</option>
          {CATS[kind].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>}
        {/* Для какой игры и загрузчика ищем: всё в каталоге уже отфильтровано по ним. */}
        <span className="pill" title={t("Показано только то, что подходит к этой сборке")}>Minecraft {inst.game_version}{kind === "mod" && inst.loader !== "vanilla" ? ` · ${loaderName[inst.loader]}` : ""}</span>
      </div>
      {kind === "shader" && <span className="muted small">{t("Шейдеры работают с модом Iris (Fabric/Quilt) или Oculus (NeoForge). После установки шейдер можно выбрать в разделе «Ресурсы и конфиги».")}</span>}
      {error && <div className="alert err"><span>{error}</span></div>}
      <div className="hits">
        {hits === null && <p className="muted"><span className="spinner" /> {t("Ищем…")}</p>}
        {hits?.length === 0 && !error && <p className="muted">{t("Ничего не нашлось.")}</p>}
        {hits?.map((h) => (
          <div className="hit" key={h.project_id}>
            {h.icon_url ? <img src={h.icon_url} alt="" /> : <div className="noicon" />}
            <div className="grow">
              <b>{h.title}</b> <span className="muted small">· {h.author} · {h.downloads.toLocaleString("ru-RU")} {t("скачиваний")}</span>
              <small>{h.description}</small>
            </div>
            {(() => {
              const st = status[h.project_id];
              return <button className="btn" disabled={!!st} onClick={() => pick(h)}>{st === "done" ? t("Установлено") : st === "installing" ? <><span className="spinner" /> {t("Ставим…")}</> : st === "queued" ? t("В очереди") : t("Установить")}</button>;
            })()}
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function FindingCard({ f, files, onToggle, onSearch }: { f: Finding; files: ModFile[]; onToggle: (file: string, enabled: boolean) => void; onSearch: (q: string) => void }) {
  const name = (file: string) => files.find((x) => x.file_name === file)?.mods[0]?.name ?? file;
  return (
    <div className={`alert ${f.severity === "blocking" ? "err" : "warn"}`}>
      <div className="h"><Icon name={f.severity === "blocking" ? "error" : "warn"} size={16} /> {tc(f.title)}</div>
      <span className="small">{tc(f.detail)}</span>
      <span className="muted small">{t("Основание:")} {tc(f.evidence)}</span>
      {f.fixes.length > 0 && (
        <div className="acts">
          {f.fixes.map((x, i) =>
            x.kind === "install" ? (
              <button key={i} className="btn pri" onClick={() => onSearch(x.mod_id)}>{t("Найти «")}{x.mod_id}{t("» в каталоге")}</button>
            ) : x.kind === "disable" ? (
              <button key={i} className="btn" onClick={() => onToggle(x.file_name, false)}>{t("Выключить")} {name(x.file_name)}</button>
            ) : (
              x.file_names.map((keep) => (
                <button key={keep} className="btn" onClick={() => x.file_names.filter((o) => o !== keep).forEach((o) => onToggle(o, false))}>{t("Оставить")} {keep}</button>
              ))
            ),
          )}
        </div>
      )}
      {f.fixes.some((x) => x.kind === "disable" || x.kind === "keep_one") && <span className="muted small">{t("Выключенный мод остаётся в сборке, запись попадает в журнал.")}</span>}
    </div>
  );
}

/** Название мода; если описания внутри файла нет — имя файла без «.jar» и «.disabled». */
export const modTitle = (f: ModFile): string => f.mods[0]?.name ?? f.file_name.replace(/\.disabled$/i, "").replace(/\.jar$/i, "");

export function ModsTab({ inst, running, tabs, bisecting, onBisect, onCatalog }: {
  inst: Instance;
  /** Открыть экран «Каталог» для этого профиля. */
  onCatalog: (kind: CatalogKind, query: string) => void;
  running: boolean;
  /** Подвкладки: на макете они в одной строке с поиском и «Добавить». */
  tabs: React.ReactNode;
  bisecting: boolean;
  onBisect: () => void;
}) {
  const dialog = useDialog();
  const [data, setData] = useState<{ files: ModFile[]; report: DoctorReport; journal: JournalEntry[] } | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const setCatalog = (q: string) => onCatalog("mod", q);
  const [plan, setPlan] = useState<{ title: string; plan: Plan; reason: string } | null>(null);
  const [checking, setChecking] = useState(false);
  // Доступные обновления: проверяются сами при открытии вкладки (один запрос к Modrinth).
  const [available, setAvailable] = useState<Plan | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);

  const [groups, setGroups] = useState<{ names: string[]; groups: Record<string, string> }>({ names: [], groups: {} });
  const [grouping, setGrouping] = useState(false);
  const [chip, setChip] = useState<"all" | "issues" | "updates" | "off">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [openErr, setOpenErr] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  // Ctrl F (⌘ F на Mac) — к поиску модов, из любого места вкладки, кроме диалога.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (isMod(e) && e.code === "KeyF" && !document.querySelector("[role=dialog]")) { e.preventDefault(); search.current?.focus(); search.current?.select(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const load = useCallback(() => {
    mods.view(inst.id).then((d) => { setData(d); setError(""); }).catch((e) => setError(errText(e)));
    mods.groups(inst.id).then(setGroups).catch(() => {});
  }, [inst.id]);
  useEffect(load, [load]);
  const refreshUpdates = useCallback(() => {
    if (inst.loader === "vanilla") return;
    mods.checkUpdates(inst.id).then(setAvailable).catch(() => setAvailable(null));
  }, [inst.id, inst.loader]);
  useEffect(refreshUpdates, [refreshUpdates]);

  // Добавить JAR-файлы (перетаскиванием или через «Инструменты»): снимок, проверка по Modrinth.
  const addJars = async (jars: string[]) => {
    try {
      const added = await mods.addFiles(inst.id, jars);
      load();
      refreshUpdates();
      const unknown = added.filter((a) => !a.known);
      await dialog.alert(
        t("Добавлено модов: {0}", added.length),
        unknown.length === 0
          ? t("Все файлы опознаны в каталоге Modrinth. Перед добавлением создан снимок.")
          : t("Не найдены в каталоге Modrinth: {0}. Известных вирусов в них нет, но откуда эти файлы, неизвестно. Ставьте моды только из надёжных источников. Перед добавлением создан снимок.", unknown.map((u) => u.title).join(", ")),
      );
    } catch (err) {
      await dialog.alert(t("Файлы не добавлены"), errText(err));
    }
  };

  // Перетаскивание JAR-файлов в окно.
  useEffect(() => {
    if (inst.loader === "vanilla" || running) return;
    let off: (() => void) | undefined;
    let alive = true;
    let webview: ReturnType<typeof getCurrentWebview>;
    try { webview = getCurrentWebview(); } catch { return; } // в предпросмотре без Tauri окна нет
    webview
      .onDragDropEvent(async (e) => {
        if (e.payload.type === "over" || e.payload.type === "enter") setDragging(true);
        else if (e.payload.type === "leave") setDragging(false);
        else if (e.payload.type === "drop") {
          setDragging(false);
          const jars = e.payload.paths.filter((p) => p.toLowerCase().endsWith(".jar"));
          if (jars.length === 0) {
            // Сборку или папку забирает окно целиком: откроется «Новый профиль».
            if (!e.payload.paths.some(isPackPath)) await dialog.alert(t("Не JAR-файлы"), t("Перетащите файлы модов с расширением .jar."));
            return;
          }
          await addJars(jars);
        }
      })
      .then((u) => { if (alive) off = u; else u(); })
      .catch(() => {});
    return () => { alive = false; off?.(); };
  }, [inst.id, inst.loader, running, dialog, load, refreshUpdates]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (data?.files ?? []).filter((f) => !q || f.file_name.toLowerCase().includes(q) || f.mods.some((m) => m.name.toLowerCase().includes(q) || m.id.includes(q)));
  }, [data, filter]);

  if (inst.loader === "vanilla") return <>{tabs}<div className="card empty"><p>{t("В сборке без загрузчика моды не работают. Создайте сборку с Fabric, Quilt, Forge или NeoForge.")}</p></div></>;
  if (error) return <>{tabs}<div className="alert err"><span>{error}</span></div></>;
  if (!data) return <>{tabs}<p className="muted"><span className="spinner" /> {t("Проверяем моды…")}</p></>;

  const setsWithMods = groups.names
    .map((g) => { const files = data.files.filter((f) => groups.groups[f.file_name] === g); return { g, files, on: files.filter((f) => f.enabled).length }; })
    .filter((x) => x.files.length > 0);
  const toggleGroup = async (g: string, enabled: boolean) => {
    try { await mods.toggleGroup(inst.id, g, enabled); load(); } catch (e) { await dialog.alert(t("Не получилось"), errText(e)); }
  };
  const autoGroups = async () => {
    setGrouping(true);
    try {
      const n = await mods.autoGroups(inst.id);
      load();
      await dialog.alert(t("Готово"), n ? t("Разложено по группам: {0}. Остальные можно отнести к группе вручную в колонке «Группа».", n) : t("Новых модов, которые можно разложить автоматически, нет. Отнесите их к группе вручную в колонке «Группа»."));
    } catch (e) { await dialog.alert(t("Не получилось"), errText(e)); } finally { setGrouping(false); }
  };
  const toggle = async (file: string, enabled: boolean) => {
    try { await mods.toggle(inst.id, file, enabled); load(); } catch (e) { await dialog.alert(t("Не получилось"), errText(e)); }
  };
  const remove = async (f: ModFile) => {
    const world = f.world_content
      ? t(" Этот мод добавляет в мир блоки, измерения или генерацию: без него часть построек и чанков может пропасть. Axel' сначала сделает бэкап последнего мира.")
      : "";
    const ok = await dialog.confirm({ title: t("Удалить {0}?", modTitle(f)), body: t("Перед удалением сохранится снимок, вернуть мод можно на вкладке «Откат». Если сомневаетесь, лучше выключите мод.") + world, confirm: t("Удалить"), danger: true });
    if (!ok) return;
    try { await mods.remove(inst.id, f.file_name); load(); } catch (e) { await dialog.alert(t("Не получилось"), errText(e)); }
  };
  const updates = async () => {
    setChecking(true);
    try {
      const p = await mods.checkUpdates(inst.id);
      setAvailable(p);
      const chosen = picked.size ? p.changes.filter((c) => picked.has(base(c.old_file ?? ""))) : p.changes;
      setPlan({ title: picked.size ? t("Обновить выбранные") : t("Обновления модов"), plan: { ...p, changes: chosen }, reason: t("Перед обновлением модов") });
    }
    catch (e) { await dialog.alert(t("Не удалось проверить обновления"), errText(e)); }
    finally { setChecking(false); }
  };
  const pin = async (f: ModFile) => {
    try { await mods.pin(inst.id, f.file_name, !f.source?.pinned); load(); refreshUpdates(); } catch (e) { await dialog.alert(t("Не получилось"), errText(e)); }
  };
  const r = data.report;
  const base = (name: string) => name.replace(/\.disabled$/, "");
  const updateFor = (f: ModFile): Change | undefined => available?.changes.find((c) => base(c.old_file ?? "") === f.file_name);
  const updateCount = available?.changes.length ?? 0;
  const stateOf = (f: ModFile) => r.mods.find((m) => m.file_name === f.file_name);

  const issue = (f: ModFile) => { const s = stateOf(f)?.state; return s === "blocked" || s === "warning" || s === "unknown"; };
  const counts = { all: data.files.length, issues: data.files.filter(issue).length, updates: data.files.filter((f) => updateFor(f)).length, off: data.files.filter((f) => !f.enabled).length };
  const visible = shown.filter((f) => chip === "all" || (chip === "issues" ? issue(f) : chip === "updates" ? !!updateFor(f) : !f.enabled));
  // Сначала то, что мешает запуску, потом предупреждения и неопознанные.
  const rank = (f: ModFile) => ({ blocked: 0, warning: 1, unknown: 2 } as Record<string, number>)[stateOf(f)?.state ?? ""] ?? 3;
  const rowsIssues = visible.filter(issue).sort((a, b) => rank(a) - rank(b));
  // Столбец «Ошибка» есть, только когда в профиле есть замечания по модам.
  const errCol = data.files.some(issue);
  const cols = errCol ? 6 : 5;
  const rowsRest = visible.filter((f) => !issue(f));
  const sel = data.files.find((f) => f.file_name === selected) ?? rowsIssues[0] ?? visible[0];
  const CHIPS: [typeof chip, string, number][] = [["all", t("Все"), counts.all], ["issues", t("Замечания"), counts.issues], ["updates", t("Обновления"), counts.updates], ["off", t("Выключены"), counts.off]];
  const row = (f: ModFile) => {
    const st = stateOf(f);
    const m = f.mods[0];
    const u = updateFor(f);
    return (
      <Fragment key={f.rel_path}>
      <tr className={`pick ${f.enabled ? "" : "off"} ${sel?.file_name === f.file_name ? "sel" : ""}`} aria-selected={sel?.file_name === f.file_name} {...pressable(() => setSelected(f.file_name))}>
        <td><button className={`tog ${f.enabled ? "on" : ""}`} role="switch" aria-checked={f.enabled} disabled={running} aria-label={`${f.enabled ? t("Выключить") : t("Включить")} ${modTitle(f)}`} onClick={(e) => { e.stopPropagation(); toggle(f.file_name, !f.enabled); }} /></td>
        <td><button className="rowname" aria-pressed={sel?.file_name === f.file_name} onClick={() => setSelected(f.file_name)}>{f.icon ? <img className="modico" src={f.icon} alt="" /> : <span className="modico none" aria-hidden>{[...modTitle(f)][0]?.toUpperCase()}</span>}<b>{modTitle(f)}</b>{!f.enabled && <span className="muted"> {t("выключен")}</span>}{(st?.notes.length ?? 0) > 0 && <span className="muted"> {tc(st!.notes[0])}</span>}</button></td>
        <td className="mono">{m?.version ?? ""}{u && <span className="upd"> → {u.new_version}</span>}{f.source?.pinned && <span className="muted" title={t("закреплена")} aria-label={t("закреплена")}> <Icon name="lock" size={14} /></span>}</td>
        <td>{f.source ? sourceName[f.source.source] : t("вручную")}</td>
        <td>{st && <span className={`state ${stateCls[st.state]}`}>{st.state === "blocked" ? <Icon name="error" size={14} /> : stateCls[st.state] === "warn" ? <Icon name="warn" size={14} /> : null} {tc(st.state_label)}</span>}</td>
        {errCol && <td>{issue(f) && (
          <button className="btn link small" aria-expanded={openErr === f.file_name} aria-controls={`err-${f.rel_path}`}
            onClick={(e) => { e.stopPropagation(); setOpenErr(openErr === f.file_name ? null : f.file_name); }}>
            {openErr === f.file_name ? t("Скрыть ошибку") : t("Открыть ошибку")}
          </button>
        )}</td>}
      </tr>
      {errCol && openErr === f.file_name && (
        <tr className="errrow" id={`err-${f.rel_path}`}>
          <td colSpan={cols}>
            {r.findings.filter((x) => x.files.includes(f.file_name)).map((x, i) => <FindingCard key={i} f={x} files={data.files} onToggle={toggle} onSearch={(q) => setCatalog(q)} />)}
            {!r.findings.some((x) => x.files.includes(f.file_name)) && st?.notes.map((n, i) => <p key={i} className="small">{tc(n)}</p>)}
          </td>
        </tr>
      )}
      </Fragment>
    );
  };
  // Карточка выбранного мода: почему мешает (с кнопками починки), сведения и действия.
  const card = (f: ModFile) => {
    const m = f.mods[0];
    const u = updateFor(f);
    const needs = m ? data.files.filter((o) => o.mods.some((x) => x.dependencies.some((d) => d.id === m.id && d.kind === "required"))).map((o) => o.mods[0]?.name ?? o.file_name) : [];
    return (
      <aside className="card modcard" aria-label={t("Карточка мода")}>
        <h2>{modTitle(f)} {m?.version && <span className="mono muted">{m.version}</span>}</h2>
        <p className="muted small">{f.file_name}</p>
        {r.findings.filter((x) => x.files.includes(f.file_name)).map((x, i) => <FindingCard key={i} f={x} files={data.files} onToggle={toggle} onSearch={(q) => setCatalog(q)} />)}
        <dl className="kv">
          <dt>{t("Источник")}</dt><dd>{f.source ? sourceName[f.source.source] : t("вручную")}</dd>
          <dt>{t("Сторона")}</dt><dd>{sideName[m?.side ?? "unknown"]}</dd>
          <dt>{t("Слой")}</dt><dd>{f.source?.layer === "base" ? t("модпак") : t("мои моды")}</dd>
          {needs.length > 0 && <><dt>{t("Нужен для")}</dt><dd>{needs.join(", ")}</dd></>}
          <dt>{t("Размер")}</dt><dd>{sizeText(f.size)}</dd>
          <dt>{t("Группа")}</dt>
          <dd>
            <select className="field auto mini" aria-label={t("Группа для {0}", modTitle(f))} value={groups.groups[f.file_name] ?? ""}
              onChange={(e) => mods.setGroup(inst.id, f.file_name, e.target.value || null).then(load).catch((er) => dialog.alert(t("Не получилось"), errText(er)))}>
              <option value="">—</option>
              {groups.names.map((g) => <option key={g} value={g}>{tc(g)}</option>)}
            </select>
          </dd>
          {u && <><dt>{t("Доступна версия")}</dt><dd>
            <label className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
              <input type="checkbox" checked={picked.has(f.file_name)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(f.file_name); else n.delete(f.file_name); setPicked(n); }} />
              <span className="mono upd">{u.new_version}</span>
            </label>
          </dd></>}
        </dl>
        <div className="acts">
          <button className={`btn ${f.enabled ? "pri" : ""}`} disabled={running} onClick={() => toggle(f.file_name, !f.enabled)}>{f.enabled ? t("Выключить") : t("Включить")}</button>
          <button className="btn" disabled={running} onClick={() => remove(f)}>{t("Удалить")}</button>
          <button className="btn" disabled={running} onClick={() => pin(f)} title={t("Закреплённая версия не обновляется")}>{f.source?.pinned ? t("Открепить") : t("Закрепить")}</button>
          {f.source?.source === "modrinth" && f.source.project_id && <button className="btn" onClick={() => api.openLink(`https://modrinth.com/mod/${f.source!.project_id}`).catch((e) => dialog.alert(t("Не получилось"), errText(e)))}>{t("На Modrinth")}</button>}
        </div>
      </aside>
    );
  };

  return (
    <>
      {running && <div className="alert warn"><span className="small">{t("Игра запущена. Моды можно менять, когда она закроется.")}</span></div>}
      {dragging && <div className="alert info"><div className="h">{t("Отпустите, чтобы добавить моды в «")}{inst.name}»</div><span className="small">{t("Перед добавлением будет создан снимок.")}</span></div>}
      {/* Замечания без файла (например, не хватает мода) — над таблицей; остальные — в карточке мода. */}
      <div className="findings">
        {r.findings.filter((f) => f.files.length === 0).map((f, i) => <FindingCard key={i} f={f} files={data.files} onToggle={toggle} onSearch={(q) => setCatalog(q)} />)}
      </div>
      <div className="modbar">
        {tabs}
        <span style={{ flex: 1 }} />
        <span className="searchbox">
          <Icon name="search" size={16} />
          <input ref={search} className="field" placeholder={t("Найти мод…")} aria-label={t("Найти мод…")} aria-keyshortcuts="Control+F Meta+F" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <kbd aria-hidden>{MOD} F</kbd>
        </span>
        <button className="btn" disabled={running} onClick={() => setCatalog("")}>{t("+ Добавить мод")}</button>
      </div>
      <div className="modbar">
        <div className="chips" role="group" aria-label={t("Фильтр модов")}>
          {CHIPS.map(([k, l, n]) => <button key={k} className={`fchip ${chip === k ? "on" : ""}`} aria-pressed={chip === k} onClick={() => setChip(k)}>{l} <span className="muted">{n}</span></button>)}
        </div>
        <span style={{ flex: 1 }} />
        {setsWithMods.length > 0 && (
          <Dropdown role="group" label={t("Наборы ({0})", setsWithMods.length)} title={t("Включить или выключить моды набором")}>
            {() => setsWithMods.map(({ g, files, on }) => (
              <label key={g} className="row menurow" title={t("Включено {0} из {1}", on, files.length)}>
                <input type="checkbox" checked={on === files.length} ref={(el) => { if (el) el.indeterminate = on > 0 && on < files.length; }}
                  disabled={running} onChange={(e) => toggleGroup(g, e.target.checked)} />
                <span className="grow">{tc(g)}</span> <span className="muted small">{on}/{files.length}</span>
              </label>
            ))}
          </Dropdown>
        )}
        <Dropdown label={<>{t("Инструменты")}{updateCount > 0 && <span className="mdot ok" role="img" aria-label={t("обновления есть у {0}", updateCount)} />}</>}>
          {(close) => <>
            <button role="menuitem" disabled={running || checking || updateCount === 0} onClick={() => { close(); updates(); }}>
              {checking ? t("Проверяем…") : picked.size ? t("Обновить выбранные ({0})…", picked.size) : t("Обновить всё…")}
              <small>{available === null ? t("обновления проверяются…") : updateCount ? t("обновления есть у {0}, сначала покажем список", updateCount) : t("обновлений нет")}</small>
            </button>
            {!bisecting && data.files.filter((f) => f.enabled).length > 1 && (
              <button role="menuitem" disabled={running} onClick={() => { close(); onBisect(); }}>
                {t("Найти виновника краша…")}<small>{t("по очереди выключает половину модов")}</small>
              </button>
            )}
            <button role="menuitem" disabled={grouping} onClick={() => { close(); autoGroups(); }}>
              {grouping ? t("Раскладываем…") : t("Разложить по наборам")}<small>{t("графика, интерфейс, оптимизация и другие")}</small>
            </button>
            <button role="menuitem" disabled={running} onClick={async () => {
              close();
              const chosen = await open({ multiple: true, directory: false, filters: [{ name: t("Моды"), extensions: ["jar"] }] }).catch(() => null);
              const jars = Array.isArray(chosen) ? chosen : chosen ? [chosen] : [];
              if (jars.length) await addJars(jars);
            }}>{t("Добавить файлы с диска…")}<small>{t("JAR-файлы модов, можно несколько")}</small></button>
          </>}
        </Dropdown>
      </div>
      {data.files.length === 0 ? (
        <div className="card empty"><p>{t("Модов пока нет. Добавьте их из каталога Modrinth или перетащите JAR-файлы в окно.")}</p></div>
      ) : (
        <div className="modsgrid">
          <div className="card" style={{ padding: 0, overflow: "auto" }}>
            <table className="modtable">
              <thead><tr><th style={{ width: 52 }} /><th>{t("Мод")}</th><th>{t("Версия")}</th><th>{t("Источник")}</th><th>{t("Состояние")}</th>{errCol && <th>{t("Ошибка")}</th>}</tr></thead>
              <tbody>
                {rowsIssues.length > 0 && <tr className="grp"><td colSpan={cols}>{t("Замечания: {0}", rowsIssues.length)}</td></tr>}
                {rowsIssues.map(row)}
                {rowsIssues.length > 0 && rowsRest.length > 0 && <tr className="grp"><td colSpan={cols}>{t("Остальные: {0}", rowsRest.length)}</td></tr>}
                {rowsRest.map(row)}
                {visible.length === 0 && <tr><td colSpan={cols} className="muted">{t("Ничего не нашлось.")}</td></tr>}
              </tbody>
            </table>
          </div>
          {sel && card(sel)}
        </div>
      )}

      <p className="muted small">{t("Состояние берётся из описаний внутри файлов модов. Точно скажет только запуск игры.")}</p>
      {plan && (
        <PlanDialog title={plan.title} plan={plan.plan} onClose={() => setPlan(null)} onApply={async (p) => { await mods.apply(inst.id, p, plan.reason); setPlan(null); setPicked(new Set()); load(); refreshUpdates(); }} />
      )}
    </>
  );
}
