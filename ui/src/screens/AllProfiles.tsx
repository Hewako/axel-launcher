// «Все профили» (макет 17): список всех профилей с поиском, фильтрами, сортировкой и размером на диске.
// Заменяет прежние экраны «Главная» и «Профили»; открывается кнопкой вверху рельсы.
import { useEffect, useMemo, useState } from "react";
import { api, errText, loaderName, relTime, sizeText, snapshots, type HistoryItem, type Instance, type StoredWorld, type TrashEntry } from "../api";
import { HistoryMap } from "../ui/HistoryMap";
import { isActive, launches, type LaunchState } from "../launches";
import { ProfileIcon, pressable } from "../ui/common";
import { useDialog } from "../ui/Dialog";
import { Icon } from "../ui/icons";
import { t } from "../i18n";

type Chip = "all" | "fav" | "attention" | "archive" | "worlds" | "trash" | "history";
type Sort = "launch" | "name" | "size" | "mods";
type Status = { text: string; cls?: string };

export function AllProfiles({ instances, mods, states, status, onOpen, onNew, onRestored }: {
  instances: Instance[];
  mods: Record<string, number>;
  states: Map<string, LaunchState>;
  status: (i: Instance) => Status;
  onOpen: (id: string) => void;
  onNew: () => void;
  /** Сборку вернули из корзины. */
  onRestored: (i: Instance) => void;
}) {
  const dialog = useDialog();
  const [chip, setChip] = useState<Chip>("all");
  const [trash, setTrash] = useState<TrashEntry[] | null>(null);
  const loadTrash = () => { api.trashList().then(setTrash).catch(() => setTrash([])); };
  useEffect(loadTrash, [instances.length]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("launch");
  const [sizes, setSizes] = useState<Record<string, number>>({});
  // Размеры считаются по очереди: обход папок больших профилей занимает время.
  const ids = instances.map((i) => i.id).join("\n");
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const id of ids.split("\n").filter(Boolean)) {
        if (!alive) return;
        await api.diskUsage(id).then((u) => alive && setSizes((s) => ({ ...s, [id]: u.total }))).catch(() => {});
      }
    })();
    return () => { alive = false; };
  }, [ids]);

  const attention = (i: Instance) => !i.archived && ["err", "warn"].includes(status(i).cls ?? "");
  const counts: Record<Chip, number> = {
    all: instances.filter((i) => !i.archived).length,
    fav: instances.filter((i) => i.favorite && !i.archived).length,
    attention: instances.filter(attention).length,
    archive: instances.filter((i) => i.archived).length,
    trash: trash?.length ?? 0,
    history: 0,
    worlds: 0,
  };
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = instances.filter((i) => (chip === "archive" ? i.archived : !i.archived)
      && (chip !== "fav" || i.favorite) && (chip !== "attention" || attention(i))
      && (!q || i.name.toLowerCase().includes(q) || i.game_version.includes(q) || (i.group ?? "").toLowerCase().includes(q)));
    const by: Record<Sort, (a: Instance, b: Instance) => number> = {
      launch: (a, b) => (b.last_launch?.at ?? 0) - (a.last_launch?.at ?? 0),
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => (sizes[b.id] ?? 0) - (sizes[a.id] ?? 0),
      mods: (a, b) => (mods[b.id] ?? 0) - (mods[a.id] ?? 0),
    };
    return list.sort(by[sort]);
  }, [instances, chip, query, sort, sizes, mods]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);

  const play = async (i: Instance) => {
    try { launches.begin(i.id); await api.launch(i.id, undefined, false, false); onOpen(i.id); }
    catch (e) { await dialog.alert(t("Не удалось начать запуск"), errText(e)); }
  };
  const CHIPS: [Chip, string][] = [["all", t("Все")], ["fav", t("Избранные")], ["attention", t("Требуют внимания")], ["archive", t("Архив")], ["worlds", t("Миры")], ["trash", t("Корзина")], ["history", t("История")]];

  return (
    <>
      <div className="shead">
        <div>
          <h1>{t("Сборки")}</h1>
          <p className="sub">{t("Сборок: {0}", counts.all)}{total ? `, ${t("{0} на диске", sizeText(total))}` : ""}</p>
        </div>
        <button className="btn cta" onClick={onNew}><Icon name="plus" size={16} /> {t("Новая сборка")}</button>
      </div>
      <div className="modbar">
        <div className="chips" role="group" aria-label={t("Какие сборки показывать")}>
          {CHIPS.map(([k, l]) => <button key={k} className={`fchip ${chip === k ? "on" : ""}`} aria-pressed={chip === k} onClick={() => setChip(k)}>{l}{k !== "history" && k !== "worlds" && <> <span className="muted">{counts[k]}</span></>}</button>)}
        </div>
        <span style={{ flex: 1 }} />
        <span className="searchbox">
          <Icon name="search" size={16} />
          <input className="field" type="search" placeholder={t("Найти сборку")} aria-label={t("Найти сборку")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        {chip !== "trash" && chip !== "history" && chip !== "worlds" && <select className="field auto" aria-label={t("Сортировка")} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="launch">{t("Сортировка: по запуску")}</option>
          <option value="name">{t("Сортировка: по названию")}</option>
          <option value="size">{t("Сортировка: по размеру")}</option>
          <option value="mods">{t("Сортировка: по числу модов")}</option>
        </select>}
      </div>
      {chip === "worlds" ? <WorldsView instances={instances} /> : chip === "history" ? <HistoryView onRestored={onRestored} /> : chip === "trash" ? <TrashView list={trash} onChanged={loadTrash} onRestored={onRestored} /> : <>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="modtable proftable">
          <thead><tr><th>{t("Сборка")}</th><th>{t("Игра и загрузчик")}</th><th className="num">{t("Моды")}</th><th className="num">{t("На диске")}</th><th>{t("Состояние")}</th><th>{t("Запуск")}</th><th /></tr></thead>
          <tbody>
            {shown.map((i) => {
              const s = status(i);
              const active = isActive(states.get(i.id));
              return (
                <tr key={i.id} className={`pick ${i.archived ? "off" : ""}`} {...pressable(() => onOpen(i.id))}>
                  <td>
                    <button className="rowname profrow" onClick={(e) => { e.stopPropagation(); onOpen(i.id); }}>
                      <ProfileIcon id={i.id} color={i.color} size={28} />
                      <span><b>{i.name}</b>{(i.favorite || i.group) && <small className="muted">{[i.favorite && t("Избранный"), i.group].filter(Boolean).join(" · ")}</small>}</span>
                    </button>
                  </td>
                  <td>{i.game_version}, {i.loader === "vanilla" ? t("без модов") : loaderName[i.loader]}</td>
                  <td className="num mono">{i.loader === "vanilla" ? 0 : mods[i.id] ?? "…"}</td>
                  <td className="num mono">{sizes[i.id] !== undefined ? sizeText(sizes[i.id]) : "…"}</td>
                  <td><span className={`state ${s.cls === "err" ? "err" : s.cls === "warn" ? "warn" : s.cls === "ok" ? "ok" : ""}`}>
                    {s.cls === "err" ? <Icon name="error" size={14} /> : s.cls === "warn" ? <Icon name="warn" size={14} /> : null} {s.text}</span></td>
                  <td className="muted">{i.last_launch ? relTime(i.last_launch.at) : t("не запускался")}</td>
                  <td><button className="btn small" disabled={active || !!i.archived} onClick={(e) => { e.stopPropagation(); play(i); }}><Icon name="play" size={14} /> {t("Играть")}</button></td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={7} className="muted">{query ? t("Ничего не нашлось.") : chip === "archive" ? t("В архиве пусто.") : t("Здесь пока никого.")}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted small">{t("Архивные сборки остаются на диске, их видно в фильтре «Архив». Чтобы вернуть сборку, снимите «Архив» в «Игра → О сборке».")}</p>
      </>}
    </>
  );
}

/** Корзина: вернуть сборку целиком или удалить навсегда. «Удалить навсегда» появляется только
 *  после «Удалить» и не там, где был курсор, и включается через секунду — двойной щелчок
 *  ничего не сотрёт. Миры при этом остаются, рецепт сборки — в истории. */
function TrashView({ list, onChanged, onRestored }: { list: TrashEntry[] | null; onChanged: () => void; onRestored: (i: Instance) => void }) {
  const dialog = useDialog();
  const [days, setDays] = useState(30);
  const [asking, setAsking] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState("");
  useEffect(() => { api.globalSettings().then((g) => setDays(g.trash_days || 30)).catch(() => {}); }, []);
  useEffect(() => {
    setArmed(false);
    if (!asking) return;
    const timer = setTimeout(() => setArmed(true), 1000);
    return () => clearTimeout(timer);
  }, [asking]);
  const run = async (key: string, f: () => Promise<unknown>, fail: string) => {
    setBusy(key);
    try { await f(); } catch (e) { await dialog.alert(fail, errText(e)); } finally { setBusy(""); setAsking(""); onChanged(); }
  };
  const left = (e: TrashEntry) => Math.max(0, Math.ceil((e.deleted_at + days * 86400 - Date.now() / 1000) / 86400));
  return (
    <>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="modtable proftable">
          <thead><tr><th>{t("Сборка")}</th><th>{t("Игра и загрузчик")}</th><th className="num">{t("На диске")}</th><th>{t("Удалена")}</th><th /></tr></thead>
          <tbody>
            {list === null && <tr><td colSpan={5} className="muted"><span className="spinner" /> {t("Загружаем…")}</td></tr>}
            {list?.length === 0 && <tr><td colSpan={5} className="muted">{t("Корзина пуста.")}</td></tr>}
            {list?.map((e) => (
              <tr key={e.key}>
                <td><b>{e.name}</b></td>
                <td>{e.game_version}, {e.loader === "vanilla" ? t("без модов") : loaderName[e.loader]}</td>
                <td className="num mono">{sizeText(e.size)}</td>
                <td className="muted">{relTime(e.deleted_at)} · {t("удалится через {0} дн.", left(e))}</td>
                <td className="trashacts">
                  {asking === e.key ? (
                    <>
                      <button className="btn small danger" disabled={!armed || busy !== ""} onClick={() => run(e.key, () => api.trashDelete(e.key), t("Не удалось удалить"))}>{t("Удалить навсегда")}</button>
                      <button className="btn small" autoFocus onClick={() => setAsking("")}>{t("Отмена")}</button>
                    </>
                  ) : (
                    <>
                      <button className="btn small" disabled={busy !== ""} onClick={() => run(e.key, async () => onRestored(await api.trashRestore(e.key)), t("Не удалось вернуть"))}>{busy === e.key ? t("Возвращаем…") : t("Вернуть")}</button>
                      <button className="btn small link" disabled={busy !== ""} onClick={() => setAsking(e.key)}>{t("Удалить")}</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">{t("Миры удалённых сборок не удаляются: их можно перенести в другую сборку на вкладке «Откат». Сборку можно вернуть и после удаления навсегда, из истории.")}</p>
    </>
  );
}

/** История всех сборок, в том числе удалённых: выбрать сборку — увидеть карту её изменений. */
function HistoryView({ onRestored }: { onRestored: (i: Instance) => void }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [sel, setSel] = useState("");
  useEffect(() => { api.historyItems().then((l) => { setItems(l); setSel((s) => s || l[0]?.id || ""); }).catch(() => setItems([])); }, []);
  const current = items?.find((i) => i.id === sel);
  return (
    <>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="modtable proftable">
          <thead><tr><th>{t("Сборка")}</th><th>{t("Игра и загрузчик")}</th><th className="num">{t("Записей")}</th><th>{t("Последнее изменение")}</th><th /></tr></thead>
          <tbody>
            {items === null && <tr><td colSpan={5} className="muted"><span className="spinner" /> {t("Загружаем…")}</td></tr>}
            {items?.length === 0 && <tr><td colSpan={5} className="muted">{t("История пока пуста.")}</td></tr>}
            {items?.map((i) => (
              <tr key={i.id} className={`pick ${sel === i.id ? "sel" : ""}`} aria-selected={sel === i.id} {...pressable(() => setSel(i.id))}>
                <td><b>{i.name}</b></td>
                <td>{i.game_version}, {i.loader === "vanilla" ? t("без модов") : loaderName[i.loader]}</td>
                <td className="num mono">{i.entries}</td>
                <td className="muted">{relTime(i.last_at)}</td>
                <td>{!i.alive && <span className="badge warn">{t("удалена")}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {current && (
        <section className="card">
          <h2>{current.alive ? t("История «{0}»", current.name) : t("История удалённой сборки «{0}»", current.name)}</h2>
          <HistoryMap id={current.id} alive={current.alive} onRestored={onRestored} />
        </section>
      )}
    </>
  );
}

/** Линейка версии: 1.16.5 → 1.16, 26.3.1 → 26.3 (как в ядре, worlds::version_line). */
const lineOf = (v: string) => { const p = v.split("."); return p.length >= 2 && p.every((x) => /^\d+$/.test(x)) ? p.slice(0, 2).join(".") : v; };
/** Сравнить линейки: < 0 — первая старше; null — несравнимы (снапшоты). */
const cmpLine = (a: string, b: string) => {
  const ka = a.split(".").map(Number), kb = b.split(".").map(Number);
  if (ka.some(isNaN) || kb.some(isNaN)) return a === b ? 0 : null;
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) { const d = (ka[i] ?? 0) - (kb[i] ?? 0); if (d) return d; }
  return 0;
};

/** Все миры, в том числе удалённых сборок и версий, от которых не осталось сборок.
 *  Перенести можно в сборку той же линейки или новее (тогда игра обновит мир, перед этим — бэкап). */
function WorldsView({ instances }: { instances: Instance[] }) {
  const dialog = useDialog();
  const [list, setList] = useState<StoredWorld[] | null>(null);
  const [busy, setBusy] = useState("");
  const load = () => { snapshots.allWorlds().then(setList).catch(() => setList([])); };
  useEffect(load, []);
  const targets = (w: StoredWorld) => instances
    .filter((i) => !i.archived && i.id !== w.owner_id && !i.external_game_dir)
    .map((i) => ({ i, d: w.line ? cmpLine(w.line, lineOf(i.game_version)) : null }))
    .filter((x) => x.d !== null && x.d <= 0)
    .sort((a, b) => (b.d ?? 0) - (a.d ?? 0));
  const move = async (w: StoredWorld, target: Instance, older: boolean) => {
    const notes = [
      older && t("Мир из версии {0}. Игра обновит его до {1}, и открыть его в старой версии потом не получится.", w.world.version_name ?? "?", target.game_version),
      t("Сразу после переноса Axel' сделает бэкап мира, вернуть его можно в любой момент."),
    ].filter(Boolean) as string[];
    const ok = await dialog.confirm({
      title: t("Перенести «{0}» в «{1}»?", w.world.name, target.name),
      body: <>{notes.map((n, i) => <p key={i} style={{ margin: "0 0 8px" }}>{n}</p>)}</>,
      confirm: older ? t("Бэкап и перенести") : t("Перенести"),
    });
    if (!ok) return;
    const key = `${w.owner_id}/${w.world.folder}`;
    setBusy(key);
    try { await snapshots.adoptWorld(target.id, w.owner_id, w.world.folder); load(); }
    catch (e) { await dialog.alert(t("Мир не перенесён"), errText(e)); }
    finally { setBusy(""); }
  };
  return (
    <>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="modtable proftable">
          <thead><tr><th>{t("Мир")}</th><th>{t("Версия")}</th><th className="num">{t("На диске")}</th><th>{t("Сборка")}</th><th>{t("Играли")}</th><th /></tr></thead>
          <tbody>
            {list === null && <tr><td colSpan={6} className="muted"><span className="spinner" /> {t("Загружаем…")}</td></tr>}
            {list?.length === 0 && <tr><td colSpan={6} className="muted">{t("Миров пока нет.")}</td></tr>}
            {list?.map((w) => {
              const key = `${w.owner_id}/${w.world.folder}`;
              const opts = targets(w);
              return (
                <tr key={key}>
                  <td><b>{w.world.name}</b>{w.world.hardcore && <span className="badge err" style={{ marginLeft: 6 }}>{t("хардкор")}</span>}</td>
                  <td>{w.world.version_name ?? t("неизвестна")}</td>
                  <td className="num mono">{sizeText(w.world.size)}</td>
                  <td>{w.owner_name ?? <span className="muted">{t("сборка удалена")}</span>}</td>
                  <td className="muted">{w.world.last_played ? relTime(w.world.last_played) : "—"}</td>
                  <td>
                    {opts.length > 0 ? (
                      <select className="field auto" aria-label={t("Перенести «{0}» в сборку", w.world.name)} value="" disabled={busy !== ""}
                        onChange={(e) => { const o = opts.find((x) => x.i.id === e.target.value); if (o) move(w, o.i, (o.d ?? 0) < 0); }}>
                        <option value="">{busy === key ? t("Переносим…") : t("Перенести в сборку…")}</option>
                        {opts.map(({ i, d }) => <option key={i.id} value={i.id}>{i.name} ({i.game_version}){(d ?? 0) < 0 ? ` · ${t("обновит мир")}` : ""}</option>)}
                      </select>
                    ) : <span className="muted small">{t("нет подходящей сборки")}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">{t("Миры лежат отдельно от сборок: удаление сборки их не трогает. Перенести можно в сборку той же версии или новее.")}</p>
    </>
  );
}
