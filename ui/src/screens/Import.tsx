// Импорт: инстансы Prism/MultiMC, .mrpack, zip CurseForge, папка официального лаунчера.
// Исходные файлы только читаются.
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, errText, importer, sizeText, type ImportResult, type Instance, type LoaderKind, type PackPreview, type SearchHit } from "../api";
import { Modal } from "../ui/Dialog";
import { Icon } from "../ui/icons";
import { t, tc } from "../i18n";

export function ImportDialog({ onDone, dragging, dropped, pack }: {
  onDone: (i: Instance) => void;
  /** Сборку выбрали на экране «Каталог»: сразу ставим её. */
  pack?: { hit: SearchHit; n: number } | null;
  /** Над окном держат файл. */
  dragging: boolean;
  /** Файл или папку бросили в окно. */
  dropped: { path: string; n: number } | null;
}) {
  const [sources, setSources] = useState<{ prism: [string, string][]; official?: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [link, setLink] = useState<{ path: string; name: string; version: string; loader: LoaderKind } | null>(null);
  // Предпросмотр модпака до установки (идея 37): картинки, моды, размер, память, необязательное.
  const [optional, setOptional] = useState<{ path: string; preview: PackPreview; off: string[]; projectId?: string; versionId?: string; title?: string; gallery?: string[] } | null>(null);
  const [packQuery, setPackQuery] = useState("");
  const [packs, setPacks] = useState<SearchHit[]>([]);
  useEffect(() => {
    if (packQuery.trim().length < 2) { setPacks([]); return; }
    const timer = setTimeout(() => importer.searchPacks(packQuery).then((r) => setPacks(r.hits.slice(0, 6))).catch(() => setPacks([])), 300);
    return () => clearTimeout(timer);
  }, [packQuery]);
  /** Сборка из каталога: скачать .mrpack, спросить про необязательные файлы, импортировать. */
  const installPack = async (h: SearchHit) => {
    setBusy(h.project_id);
    setError("");
    try {
      const v = await importer.download(h.project_id);
      const preview = await importer.preview(v.path!);
      setOptional({ path: v.path!, preview, off: [], projectId: h.project_id, versionId: v.version_id, title: h.title });
      importer.gallery(h.project_id).then((gallery) => setOptional((o) => (o && o.projectId === h.project_id ? { ...o, gallery } : o))).catch(() => {});
    } catch (e) { setError(errText(e)); } finally { setBusy(""); }
  };

  useEffect(() => { if (pack) installPack(pack.hit); }, [pack?.n]);

  useEffect(() => { importer.sources().then(setSources).catch(() => setSources({ prism: [] })); }, []);

  const run = async (key: string, f: () => Promise<ImportResult>) => {
    setBusy(key);
    setError("");
    try { setResult(await f()); } catch (e) { setError(errText(e)); } finally { setBusy(""); }
  };
  /** .mrpack — сначала предпросмотр; zip CurseForge — сразу импорт. */
  const importFile = async (path: string) => {
    const preview = path.endsWith(".mrpack") ? await importer.preview(path).catch(() => null) : null;
    if (preview) setOptional({ path, preview, off: [] });
    else await run("file", () => importer.path(path));
  };
  const pickFile = async () => {
    const path = await open({ multiple: false, directory: false, filters: [{ name: t("Модпак"), extensions: ["mrpack", "zip"] }] });
    if (typeof path === "string") await importFile(path);
  };
  useEffect(() => { if (dropped) importFile(dropped.path); }, [dropped]);
  const pickFolder = async () => {
    const path = await open({ multiple: false, directory: true });
    if (typeof path === "string") await run("folder", () => importer.path(path));
  };

  const o = optional;
  return (
    <div className="stack">
      <div className={`dropzone ${dragging ? "on" : ""}`}>
        <b>{t("Перетащите модпак сюда")}</b>
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="btn" disabled={busy !== ""} onClick={pickFile}>{busy === "file" ? t("Скачиваем моды модпака…") : t("Выбрать .mrpack или .zip CurseForge…")}</button>
          <button className="btn" disabled={busy !== ""} onClick={pickFolder}>{t("Выбрать папку инстанса…")}</button>
        </div>
      </div>
      {error && <div className="alert err"><span style={{ userSelect: "text" }}>{error}</span></div>}

      <section className="card panel" aria-label={t("Модпак из каталога Modrinth")}>
        <h2>{t("Модпак из каталога Modrinth")}</h2>
        <input className="field" type="search" aria-label={t("Найти модпак")} placeholder={t("Найти модпак…")} value={packQuery} onChange={(e) => setPackQuery(e.target.value)} />
        {packs.map((h) => (
          <div className="hit" key={h.project_id}>
            {h.icon_url ? <img src={h.icon_url} alt="" /> : <div className="noicon" />}
            <div className="grow"><b>{h.title}</b> <span className="muted small">· {h.author}</span><small>{h.description}</small></div>
            <button className="btn" disabled={busy !== ""} onClick={() => installPack(h)}>{busy === h.project_id ? t("Скачиваем…") : t("Установить")}</button>
          </div>
        ))}
      </section>

      {/* Блок показываем, только если что-то нашлось: пустой занимал полэкрана. */}
      {sources && (sources.prism.length > 0 || sources.official) && (
      <section className="card panel" aria-label={t("Нашли на этом компьютере")}>
        <h2>{t("Нашли на этом компьютере")}</h2>
          <div className="rlist">
            {sources.prism.map(([path, name]) => (
              <div className="rrow" key={path}>
                <span className="foundico"><Icon name="folder" /></span>
                <div className="grow"><b>{name}</b><div className="muted small">{t("Из Prism Launcher или MultiMC")}</div></div>
                <button className="btn" disabled={busy !== ""} onClick={() => run(path, () => importer.path(path))}>{busy === path ? t("Импортируем…") : t("Импортировать")}</button>
              </div>
            ))}
            {sources.official && (
              <div className="rrow">
                <span className="foundico"><Icon name="folder" /></span>
                <div className="grow"><b>{t("Официальный лаунчер")}</b></div>
                {!link && <button className="btn" onClick={() => setLink({ path: sources.official!, name: t("Официальный лаунчер"), version: "", loader: "vanilla" })}>{t("Подключить без копирования…")}</button>}
              </div>
            )}
          </div>
        {link && (
          <form className="form" onSubmit={(e) => { e.preventDefault(); run("link", () => importer.link(link.path, link.name, link.version, link.loader)); }}>
            <span className="muted small">{t("Сборка будет работать прямо в этой папке: миры и настройки общие с официальным лаунчером. Корзина Axel' эту папку не трогает.")}</span>
            <div className="row">
              <input className="field" style={{ flex: 2 }} value={link.name} onChange={(e) => setLink({ ...link, name: e.target.value })} aria-label={t("Название")} />
              <input className="field" style={{ flex: 1 }} placeholder={t("Версия, например 26.3")} value={link.version} onChange={(e) => setLink({ ...link, version: e.target.value.trim() })} aria-label={t("Версия")} />
              <select className="field" style={{ flex: 1 }} value={link.loader} onChange={(e) => setLink({ ...link, loader: e.target.value as LoaderKind })}>
                <option value="vanilla">Vanilla</option><option value="fabric">Fabric</option><option value="quilt">Quilt</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option>
              </select>
              <button className="btn pri" disabled={!link.version || busy !== ""}>{t("Подключить")}</button>
            </div>
          </form>
        )}
      </section>
      )}

      {o && (() => {
        const p = o.preview;
        const short = p.free != null && p.free < p.size + 200 * 1024 * 1024;
        return (
          <Modal title={o.title ?? p.name} onClose={() => setOptional(null)} wide>
            {o.gallery && o.gallery.length > 0 && (
              <div className="packgallery" aria-label={t("Картинки модпака")}>
                {o.gallery.map((u) => <img key={u} src={u} alt="" loading="lazy" />)}
              </div>
            )}
            <dl className="kv packfacts">
              <dt>{t("Версия")}</dt><dd>{[p.version, `Minecraft ${p.game}`, p.loader].filter(Boolean).join(", ")}</dd>
              <dt>{t("Моды")}</dt><dd>{p.mods.length}</dd>
              <dt>{t("Скачается")}</dt>
              <dd className={short ? "err" : ""}>{sizeText(p.size)}{p.free != null ? `, ${t("свободно {0}", sizeText(p.free))}` : ""}{short ? ` · ${t("места не хватит")}` : ""}</dd>
              <dt>{t("Память")}</dt><dd>{p.memory_set ? t("{0} ГБ, выставится сама", Math.round(p.memory_set / 512) / 2) : t("советуем {0} ГБ", p.memory_mb / 1024)}</dd>
            </dl>
            {p.mods.length > 0 && (
              <details className="packmods">
                <summary>{t("Список модов ({0})", p.mods.length)}</summary>
                <ul>{p.mods.map((m) => <li key={m}>{m}</li>)}</ul>
              </details>
            )}
            {p.optional.length > 0 && <>
              <h3 className="subhead">{t("Необязательные компоненты")}</h3>
              <p className="small muted" style={{ marginTop: 0 }}>{t("Автор модпака сделал эти файлы необязательными. Снимите галочки с тех, что не нужны.")}</p>
              {p.optional.map((f) => (
                <label key={f} className="row small">
                  <input type="checkbox" checked={!o.off.includes(f)} onChange={(e) => setOptional({ ...o, off: e.target.checked ? o.off.filter((x) => x !== f) : [...o.off, f] })} />
                  <span className="mono">{f.split("/").pop()}</span>
                </label>
              ))}
            </>}
            <div className="acts">
              <button className="btn" onClick={() => setOptional(null)}>{t("Отмена")}</button>
              <button className="btn pri" disabled={busy !== "" || short} onClick={async () => { setOptional(null); await run("file", () => importer.path(o.path, o.off, o.projectId, o.versionId)); }}>{t("Установить")}</button>
            </div>
          </Modal>
        );
      })()}
      {result && (
        <Modal title={t("Импорт завершён")} onClose={() => onDone(result.instance)}>
          <p style={{ margin: 0 }}>{t("Сборка «")}{result.instance.name}» — Minecraft {result.instance.game_version} · {result.instance.loader}.</p>
          {result.notes.map((n, i) => <span key={i} className="muted small">• {tc(n)}</span>)}
          {result.manual.length > 0 && (
            <div className="alert warn">
              <div className="h">{t("Скачайте вручную:")} {result.manual.length}</div>
              <span className="small">{t("CurseForge разрешает скачивать эти моды только через свой сайт. Скачайте файлы и положите их в папку mods сборки, а Mod Doctor проверит, всё ли на месте.")}</span>
              <div style={{ maxHeight: 160, overflow: "auto" }} className="small mono">
                {result.manual.map((m) => <div key={m.file_id}>{t("проект")} {m.project_id}{t(", файл")} {m.file_id}</div>)}
              </div>
              <div className="acts"><button className="btn" onClick={() => api.openFolder(result.instance.id, "mods")}>{t("Открыть папку mods")}</button></div>
            </div>
          )}
          <div className="acts"><button className="btn pri" data-autofocus onClick={() => onDone(result.instance)}>{t("Открыть сборку")}</button></div>
        </Modal>
      )}
    </div>
  );
}
