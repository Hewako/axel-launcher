// Вкладка «Откат» (макет 03): снимки с метками и сравнением, журнал изменений модов; справа миры и их бэкапы.
import { Fragment, useCallback, useEffect, useState } from "react";
import { HistoryMap } from "../ui/HistoryMap";
import { pressable } from "../ui/common";
import { errText, relTime, sizeText, snapshots, type Instance, type JournalEntry, type SnapshotDiff, type SnapshotInfo, type WorldBackup, type WorldInfo, type ForeignWorld } from "../api";
import { useDialog } from "../ui/Dialog";
import { Icon } from "../ui/icons";
import { t, tc } from "../i18n";

const isMod = (p: string) => p.startsWith("mods/");
const fileOf = (p: string) => p.replace(/^(mods|config)\//, "");

/** Строки «метка — файл» для одного раздела сравнения. */
function DiffRows({ d, keep }: { d: SnapshotDiff; keep: (p: string) => boolean }) {
  const rows: [string, string, string][] = [
    ...d.changed.filter(keep).map((p) => ["info", t("изменён"), p] as [string, string, string]),
    ...d.added.filter(keep).map((p) => ["ok", t("добавлен"), p] as [string, string, string]),
    ...d.removed.filter(keep).map((p) => ["err", t("удалён"), p] as [string, string, string]),
  ];
  if (!rows.length) return <p className="muted small">{t("Без изменений.")}</p>;
  return (
    <ul className="changes">
      {rows.map(([cls, label, p]) => (
        <li key={p}><span className={`tag ${cls}`}>{label}</span><span className="grow mono">{fileOf(p)}</span>
          <span className="muted small">{cls === "ok" ? t("нет в снимке") : cls === "err" ? t("есть только в снимке") : t("отличается от снимка")}</span></li>
      ))}
    </ul>
  );
}

/** Макет 11: что в снимке и что сейчас. В снимок входят mods/, config/, options.txt (pack.lock сравнение не показывает). */
function Compare({ s, d, when, running, busy, onBack, onRestore, onPin }: {
  s: SnapshotInfo; d: SnapshotDiff; when: string; running: boolean; busy: boolean; onBack: () => void; onRestore: () => void; onPin: () => void;
}) {
  const modCount = [...d.added, ...d.removed, ...d.changed].filter(isMod).length;
  const cfgCount = [...d.added, ...d.removed, ...d.changed].filter((p) => !isMod(p)).length;
  return (
    <div className="ov">
      <section className="card">
        <button className="btn link small back" onClick={onBack}><Icon name="chevron" size={14} /> {t("Все снимки")}</button>
        <h3>{t("Снимок {0} и сборка сейчас", when)}</h3>
        <p className="muted small">{tc(s.reason)}. {t("Что изменилось в сборке после этого снимка.")}</p>
        <h4 className="subhead">{t("Моды")} <span className="muted">{t("отличий: {0}", modCount)}</span></h4>
        <DiffRows d={d} keep={isMod} />
        <h4 className="subhead">{t("Конфиги")} <span className="muted">{t("отличий: {0}", cfgCount)}</span></h4>
        <DiffRows d={d} keep={(p) => !isMod(p)} />
        <h4 className="subhead">options.txt</h4>
        {d.options.length === 0 ? <p className="muted small">{t("Без изменений.")}</p> : (
          <div className="diff">{d.options.map(([k, a, b]) => <span key={k}><span className="del">− {k}: {a || "—"}</span><br /><span className="add">+ {k}: {b}</span></span>)}</div>
        )}
      </section>
      <div className="stack">
        <section className="card">
          <h3>{t("Вернуть к {0}", when)}</h3>
          <ul className="facts">
            <li>{t("Сначала сохраним новый снимок, потом вернём старый, так что откат можно отменить.")}</li>
            <li>{t("Миры не затрагиваются.")}</li>
          </ul>
          <div className="acts">
            <button className="btn pri" disabled={running || busy} onClick={onRestore}>{busy ? t("Откатываем…") : t("Откатить к этому снимку")}</button>
            <button className="btn" onClick={onBack}>{t("Назад")}</button>
          </div>
        </section>
        <section className="card">
          <h3>{s.pinned ? t("Снимок закреплён") : t("Закрепить этот снимок")}</h3>
          <p className="muted small">{t("Закреплённый снимок не удаляется при очистке старых.")}</p>
          <button className="btn" onClick={onPin}>{s.pinned ? t("Открепить") : t("Закрепить")}</button>
        </section>
      </div>
    </div>
  );
}

export function SnapshotsTab({ inst, running, journal, onRestored, onOpenBuild }: { inst: Instance; running: boolean; journal: JournalEntry[]; onRestored: () => void; onOpenBuild: (i: Instance) => void }) {
  const dialog = useDialog();
  const [list, setList] = useState<SnapshotInfo[] | null>(null);
  const [diffs, setDiffs] = useState<Record<string, SnapshotDiff>>({});
  // Открытое сравнение (макет 11) и снимок, о котором рассказывает правая карточка.
  const [comparing, setComparing] = useState("");
  const [picked, setPicked] = useState("");
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [foreign, setForeign] = useState<ForeignWorld[]>([]);
  const [open, setOpen] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    snapshots.list(inst.id).then(setList).catch(() => setList([]));
    snapshots.worlds(inst.id).then(setWorlds).catch(() => setWorlds([]));
    snapshots.foreignWorlds(inst.id).then(setForeign).catch(() => setForeign([]));
  }, [inst.id]);
  useEffect(load, [load]);

  const act = async (key: string, f: () => Promise<unknown>, fail: string) => {
    setBusy(key);
    try { await f(); load(); } catch (e) { await dialog.alert(fail, errText(e)); } finally { setBusy(""); }
  };
  /** Перенести мир другой сборки сюда: с предупреждением о модах и версии, бэкап — сразу. */
  const adopt = async (f: ForeignWorld) => {
    const from = f.owner_name ? t("из сборки «{0}»", f.owner_name) : t("из удалённой сборки");
    const notes = [
      f.older && t("Мир из версии {0}. Игра обновит его до {1}, и открыть его в старой версии потом не получится.", f.world.version_name ?? "?", inst.game_version),
      f.owner_loader && f.owner_loader !== "Vanilla" && t("В той сборке были моды ({0}). Если здесь их нет, блоки и предметы модов из мира пропадут.", f.owner_loader),
      t("Сразу после переноса Axel' сделает бэкап мира, вернуть его можно в любой момент."),
    ].filter(Boolean) as string[];
    const ok = await dialog.confirm({
      title: t("Перенести «{0}» {1}?", f.world.name, from),
      body: <>{notes.map((n, i) => <p key={i} style={{ margin: "0 0 8px" }}>{n}</p>)}</>,
      confirm: f.older ? t("Бэкап и перенести") : t("Перенести сюда"),
    });
    if (ok) await act(`a${f.owner_id}/${f.world.folder}`, () => snapshots.adoptWorld(inst.id, f.owner_id, f.world.folder), t("Мир не перенесён"));
  };
  const restore = async (s: SnapshotInfo) => {
    const ok = await dialog.confirm({
      title: t("Откатить к «{0}»?", tc(s.reason)),
      body: t("Моды, настройки модов и options.txt вернутся к состоянию снимка. Текущее состояние сначала сохранится отдельным снимком, так что откат тоже можно отменить. Миры не затрагиваются."),
      confirm: t("Откатить"),
    });
    if (ok) await act(s.id, async () => { await snapshots.restore(inst.id, s.id); setDiffs({}); setComparing(""); onRestored(); }, t("Откат не удался"));
  };
  const restoreWorld = async (w: WorldInfo, b: WorldBackup) => {
    const ok = await dialog.confirm({
      title: t("Вернуть «{0}» к бэкапу?", w.name),
      body: t("Мир вернётся к состоянию на {0}. Текущий мир не удаляется: сначала он сам сохранится в бэкап и отложится в папку .axel-replaced внутри папки игры.", new Date(b.created_at * 1000).toLocaleString()),
      confirm: t("Восстановить"),
    });
    if (ok) await act(`r${b.file}`, async () => {
      await snapshots.restoreWorld(inst.id, b.file);
      await dialog.alert(t("Мир восстановлен"), t("«{0}» снова в состоянии бэкапа.", w.name));
    }, t("Мир не восстановлен"));
  };

  // «Последний рабочий» — состояние на последнем удачном запуске: первый снимок, сделанный после него.
  const ok = inst.last_launch?.outcome === "success" ? inst.last_launch.at : undefined;
  const working = ok === undefined ? undefined : [...(list ?? [])].filter((s) => s.created_at >= ok).sort((a, b) => a.created_at - b.created_at)[0]?.id;
  const when = (at: number) => new Date(at * 1000).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const diffOf = useCallback((id: string) => {
    if (diffs[id]) return Promise.resolve(diffs[id]);
    return snapshots.diff(inst.id, id).then((d) => { setDiffs((m) => ({ ...m, [id]: d })); return d; });
  }, [diffs, inst.id]);
  const focus = (list ?? []).find((s) => s.id === picked) ?? (list ?? []).find((s) => s.id === working) ?? list?.[0];
  useEffect(() => { if (focus) diffOf(focus.id).catch(() => {}); }, [focus?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const cmp = (list ?? []).find((s) => s.id === comparing);
  if (cmp && diffs[cmp.id]) {
    return <Compare s={cmp} d={diffs[cmp.id]} when={when(cmp.created_at)} running={running} busy={busy === cmp.id} onBack={() => setComparing("")}
      onRestore={() => restore(cmp)} onPin={() => act(`pin${cmp.id}`, () => snapshots.pin(inst.id, cmp.id, !cmp.pinned), t("Не получилось"))} />;
  }
  const fd = focus ? diffs[focus.id] : undefined;

  return (
    <div className="ov">
      <div className="stack">
        <div className="pagehead">
          <p className="muted small" style={{ margin: 0, maxWidth: 560 }}>
            {t("Снимок создаётся сам перед установкой, обновлением и удалением модов, а также перед откатом. Хранятся 10 последних автоматических, ручные и закреплённые. В снимок входят моды, настройки модов и options.txt; миры защищают отдельные бэкапы ниже.")}
          </p>
          <button className="btn" disabled={running || busy !== ""} onClick={() => act("new", () => snapshots.create(inst.id, t("Создан вручную")), t("Снимок не создан"))}>{t("+ Создать снимок")}</button>
        </div>
        <section className="card" style={{ padding: 0 }}>
          {list === null ? <p className="muted pad"><span className="spinner" /> {t("Загружаем…")}</p> : list.length === 0 ? (
            <p className="muted pad">{t("Снимков пока нет. Первый появится сам перед первым изменением модов.")}</p>
          ) : (
            <ul className="snaps">
              {list.map((s) => (
                <li key={s.id} className={focus?.id === s.id ? "on" : ""} aria-current={focus?.id === s.id ? "true" : undefined} {...pressable(() => setPicked(s.id))}>
                  <span className="when muted">{when(s.created_at)}</span>
                  <div className="what">
                    <b>{tc(s.reason)}</b>
                    {s.id === working && <span className="tag ok">{t("последний рабочий")}</span>}
                    {s.auto && <span className="tag">{t("автоматически")}</span>}
                    {s.pinned && <span className="tag warn" title={t("● закреплён, ротация его не удалит")}>{t("закреплён")}</span>}
                    <div className="muted small">
                      {s.id === working ? t("С ним игра запускалась {0}", relTime(ok!)) : s.auto ? `${relTime(s.created_at)}` : t("Создан вручную")}
                      {" "}{t("· модов")} {s.mods}{t(", конфигов")} {s.configs}
                    </div>
                  </div>
                  <div className="acts">
                    <button className="btn" onClick={(e) => { e.stopPropagation(); diffOf(s.id).then(() => setComparing(s.id)).catch((er) => dialog.alert(t("Не удалось сравнить"), errText(er))); }}>{t("Сравнить с текущим")}</button>
                    <button className={`btn ${s.id === working ? "pri" : ""}`} disabled={running || busy !== ""} onClick={() => restore(s)}>{busy === s.id ? t("Откатываем…") : t("Откатить к этому снимку")}</button>
                    <button className="btn link small" onClick={() => act(`pin${s.id}`, () => snapshots.pin(inst.id, s.id, !s.pinned), t("Не получилось"))}>{s.pinned ? t("Открепить") : t("Закрепить")}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        {journal.length > 0 && (
          <details className="card">
            <summary>{t("Журнал изменений (")}{journal.length})</summary>
            <ul className="changes">
              {[...journal].sort((a, b) => b.at - a.at).map((j, i) => (
                <li key={i}>
                  <span className="when muted small">{when(j.at)}</span>
                  <span className="grow"><b>{tc(j.action)}</b> {j.what} <span className="muted">— {tc(j.reason)}</span></span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="stack">
      {focus && (
        <section className="card">
          <h3>{t("Если вернуть снимок {0}", when(focus.created_at))}</h3>
          <ul className="facts">
            <li>{t("Вернутся моды, настройки модов и options.txt.")}</li>
            {fd && <li>{fd.added.length + fd.removed.length + fd.changed.length + fd.options.length === 0 ? t("Сборка сейчас такая же, как в снимке.")
              : t("Сейчас отличается: модов {0}, конфигов {1}, настроек игры {2}.", [...fd.added, ...fd.removed, ...fd.changed].filter(isMod).length, [...fd.added, ...fd.removed, ...fd.changed].filter((p) => !isMod(p)).length, fd.options.length)}</li>}
            <li>{t("Перед возвратом Axel' сам сделает новый снимок, так что откат можно отменить.")}</li>
            <li>{t("Миры не затрагиваются: их бэкапы ниже.")}</li>
          </ul>
          <button className="btn link" onClick={() => setComparing(focus.id)} disabled={!fd}>{t("Подробнее: сравнить")}</button>
        </section>
      )}
      <section className="card">
        <h3>{t("История сборки")}</h3>
        <HistoryMap id={inst.id} alive onRestored={onOpenBuild} />
      </section>
      <section className="card">
        <h3>{t("Миры и их бэкапы")}</h3>
        <p className="muted small" style={{ margin: "0 0 10px" }}>
          {t("Axel' сам делает бэкап последнего мира, если моды менялись после прошлой игры, и перед удалением мода, который добавляет блоки или измерения. Хранятся 5 последних бэкапов каждого мира.")}
        </p>
        {worlds.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t("Миров в сборке пока нет.")}</p> : (
          <div className="worlds">
            {worlds.map((w) => (
              <Fragment key={w.folder}>
                <div className="world">
                  <div className="grow">
                    <b>{w.name}</b>{w.hardcore && <span className="badge err" style={{ marginLeft: 6 }}>{t("хардкор")}</span>}
                    <div className="muted small">
                      {w.version_name ?? t("версия неизвестна")} · {tc(w.game_mode)} · {sizeText(w.size)}{w.last_played ? t(" · играли {0}", relTime(w.last_played)) : ""}
                      {w.folder !== w.name && <> {t("· папка")} <span className="mono">{w.folder}</span></>}
                    </div>
                  </div>
                  <div className="acts">
                    {w.backups.length > 0 && (
                      <button className="btn link small" aria-expanded={open === w.folder} onClick={() => setOpen(open === w.folder ? "" : w.folder)}>
                        {t("Бэкапы (")}{w.backups.length})
                      </button>
                    )}
                    <button className="btn" disabled={running || busy !== ""} onClick={() => act(`w${w.folder}`, async () => {
                      const b = await snapshots.backupWorld(inst.id, w.folder);
                      await dialog.alert(t("Бэкап готов"), `${w.name}: ${sizeText(b.size)}.`);
                    }, t("Бэкап не создан"))}>{busy === `w${w.folder}` ? t("Сохраняем…") : t("Сделать бэкап")}</button>
                  </div>
                </div>
                {open === w.folder && w.backups.map((b) => (
                  <div className="world sub" key={b.file}>
                    <div className="grow"><b>{when(b.created_at)}</b><div className="muted small">{sizeText(b.size)} · {relTime(b.created_at)}</div></div>
                    <button className="btn" disabled={running || busy !== ""} onClick={() => restoreWorld(w, b)}>{busy === `r${b.file}` ? t("Восстанавливаем…") : t("Восстановить")}</button>
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        )}
        {foreign.length > 0 && (
          <>
            <h4 className="subhead">{t("Миры из других сборок")}</h4>
            <div className="worlds">
              {foreign.map((f) => (
                <div className="world" key={`${f.owner_id}/${f.world.folder}`}>
                  <div className="grow">
                    <b>{f.world.name}</b>
                    <div className="muted small">
                      {f.world.version_name ?? t("версия неизвестна")} · {sizeText(f.world.size)} · {f.owner_name ? t("сборка «{0}»", f.owner_name) : t("сборка удалена")}
                    </div>
                  </div>
                  <div className="acts">
                    <button className="btn" disabled={running || busy !== ""} onClick={() => adopt(f)}>
                      {busy === `a${f.owner_id}/${f.world.folder}` ? t("Переносим…") : f.older ? t("Бэкап и перенести") : t("Перенести сюда")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
      </div>
    </div>
  );
}
