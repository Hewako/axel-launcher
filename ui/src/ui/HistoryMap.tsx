// Карта истории сборки: лента с точками по датам изменений. Наведение (или фокус с клавиатуры)
// показывает, что изменилось; нажатие закрепляет подробности и кнопку возврата.
import { useEffect, useState } from "react";
import { api, errText, type HistoryChange, type HistoryPoint, type Instance } from "../api";
import { t } from "../i18n";
import { useDialog } from "./Dialog";

const KIND: Record<string, string> = { mods: t("мод"), resourcepacks: t("ресурспак"), shaderpacks: t("шейдер") };

/** Одно изменение словами. */
export function changeText(c: HistoryChange): string {
  switch (c.kind) {
    case "created": return t("Сборка появилась в истории, файлов: {0}", c.files);
    case "added": return t("Добавлен {0} {1}", KIND[c.folder] ?? "", [c.title, c.version].filter(Boolean).join(" "));
    case "removed": return t("Убран {0} {1}", KIND[c.folder] ?? "", c.title);
    case "updated": return c.from || c.to ? t("{0}: {1} → {2}", c.title, c.from ?? "?", c.to ?? "?") : t("{0}: файл изменился", c.title);
    case "enabled": return t("Включён {0}", c.title);
    case "disabled": return t("Выключен {0}", c.title);
    case "configs": return t("Настройки игры и модов: файлов изменено {0}", c.changed);
    case "game": return t("Версия игры {0} → {1}", c.from, c.to);
    case "loader": return t("Загрузчик {0} → {1}", c.from, c.to);
    case "renamed": return t("Название «{0}» → «{1}»", c.from, c.to);
    case "settings": return t("Параметры сборки (память, Java, вход)");
  }
}

const day = (at: number) => new Date(at * 1000).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
const full = (at: number) => new Date(at * 1000).toLocaleString(undefined, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function HistoryMap({ id, alive, onRestored }: { id: string; alive: boolean; onRestored: (i: Instance) => void }) {
  const dialog = useDialog();
  const [points, setPoints] = useState<HistoryPoint[] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPoints(null);
    setPicked(null);
    api.historyTimeline(id).then((p) => { setPoints(p); setPicked(p.length ? p[p.length - 1].at : null); }).catch(() => setPoints([]));
  }, [id]);

  if (points === null) return <p className="muted"><span className="spinner" /> {t("Загружаем…")}</p>;
  if (points.length === 0) return <p className="muted">{t("Истории пока нет: она начнётся с первого изменения сборки.")}</p>;

  const shown = points.find((p) => p.at === (hover ?? picked));
  const restore = async (p: HistoryPoint) => {
    const ok = await dialog.confirm({
      title: alive ? t("Создать сборку из версии {0}?", full(p.at)) : t("Вернуть сборку как на {0}?", full(p.at)),
      body: alive
        ? t("Появится новая сборка с теми же модами и настройками, текущая не изменится. Моды скачаются заново с Modrinth и CurseForge.")
        : t("Сборка вернётся вместе со своими мирами. Моды скачаются заново с Modrinth и CurseForge, файлы без источника возьмутся из копии."),
      confirm: alive ? t("Создать сборку") : t("Вернуть сборку"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.historyRestore(id, p.at);
      if (r.missing.length) {
        await dialog.alert(t("Сборка возвращена не полностью"), <>
          <p>{t("Этих файлов больше нет у источника и нет копии:")}</p>
          <ul>{r.missing.map((m) => <li key={m}>{m}</li>)}</ul>
        </>);
      }
      onRestored(r.instance);
    } catch (e) {
      await dialog.alert(t("Не удалось вернуть сборку"), errText(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="hmap">
      <div className="hmap-track" role="list" aria-label={t("Изменения сборки по датам")}>
        {points.map((p) => (
          <div role="listitem" key={p.at} className="hmap-stop">
            <button
              className={`hmap-dot ${picked === p.at ? "on" : ""} ${p.changes.length > 3 ? "big" : ""}`}
              aria-pressed={picked === p.at}
              aria-label={t("{0}: изменений {1}", full(p.at), p.changes.length)}
              onMouseEnter={() => setHover(p.at)} onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(p.at)} onBlur={() => setHover(null)}
              onClick={() => setPicked(p.at)} />
            <span className="hmap-day">{day(p.at)}</span>
          </div>
        ))}
      </div>
      {shown && (
        <div className="hmap-card" aria-live="polite">
          <div className="sechead">
            <b>{full(shown.at)}</b>
            <span className="muted small">{t("модов: {0}", shown.mods)}</span>
          </div>
          <ul className="hmap-changes">
            {shown.changes.map((c, i) => <li key={i} className={c.kind}>{changeText(c)}</li>)}
          </ul>
          {hover === null && (
            <button className="btn" disabled={busy} onClick={() => restore(shown)}>
              {busy ? t("Возвращаем…") : alive ? t("Создать сборку из этой версии") : t("Вернуть сборку")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
