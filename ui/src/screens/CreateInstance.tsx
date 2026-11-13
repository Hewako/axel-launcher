// Создание профиля: версия игры из манифеста Mojang → загрузчик → версия загрузчика.
// Совместимость проверяется до создания (ядро ещё раз проверит перед скачиванием).
import { useEffect, useMemo, useState } from "react";
import { api, errText, loaderName, type Instance, type LoaderKind, type LoaderVersion, type VersionEntry } from "../api";
import { t } from "../i18n";

// Forge — после v1.0 (план, Приложение А), поэтому в выборе его нет.
const LOADERS: LoaderKind[] = ["vanilla", "fabric", "quilt", "neoforge"];

export function CreateInstance({ onCreated }: { onCreated: (i: Instance) => void }) {
  const [name, setName] = useState("");
  // Какие версии показывать (макет 09): релизы всегда, плюс снапшоты или старые alpha/beta.
  const [kinds, setKinds] = useState<"release" | "snapshot" | "old">("release");
  const [query, setQuery] = useState("");
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  const [latest, setLatest] = useState("");
  const [offline, setOffline] = useState(false);
  const [version, setVersion] = useState<string>("");
  const [java, setJava] = useState<string>("");
  const [loader, setLoader] = useState<LoaderKind>("vanilla");
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[] | null>(null);
  const [loaderVersion, setLoaderVersion] = useState<string>("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setVersions(null);
    api.listVersions(kinds === "snapshot", kinds === "old")
      .then((r) => {
        setVersions(r.versions);
        setOffline(r.offline);
        setLatest(r.latest_release);
        setVersion((v) => v || r.latest_release);
      })
      .catch((e) => setError(errText(e)));
  }, [kinds]);

  useEffect(() => {
    if (!version) return;
    setJava("");
    api.versionInfo(version).then((i) => setJava(t("нужна Java {0} ({1})", i.java_major, i.java_reason))).catch(() => setJava(""));
  }, [version]);

  useEffect(() => {
    setLoaderVersions(null);
    setLoaderVersion("");
    if (loader === "vanilla" || !version) return;
    api.loaderVersions(loader, version)
      .then((list) => {
        setLoaderVersions(list);
        setLoaderVersion((list.find((v) => v.stable) ?? list[0])?.version ?? "");
      })
      .catch((e) => { setLoaderVersions([]); setError(errText(e)); });
  }, [loader, version]);

  // Выбранная версия остаётся в списке, даже если поиск её отфильтровал.
  const shown = useMemo(
    () => (versions ?? []).filter((v) => v.id === version || v.id.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 300),
    [versions, query, version],
  );

  const incompatible = loader !== "vanilla" && loaderVersions !== null && loaderVersions.length === 0;
  const canCreate = name.trim() && version && !busy && !incompatible && (loader === "vanilla" || !!loaderVersion);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      onCreated(await api.createInstance(name.trim(), version, loader, loader === "vanilla" ? undefined : loaderVersion));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card panel" aria-label={t("Создать с нуля")}>
      <div>
        <h3>{t("Создать с нуля")}</h3>
        <p className="muted small">{t("Готово за полминуты. Настройки подберём сами.")}</p>
      </div>
      <form id="create-form" className="form" onSubmit={(e) => { e.preventDefault(); if (canCreate) create(); }}>
        <label className="frow">
          <span className="lbl">{t("Название")}</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Например: Технология+")} maxLength={64} required />
        </label>
        <div className="frow">
          <div className="lbl">
            {t("Версия Minecraft")}
            <span className="hint">{version && version === latest ? t("Последняя стабильная") : ""}{offline ? t(" · нет сети, список из кеша") : ""}</span>
          </div>
          <div className="stack tight">
            {versions === null ? <span className="muted small"><span className="spinner" /> {t("Загружаем список версий…")}</span> : (
              <select className="field" aria-label={t("Версии")} value={version} onChange={(e) => setVersion(e.target.value)}>
                {shown.map((v) => <option key={v.id} value={v.id}>{v.id}{v.type !== "release" ? ` · ${v.type}` : ""} · {v.releaseTime.slice(0, 10)}</option>)}
              </select>
            )}
            <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Найти версию…")} aria-label={t("Поиск версии")} />
            {java && <span className="muted small">{version}: {java}</span>}
          </div>
        </div>
        <div className="stack tight">
          <span className="lbl" id="kinds-label">{t("Какие версии показывать")}</span>
          <div className="seg subtabs loaderseg" role="radiogroup" aria-labelledby="kinds-label">
            {([["release", t("Релизы")], ["snapshot", t("Снапшоты")], ["old", t("Старые")]] as const).map(([k, l]) => (
              <button type="button" key={k} role="radio" aria-checked={kinds === k} className={kinds === k ? "on" : ""} onClick={() => setKinds(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="stack tight">
          <span className="lbl" id="loader-label">{t("Загрузчик")}</span>
          <div className="seg subtabs loaderseg" role="radiogroup" aria-labelledby="loader-label">
            {LOADERS.map((l) => (
              <button type="button" key={l} role="radio" aria-checked={loader === l} className={loader === l ? "on" : ""} onClick={() => setLoader(l)}>{l === "vanilla" ? t("Без модов") : loaderName[l]}</button>
            ))}
          </div>
        </div>
        {loader !== "vanilla" && (
          <label className="frow">
            <span className="lbl">{t("Версия")} {loaderName[loader]}</span>
            {loaderVersions === null ? (
              <span className="muted small"><span className="spinner" /> {t("Проверяем совместимость…")}</span>
            ) : incompatible ? (
              <span className="badge err">{loaderName[loader]} {t("не поддерживает Minecraft")} {version}</span>
            ) : (
              <select className="field" value={loaderVersion} onChange={(e) => setLoaderVersion(e.target.value)}>
                {loaderVersions.map((v) => (
                  <option key={v.version} value={v.version}>{v.version}{v.stable ? t(" · стабильная") : t(" · нестабильная")}</option>
                ))}
              </select>
            )}
          </label>
        )}
        {busy && <p className="muted small" role="status"><span className="spinner" /> {t("Создаём…")}</p>}
        {error && <div className="alert err"><span>{error}</span></div>}
      </form>
    </section>
  );
}
