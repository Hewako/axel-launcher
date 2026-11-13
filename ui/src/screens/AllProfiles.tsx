// «Все профили» (макет 17): список всех профилей с поиском, фильтрами, сортировкой и размером на диске.
// Заменяет прежние экраны «Главная» и «Профили»; открывается кнопкой вверху рельсы.
import { useEffect, useMemo, useState } from "react";
import { api, errText, loaderName, relTime, sizeText, type Instance } from "../api";
import { isActive, launches, type LaunchState } from "../launches";
import { ProfileIcon } from "../ui/common";
import { useDialog } from "../ui/Dialog";
import { Icon } from "../ui/icons";
import { t } from "../i18n";

type Chip = "all" | "fav" | "attention" | "archive";
type Sort = "launch" | "name" | "size" | "mods";
type Status = { text: string; cls?: string };

export function AllProfiles({ instances, mods, states, status, onOpen, onNew }: {
  instances: Instance[];
  mods: Record<string, number>;
  states: Map<string, LaunchState>;
  status: (i: Instance) => Status;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const dialog = useDialog();
  const [chip, setChip] = useState<Chip>("all");
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
  const CHIPS: [Chip, string][] = [["all", t("Все")], ["fav", t("Избранные")], ["attention", t("Требуют внимания")], ["archive", t("Архив")]];

  return (
    <>
      <div className="shead">
        <div>
          <h2>{t("Все профили")}</h2>
          <p className="sub">{t("Профилей: {0}", counts.all)}{total ? `, ${t("{0} на диске", sizeText(total))}` : ""}</p>
        </div>
        <button className="btn cta" onClick={onNew}><Icon name="plus" size={16} /> {t("Новый профиль")}</button>
      </div>
      <div className="modbar">
        <div className="chips" role="group" aria-label={t("Какие профили показывать")}>
          {CHIPS.map(([k, l]) => <button key={k} className={`fchip ${chip === k ? "on" : ""}`} aria-pressed={chip === k} onClick={() => setChip(k)}>{l} <span className="muted">{counts[k]}</span></button>)}
        </div>
        <span style={{ flex: 1 }} />
        <span className="searchbox">
          <Icon name="search" size={16} />
          <input className="field" type="search" placeholder={t("Найти профиль")} aria-label={t("Найти профиль")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <select className="field auto" aria-label={t("Сортировка")} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="launch">{t("Сортировка: по запуску")}</option>
          <option value="name">{t("Сортировка: по названию")}</option>
          <option value="size">{t("Сортировка: по размеру")}</option>
          <option value="mods">{t("Сортировка: по числу модов")}</option>
        </select>
      </div>
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="modtable proftable">
          <thead><tr><th>{t("Профиль")}</th><th>{t("Игра и загрузчик")}</th><th className="num">{t("Моды")}</th><th className="num">{t("На диске")}</th><th>{t("Состояние")}</th><th>{t("Запуск")}</th><th /></tr></thead>
          <tbody>
            {shown.map((i) => {
              const s = status(i);
              const active = isActive(states.get(i.id));
              return (
                <tr key={i.id} className={i.archived ? "off" : ""} onClick={() => onOpen(i.id)}>
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
      <p className="muted small">{t("Архивные профили остаются на диске и показываются в конце рельсы слева, приглушёнными. Вернуть — снять «Архив» в «Игра → О профиле».")}</p>
    </>
  );
}
