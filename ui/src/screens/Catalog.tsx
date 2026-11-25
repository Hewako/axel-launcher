// Экран «Каталог»: моды, ресурспаки, шейдеры и сборки с Modrinth (и CurseForge, если есть ключ)
// на всю ширину окна. Ставит в выбранный профиль в фоне, по очереди; сборка становится новым профилем.
import { useEffect, useRef, useState } from "react";
import { api, errText, importer, loaderName, mods, type CatalogFilters, type CatalogSide, type CatalogSort, type CatalogSource, type Instance, type SearchHit } from "../api";
import { t } from "../i18n";
import { CATS } from "./ModsTab";

export type CatalogKind = "mod" | "resourcepack" | "shader" | "modpack";
/** С чем открыть каталог: профиль, вид и строка поиска (`n` — чтобы повторный переход сработал). */
export type CatalogTarget = { id?: string; kind: CatalogKind; query: string; n: number };

const PAGE = 20;
const KINDS: [CatalogKind, string][] = [["mod", t("Моды")], ["resourcepack", t("Ресурспаки")], ["shader", t("Шейдеры")], ["modpack", t("Модпаки")]];
const PACK_CATS: [string, string][] = [["adventure", t("Приключения")], ["technology", t("Техника")], ["magic", t("Магия")], ["quests", t("Квесты")], ["kitchen-sink", t("Всё сразу")], ["lightweight", t("Лёгкие")], ["optimization", t("Оптимизация")], ["multiplayer", t("Для сервера")], ["combat", t("Сражения")], ["challenging", t("Сложные")]];
const SORTS: [CatalogSort, string][] = [["relevance", t("Подходящие")], ["downloads", t("Популярные")], ["newest", t("Новые")], ["updated", t("Обновлённые")]];
const SIDES: [CatalogSide, string][] = [["", t("Любой")], ["required", t("Обязательно")], ["optional", t("Можно")], ["unsupported", t("Не нужен")]];
const VIEW_KEY = "axel.catalog.view";

type Status = "queued" | "installing" | "done";

function readView(): "list" | "tiles" {
  try { return localStorage.getItem(VIEW_KEY) === "tiles" ? "tiles" : "list"; } catch { return "list"; }
}

export function Catalog({ instances, target, onPack, onNew, onBack }: {
  instances: Instance[];
  target?: CatalogTarget;
  /** Сборка из каталога: открыть «Новый профиль» и поставить её. */
  onPack: (h: SearchHit) => void;
  onNew: () => void;
  /** Каталог открыли из профиля: кнопка «К профилю». */
  onBack?: () => void;
}) {
  const usable = instances.filter((i) => !i.archived);
  const [profileId, setProfileId] = useState(target?.id ?? usable[0]?.id);
  const inst = usable.find((i) => i.id === profileId) ?? usable[0];
  const [kind, setKind] = useState<CatalogKind>(target?.kind ?? "mod");
  const [query, setQuery] = useState(target?.query ?? "");
  const [source, setSource] = useState<CatalogSource>("modrinth");
  const [cf, setCf] = useState(false);
  useEffect(() => { api.appInfo().then((i) => setCf(i.curseforge)).catch(() => {}); }, []);
  const src: CatalogSource = cf && kind !== "modpack" ? source : "modrinth";
  const [sort, setSort] = useState<CatalogSort>("relevance");
  const [client, setClient] = useState<CatalogSide>("");
  const [server, setServer] = useState<CatalogSide>("");
  const [category, setCategory] = useState("");
  const [onlyInstalled, setOnlyInstalled] = useState(false);
  const [page, setPage] = useState(0);
  const [view, setView] = useState(readView);
  const [result, setResult] = useState<{ hits: SearchHit[]; total: number } | null>(null);
  const [error, setError] = useState("");
  const [installed, setInstalled] = useState<SearchHit[]>([]);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const queue = useRef<Promise<void>>(Promise.resolve());
  const typed = useRef(query);

  // Переход «Найти в каталоге» из профиля: подставить профиль, вид и запрос.
  useEffect(() => {
    if (!target) return;
    if (target.id) setProfileId(target.id);
    setKind(target.kind);
    setQuery(target.query);
    setPage(0);
  }, [target?.n]);

  const forProfile = kind !== "modpack";
  const needsLoader = kind === "mod" && inst?.loader === "vanilla";
  const sides = src === "modrinth" && (kind === "mod" || kind === "modpack");
  const cats = src !== "modrinth" ? [] : kind === "modpack" ? PACK_CATS : CATS[kind];

  const loadInstalled = () => {
    if (!inst || !forProfile) { setInstalled([]); return; }
    mods.installed(inst.id, kind as "mod").then(setInstalled).catch(() => setInstalled([]));
  };
  useEffect(loadInstalled, [inst?.id, kind]);

  // Поиск. Ждём паузы только пока человек печатает; фильтры и страницы — сразу.
  useEffect(() => {
    if (onlyInstalled && forProfile) return;
    if (forProfile && !inst) { setResult({ hits: [], total: 0 }); return; }
    setError("");
    setResult(null);
    let current = true;
    const delay = typed.current !== query ? 300 : 0;
    typed.current = query;
    const filters: CatalogFilters = {
      sort,
      category: category || null,
      client: sides && client ? client : null,
      server: sides && server ? server : null,
    };
    const timer = setTimeout(() => {
      const req = kind === "modpack"
        ? importer.searchPacks(query, page * PAGE, filters)
        : mods.search(inst!.id, query, kind, page * PAGE, src === "modrinth" ? filters : {}, src);
      req.then((r) => { if (current) setResult({ hits: r.hits, total: r.total_hits }); })
        .catch((e) => { if (current) { setResult({ hits: [], total: 0 }); setError(errText(e)); } });
    }, delay);
    return () => { current = false; clearTimeout(timer); };
  }, [inst?.id, kind, query, src, sort, client, server, category, page, onlyInstalled]);

  // Любая смена фильтра — снова с первой страницы.
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(0); };

  const key = (h: SearchHit) => `${inst?.id}\u0000${h.project_id}`;
  const installedIds = new Set(installed.map((h) => h.project_id));
  const install = (h: SearchHit) => {
    if (!inst) return;
    const id = inst.id;
    const k = kind;
    const s = src;
    const sk = key(h);
    setStatus((st) => ({ ...st, [sk]: "queued" }));
    queue.current = queue.current.then(async () => {
      setStatus((st) => ({ ...st, [sk]: "installing" }));
      try {
        if (k === "mod") await mods.apply(id, await mods.planInstall(id, h.project_id, "auto", s), t("Перед: установить {0}", h.title));
        else await api.installResource(id, h.project_id, k as "resourcepack" | "shader", undefined, s);
        setStatus((st) => ({ ...st, [sk]: "done" }));
        if (id === inst.id) loadInstalled();
      } catch (e) {
        setStatus((st) => { const { [sk]: _, ...rest } = st; return rest; });
        setError(`${h.title}: ${errText(e)}`);
      }
    });
  };

  const changeView = (v: "list" | "tiles") => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* без хранилища вид просто не запомнится */ }
  };

  // «Только установленные» — список из профиля, поиск по названию прямо здесь.
  const q = query.trim().toLowerCase();
  const shown: { hits: SearchHit[]; total: number } | null = onlyInstalled && forProfile
    ? { hits: installed.filter((h) => !q || h.title.toLowerCase().includes(q)), total: 0 }
    : result;
  const pages = Math.max(1, Math.ceil((shown?.total ?? 0) / PAGE));

  const button = (h: SearchHit) => {
    if (kind === "modpack") return <button className="btn" onClick={() => onPack(h)}>{t("Создать сборку")}</button>;
    const st = status[key(h)];
    if (st === "done" || (!st && installedIds.has(h.project_id))) return <button className="btn" disabled>{t("Установлено")}</button>;
    return (
      <button className="btn" disabled={!!st || needsLoader} onClick={() => install(h)}>
        {st === "installing" ? <><span className="spinner" /> {t("Ставим…")}</> : st === "queued" ? t("В очереди") : t("Установить")}
      </button>
    );
  };

  return (
    <>
      <div className="shead">
        <div>
          <h2>{t("Каталог")}</h2>
          <p className="sub">{kind === "modpack" ? t("Модпак станет новой сборкой.") : t("Показано то, что подходит к выбранной сборке.")}</p>
        </div>
        {onBack && <button className="btn" onClick={onBack}>{t("К сборке")}</button>}
      </div>

      <div className="cattools">
        <div className="seg subtabs" role="group" aria-label={t("Что ищем")}>
          {KINDS.map(([k, l]) => (
            <button key={k} className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => { setKind(k); setCategory(""); setPage(0); setOnlyInstalled(false); }}>{l}</button>
          ))}
        </div>
        {forProfile && usable.length > 0 && (
          <label className="pill catprofile">
            <span className="muted">{t("Сборка")}</span>
            <select aria-label={t("Сборка")} value={inst?.id} onChange={(e) => { setProfileId(e.target.value); setPage(0); }}>
              {usable.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            {inst && <span>Minecraft {inst.game_version}{inst.loader !== "vanilla" ? ` · ${loaderName[inst.loader]}` : ""}</span>}
          </label>
        )}
      </div>

      <div className="cattools">
        <input className="field grow" type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} aria-label={t("Поиск в каталоге")}
          placeholder={{ mod: t("Найти мод…"), resourcepack: t("Найти ресурспак…"), shader: t("Найти шейдер…"), modpack: t("Найти модпак…") }[kind]} data-autofocus />
        {cf && kind !== "modpack" && (
          <div className="seg" role="group" aria-label={t("Источник")}>
            <button className={source === "modrinth" ? "on" : ""} aria-pressed={source === "modrinth"} onClick={() => { setSource("modrinth"); setPage(0); }}>Modrinth</button>
            <button className={source === "curseforge" ? "on" : ""} aria-pressed={source === "curseforge"} onClick={() => { setSource("curseforge"); setCategory(""); setPage(0); }}>CurseForge</button>
          </div>
        )}
        <div className="seg" role="group" aria-label={t("Вид списка")}>
          <button className={view === "list" ? "on" : ""} aria-pressed={view === "list"} onClick={() => changeView("list")}>{t("Список")}</button>
          <button className={view === "tiles" ? "on" : ""} aria-pressed={view === "tiles"} onClick={() => changeView("tiles")}>{t("Плитка")}</button>
        </div>
      </div>

      {forProfile && usable.length === 0 ? (
        <div className="card empty">
          <p>{t("Чтобы ставить моды, ресурспаки и шейдеры, нужна сборка.")}</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn pri" onClick={onNew}>{t("+ Новая сборка")}</button>
            <button className="btn" onClick={() => setKind("modpack")}>{t("Выбрать модпак")}</button>
          </div>
        </div>
      ) : (
        <div className="catalog">
          <aside className="card catfilters" aria-label={t("Фильтры")}>
            {src === "modrinth" && (
              <label className="stack">
                <span className="lbl">{t("Порядок")}</span>
                <select className="field" value={sort} onChange={(e) => reset(setSort)(e.target.value as CatalogSort)} disabled={onlyInstalled}>
                  {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            )}
            {sides && (
              <>
                <label className="stack">
                  <span className="lbl">{t("На клиенте")}</span>
                  <select className="field" value={client} onChange={(e) => reset(setClient)(e.target.value as CatalogSide)} disabled={onlyInstalled}>
                    {SIDES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="stack">
                  <span className="lbl">{t("На сервере")}</span>
                  <select className="field" value={server} onChange={(e) => reset(setServer)(e.target.value as CatalogSide)} disabled={onlyInstalled}>
                    {SIDES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </>
            )}
            {forProfile && (
              <label className="check">
                <input type="checkbox" checked={onlyInstalled} onChange={(e) => reset(setOnlyInstalled)(e.target.checked)} />
                {t("Только установленные")}
              </label>
            )}
            {cats.length > 0 && (
              <fieldset className="catcats" disabled={onlyInstalled}>
                <legend className="lbl">{t("Категория")}</legend>
                {[["", t("Все")] as [string, string], ...cats].map(([v, l]) => (
                  <label key={v || "all"} className="check">
                    <input type="radio" name="catalog-category" checked={category === v} onChange={() => reset(setCategory)(v)} />
                    {l}
                  </label>
                ))}
              </fieldset>
            )}
          </aside>

          <section className="stack" aria-label={t("Результаты")}>
            {needsLoader && <div className="alert warn"><span>{t("В сборке «{0}» нет загрузчика модов. Выберите сборку с Fabric, Quilt, Forge или NeoForge.", inst!.name)}</span></div>}
            {kind === "shader" && <span className="muted small">{t("Шейдеры работают с модом Iris (Fabric/Quilt) или Oculus (NeoForge). После установки шейдер можно выбрать в разделе «Ресурсы и конфиги».")}</span>}
            {error && <div className="alert err"><span>{error}</span></div>}
            <div className={`card hits page ${view === "tiles" ? "tiles" : ""}`} aria-busy={shown === null}>
              {shown === null && <p className="muted"><span className="spinner" /> {t("Ищем…")}</p>}
              {shown?.hits.length === 0 && !error && <p className="muted">{onlyInstalled ? t("Из каталога здесь пока ничего не поставлено.") : t("Ничего не нашлось.")}</p>}
              {shown?.hits.map((h) => (
                <div className="hit" key={h.project_id}>
                  {h.icon_url ? <img src={h.icon_url} alt="" /> : <div className="noicon" />}
                  <div className="grow">
                    <b>{h.title}</b>
                    {(h.author || h.downloads > 0) && (
                      <span className="muted small"> · {[h.author, h.downloads > 0 ? t("{0} скачиваний", h.downloads.toLocaleString("ru-RU")) : ""].filter(Boolean).join(" · ")}</span>
                    )}
                    {h.description && <small>{h.description}</small>}
                  </div>
                  {button(h)}
                </div>
              ))}
            </div>
            {!(onlyInstalled && forProfile) && shown && shown.total > PAGE && (
              <nav className="row pager" aria-label={t("Страницы")}>
                <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>{t("Назад")}</button>
                <span className="muted">{t("Страница {0} из {1}", page + 1, pages)}</span>
                <button className="btn" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t("Вперёд")}</button>
              </nav>
            )}
          </section>
        </div>
      )}
    </>
  );
}
