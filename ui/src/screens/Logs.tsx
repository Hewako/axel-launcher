import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, diagnostics, duration, errText, relTime, sizeText, type Instance, type LastLaunch, type LaunchRun } from "../api";
import { Modal, useDialog } from "../ui/Dialog";
import type { LaunchState } from "../launches";
import { LogView } from "../ui/LogView";
import { CrashCard } from "../ui/CrashCard";
import { Icon } from "../ui/icons";
import { t, tc } from "../i18n";
import { clearNotes, useNotes } from "../notify";

/** Итог запуска словами: «Падение через 11 с», «Без ошибок, 48 мин». */
function runTitle(r: LastLaunch): string {
  switch (r.outcome) {
    case "success": return r.duration_secs ? t("Без ошибок, {0}", duration(r.duration_secs)) : t("Без ошибок");
    case "crashed": return t("Падение через {0}", duration(r.duration_secs));
    case "killed": return r.duration_secs ? t("Остановлен через {0}", duration(r.duration_secs)) : t("Остановлен");
    case "failed_to_start": return t("Не запустился");
  }
}
const toneOf = (r: LastLaunch) => (r.outcome === "success" ? "ok" : r.outcome === "killed" ? "warn" : "err");
const baseName = (p?: string) => p?.split(/[\\/]/).pop();
const when = (at: number) => new Date(at * 1000).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Логи и краши (макеты 06, 16): журнал запусков всех профилей с фильтром по профилю, справа разбор и лог выбранного. */
export function Logs({ instances, states, id, onPick }: { instances: Instance[]; states: Map<string, LaunchState>; id?: string; onPick: (id: string) => void }) {
  const dialog = useDialog();
  const [history, setHistory] = useState<LaunchRun[] | null>(null);
  // Фильтр по профилю: по умолчанию — выбранный профиль (решение владельца 22.10.2026), «» — все.
  const [filter, setFilter] = useState(id ?? "");
  const [sel, setSel] = useState("");
  const [file, setFile] = useState<string[] | null>(null);
  const [err, setErr] = useState("");
  const [crashes, setCrashes] = useState<{ file: string; when: string; size: number; description: string }[]>([]);
  const [shown, setShown] = useState<{ title: string; text: string } | null>(null);
  const [report, setReport] = useState<{ name: string; content: string }[] | null>(null);
  const [part, setPart] = useState(0);
  const phases = [...states.values()].map((s) => s.phase).join();
  useEffect(() => { api.launchHistory().then(setHistory).catch(() => setHistory([])); }, [phases]);

  const nameOf = (pid: string) => instances.find((i) => i.id === pid)?.name ?? pid;
  const { notes } = useNotes();
  const runs = (history ?? []).filter((r) => !filter || r.id === filter);
  const key = (r: LaunchRun) => `${r.id}:${r.at}`;
  const run = runs.find((r) => key(r) === sel) ?? runs[0];
  const inst = instances.find((i) => i.id === (run?.id ?? filter)) ?? instances.find((i) => i.id === id);
  const state = inst ? states.get(inst.id) : undefined;
  // Свежий запуск этого профиля ещё идёт или только что закончился — лог берём из памяти.
  const live = !!state && state.logs.length > 0 && (!run || state.startedAt / 1000 >= run.at - 1);
  const exit = live ? state?.exit : undefined;
  useEffect(() => { if (inst) diagnostics.crashReports(inst.id).then(setCrashes).catch(() => setCrashes([])); }, [inst?.id, state?.phase]);
  useEffect(() => {
    setFile(null); setErr("");
    if (!run || live) return;
    const name = baseName(run.log_file);
    if (!name) { setErr(run.outcome === "failed_to_start" ? t("У этого запуска нет лога: игра не стартовала.") : t("Лог этого запуска не сохранён.")); return; }
    api.readLogFile(run.id, name).then(setFile).catch(() => setErr(t("Лог этого запуска уже удалён: хранятся последние 20.")));
  }, [run?.id, run?.at, live]); // eslint-disable-line react-hooks/exhaustive-deps

  const openReport = () => { if (inst) diagnostics.reportPreview(inst.id).then((r) => { setReport(r); setPart(0); }).catch((e) => dialog.alert(t("Отчёт не собран"), errText(e))); };
  const latestBad = history?.[0] && history[0].outcome !== "success" && history[0].outcome !== "killed";

  return (
    <>
      <h1>{t("Логи и краши")}</h1>
      {/* Уведомления: колокольчик на рельсе ведёт сюда. */}
      {notes.length > 0 && (
        <section className="card notes" aria-label={t("Уведомления")}>
          <div className="sechead">
            <h2>{t("Уведомления")}</h2>
            <button className="btn link small" onClick={clearNotes}>{t("Очистить")}</button>
          </div>
          <ul>
            {notes.slice(0, 10).map((n) => (
              <li key={n.id} className={n.kind}>
                <Icon name={n.kind === "err" ? "error" : n.kind === "warn" ? "warn" : "info"} size={16} />
                <div>
                  <b>{tc(n.title)}</b>
                  {n.body && <small>{tc(n.body)}</small>}
                  <small className="muted">{[n.profile && nameOf(n.profile), relTime(Math.floor(n.at / 1000))].filter(Boolean).join(" · ")}</small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="sub">{history && history.length === 0 ? t("Запусков пока нет") : `${t("Запуски всех сборок.")}${latestBad ? ` ${t("Последний закончился ошибкой.")}` : ""}`}</p>
      {history && history.length === 0 ? (
        <div className="logsgrid">
          <div className="card cempty"><b>{t("Запусков ещё не было")}</b><span>{t("Когда вы запустите игру, она появится здесь.")}</span></div>
          <div className="card cempty" style={{ padding: "40px 16px" }}><Icon name="file" size={18} /><b>{t("Лог первого запуска появится здесь")}</b><span>{t("Если игра упадёт, Axel' покажет вероятную причину и предложит починить сборку.")}</span></div>
        </div>
      ) : (
      <div className="logsgrid">
        <nav className="card runs" aria-label={t("Запуски")}>
          <select className="field" aria-label={t("Чьи запуски показывать")} value={filter} onChange={(e) => { setFilter(e.target.value); setSel(""); if (e.target.value) onPick(e.target.value); }}>
            <option value="">{t("Все сборки")}</option>
            {instances.map((i) => <option key={i.id} value={i.id}>{t("Запуски сборки «{0}»", i.name)}</option>)}
          </select>
          {history === null && <p className="muted small"><span className="spinner" /> {t("Загружаем…")}</p>}
          {history !== null && runs.length === 0 && <p className="muted small">{t("Эту сборку ещё не запускали.")}</p>}
          {runs.map((r) => (
            <button key={key(r)} className={`run ${toneOf(r)} ${run && key(r) === key(run) ? "on" : ""}`} aria-current={run && key(r) === key(run) ? "true" : undefined} onClick={() => setSel(key(r))}>
              <span className="muted small">{relTime(r.at)}</span>
              <b>{runTitle(r)}</b>
              <span className="muted small">{[!filter && nameOf(r.id), r.outcome !== "success" && r.message ? tc(r.message) : r.peak_ram_mb ? t("Пик памяти {0} ГБ", (r.peak_ram_mb / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })) : ""].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </nav>
        <div className="stack">
          {exit?.analysis && inst && <CrashCard inst={inst} a={exit.analysis} code={exit.code} onReport={openReport} />}
          {run && !exit?.analysis && run.outcome === "crashed" && (
            <div className="alert err">
              <div className="h">{t("Игра упала")}{run.exit_code != null ? t(" с кодом {0}", run.exit_code) : ""}</div>
              {run.message && <span>{tc(run.message)}</span>}
              <span className="small">{t("Подробный разбор виден сразу после краша, а здесь сохранённый лог. Посмотрите вкладку «Ошибки», обычно причина в первой строке «Caused by».")}</span>
            </div>
          )}
          {run?.outcome === "failed_to_start" && !live && (
            <div className="alert err"><div className="h">{t("Запуск не начался")}</div><span style={{ userSelect: "text" }}>{tc(run.message)}</span></div>
          )}
          <section className="card">
            <h2>{t("Лог запуска")}{run ? `, ${when(run.at)}` : ""}{inst && !filter ? ` · ${inst.name}` : ""}</h2>
            {live && state ? <LogView lines={state.logs} /> : file ? <LogView lines={file} follow={false} /> : <p className="muted">{err || <><span className="spinner" /> {t("Загружаем лог…")}</>}</p>}
            {run && (run.prepare_secs !== undefined || run.cpu_percent) ? (
              <p className="muted small">{run.prepare_secs !== undefined ? t("Подготовка {0}", duration(run.prepare_secs)) : ""}{run.cpu_percent ? t(" · процессор в среднем {0} %", run.cpu_percent) : ""}</p>
            ) : null}
            {inst && (
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn" onClick={openReport}>{t("Отчёт для поддержки…")}</button>
                <button className="btn" onClick={() => api.openFolder(inst.id, "logs")}>{t("Папка логов игры")}</button>
                <button className="btn" onClick={() => api.openFolder(inst.id, "crash-reports")}>{t("Открыть crash-reports")}</button>
              </div>
            )}
            <p className="muted small">{t("В отчёте скрыты токены, путь к домашней папке и IP-адреса (в режиме стримера и ник).")}</p>
          </section>
        {inst && crashes.length > 0 && (
          <>
            <h3 className="subhead">{t("Отчёты о крашах ·")} {crashes.length}</h3>
            <div className="card" style={{ padding: 0 }}>
              <table className="servers">
                <tbody>
                  {crashes.map((c) => (
                    <tr key={c.file}>
                      <td><b>{c.description || t("Без описания")}</b><div className="muted small">{c.when} · {sizeText(c.size)}</div></td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn" onClick={() => diagnostics.readCrash(inst.id, c.file).then((text) => setShown({ title: c.when, text })).catch((e) => dialog.alert(t("Не открылся"), errText(e)))}>{t("Открыть")}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        </div>
      </div>
      )}
      {shown && (
        <Modal title={t("Отчёт о краше · {0}", shown.title)} onClose={() => setShown(null)} wide>
          <pre className="cfgdiff" style={{ userSelect: "text" }}>{shown.text}</pre>
          <div className="acts"><button className="btn pri" onClick={() => setShown(null)}>{t("Закрыть")}</button></div>
        </Modal>
      )}
      {report && inst && (
        <Modal title={t("Отчёт для поддержки")} onClose={() => setReport(null)} wide>
          <p className="small muted" style={{ marginTop: 0 }}>{t("Вот что попадёт в архив, проверьте перед отправкой. Токены, путь к домашней папке и IP-адреса уже скрыты")}{" "}{t("(в режиме стримера и ник).")}</p>
          <div className="seg" role="tablist" style={{ flexWrap: "wrap" }}>
            {report.map((f, i) => <button key={f.name} role="tab" aria-selected={part === i} className={part === i ? "on" : ""} onClick={() => setPart(i)}>{f.name}</button>)}
          </div>
          <pre className="cfgdiff" style={{ userSelect: "text", marginTop: 8 }}>{report[part]?.content}</pre>
          <div className="acts">
            <button className="btn" onClick={() => setReport(null)}>{t("Закрыть")}</button>
            <button className="btn pri" onClick={async () => {
              if (!inst) return;
              const path = await save({ title: t("Сохранить отчёт"), defaultPath: `axel-report-${inst.id}.zip`, filters: [{ name: "ZIP", extensions: ["zip"] }] }).catch(() => null);
              if (!path) return;
              try { await diagnostics.reportSave(inst.id, path); setReport(null); await dialog.alert(t("Отчёт сохранён"), t("Приложите этот архив к вопросу в поддержку или в issue на GitHub.")); }
              catch (e) { await dialog.alert(t("Не сохранён"), errText(e)); }
            }}>{t("Сохранить .zip…")}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
