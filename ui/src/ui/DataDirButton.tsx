// «Выбрать другую папку…» для данных Axel': перенести всё, начать с пустой или перейти на
// папку, где данные уже есть. После смены лаунчер перезапускается сам.
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, errText, sizeText, type DataDirCheck } from "../api";
import { t } from "../i18n";
import { Modal } from "./Dialog";

export function DataDirButton() {
  const [ask, setAsk] = useState<DataDirCheck | null>(null);
  const [moving, setMoving] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const off = listen<[number, number]>("data-move", ({ payload: [done, total] }) => setMoving({ done, total }));
    return () => { off.then((f) => f()).catch(() => {}); };
  }, []);

  const choose = async () => {
    setError("");
    const dir = await open({ directory: true, multiple: false, title: t("Новая папка для данных Axel'") });
    if (typeof dir !== "string") return;
    try { setAsk(await api.dataDirCheck(dir)); } catch (e) { setError(errText(e)); }
  };
  const go = async (mode: "move" | "empty" | "use_existing") => {
    if (!ask) return;
    setMoving({ done: 0, total: mode === "move" ? ask.size : 0 });
    try {
      await api.dataDirChange(ask.target, mode); // при успехе лаунчер перезапускается и сюда не вернётся
    } catch (e) {
      setMoving(null);
      setError(errText(e));
    }
    setAsk(null);
  };

  const pct = moving && moving.total ? Math.min(100, Math.round((moving.done / moving.total) * 100)) : 0;
  const tight = !!ask && ask.free != null && ask.free < ask.size;
  return (
    <>
      <button className="btn" onClick={choose}>{t("Выбрать другую папку…")}</button>
      {error && <div className="alert err"><span>{error}</span></div>}
      {ask && !moving && (
        <Modal title={ask.has_data ? t("Перейти на эту папку?") : t("Перенести данные?")} onClose={() => setAsk(null)}>
          <p className="mono small" style={{ userSelect: "text" }}>{ask.target}</p>
          {ask.has_data ? (
            <p>{t("Здесь уже есть данные Axel'. Лаунчер перезапустится и откроет их, текущие данные останутся на месте.")}</p>
          ) : (
            <>
              <p>{t("Сборки, миры, версии игры и Java занимают {0}. Их можно перенести сюда или начать с пустой папки, тогда текущие данные останутся на месте.", sizeText(ask.size))}</p>
              {ask.free != null && <p className="muted small">{t("Свободно на диске: {0}", sizeText(ask.free))}</p>}
              {tight && <div className="alert warn"><span>{t("Если это другой диск, места может не хватить.")}</span></div>}
            </>
          )}
          <p className="muted small">{t("Лаунчер перезапустится. Пока идёт игра, папку сменить нельзя.")}</p>
          <div className="acts">
            <button className="btn" onClick={() => setAsk(null)}>{t("Отмена")}</button>
            {ask.has_data ? (
              <button className="btn pri" onClick={() => go("use_existing")}>{t("Перейти")}</button>
            ) : (
              <>
                <button className="btn" onClick={() => go("empty")}>{t("Начать с пустой")}</button>
                <button className="btn pri" onClick={() => go("move")}>{t("Перенести")}</button>
              </>
            )}
          </div>
        </Modal>
      )}
      {moving && (
        <Modal title={t("Переносим данные")} onClose={() => {}}>
          <p>{moving.total ? t("Скопировано и сверено {0} из {1}", sizeText(moving.done), sizeText(moving.total)) : t("Готовим папку…")}</p>
          <span className="dlbar wide" role="progressbar" aria-label={t("Перенос данных")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></span>
          <p className="muted small">{t("Не закрывайте лаунчер. Когда всё будет готово, он перезапустится сам.")}</p>
        </Modal>
      )}
    </>
  );
}
