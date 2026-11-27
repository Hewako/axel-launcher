// Создание профиля: версия игры из манифеста Mojang → загрузчик → версия загрузчика.
// Совместимость проверяется до создания (ядро ещё раз проверит перед скачиванием).
import { useEffect, useMemo, useState } from "react";
import { api, errText, loaderName, type Instance, type LoaderKind, type LoaderVersion, type VersionEntry } from "../api";
import { t } from "../i18n";

const LOADERS: LoaderKind[] = ["vanilla", "fabric", "quilt", "forge", "neoforge"];

type Kind = "release" | "snapshot" | "old";
const kindOf = (type: string): Kind => (type === "release" ? "release" : type === "snapshot" ? "snapshot" : "old");

export function CreateInstance({ onCreated }: { onCreated: (i: Instance) => void }) {
  const [name, setName] = useState("");
  // Какие версии показывать: можно включить несколько сразу, хотя бы одна остаётся включённой.
  const [kinds, setKinds] = useState<Kind[]>(["release"]);
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
    // Список берём целиком один раз, а фильтруем по выбранным видам здесь.
    api.listVersions(true, true)
      .then((r) => {
        setVersions(r.versions);
        setOffline(r.offline);
        setLatest(r.latest_release);
        setVersion((v) => v || r.latest_release);
      })
      .catch((e) => setError(errText(e)));
  }, []);

  useEffect(() => {
    if (!version) return;
    setJava("");
    api.versionInfo(version).then((i) => setJava(t("Нужна Java {0}, Axel' скачает её сам.", i.java_major))).catch(() => setJava(""));
  }, [version]);

  useEffect(() => {
    setLoaderVersions(null);
    setLoaderVersion("");
    setError(""); // ошибка прежнего загрузчика к новому выбору не относится
    if (loader === "vanilla" || !version) return;
    // Ответ для прежнего загрузчика или версии игры может прийти позже нового — его отбрасываем.
    let current = true;
    api.loaderVersions(loader, version)
      .then((list) => {
        if (!current) return;
        setLoaderVersions(list);
        setLoaderVersion((list.find((v) => v.stable) ?? list[0])?.version ?? "");
      })
      .catch((e) => { if (current) { setLoaderVersions([]); setError(errText(e)); } });
    return () => { current = false; };
  }, [loader, version]);

  const shown = useMemo(() => (versions ?? []).filter((v) => kinds.includes(kindOf(v.type))), [versions, kinds]);
  // Если выбранная версия скрылась фильтром — берём первую из видимых.
  useEffect(() => {
    if (versions && shown.length && !shown.some((v) => v.id === version)) setVersion(shown[0].id);
  }, [shown, versions, version]);
  const toggleKind = (k: Kind) => setKinds((ks) => (ks.includes(k) ? (ks.length > 1 ? ks.filter((x) => x !== k) : ks) : [...ks, k]));

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
        <h2>{t("Создать с нуля")}</h2>
      </div>
      <form id="create-form" className="form" onSubmit={(e) => { e.preventDefault(); if (canCreate) create(); }}>
        <label className="frow">
          <span className="lbl">{t("Название")}</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Например: Технология+")} maxLength={64} required />
        </label>
        <div className="frow">
          <div className="lbl">
            {t("Версия Minecraft")}
            <span className="hint">{version && version === latest ? t("Последняя") : ""}{offline ? t(" · нет сети, список из кеша") : ""}</span>
          </div>
          <div className="stack tight">
            {versions === null ? <span className="muted small"><span className="spinner" /> {t("Загружаем список версий…")}</span> : (
              <select className="field" aria-label={t("Версии")} value={version} onChange={(e) => setVersion(e.target.value)}>
                {shown.map((v) => <option key={v.id} value={v.id}>{v.id}{kindOf(v.type) === "snapshot" ? ` · ${t("снапшот")}` : kindOf(v.type) === "old" ? ` · ${t("старая")}` : ""}</option>)}
              </select>
            )}
            {java && <span className="muted small">{java}</span>}
          </div>
        </div>
        <div className="stack tight">
          <span className="lbl" id="kinds-label">{t("Какие версии показывать")}</span>
          <div className="seg subtabs loaderseg" role="group" aria-labelledby="kinds-label">
            {([["release", t("Релизы")], ["snapshot", t("Снапшоты")], ["old", t("Старые")]] as const).map(([k, l]) => (
              <button type="button" key={k} aria-pressed={kinds.includes(k)} className={kinds.includes(k) ? "on" : ""} onClick={() => toggleKind(k)}>{l}</button>
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
              <span className="badge err">{loader === "forge" ? t("Forge в Axel' работает с Minecraft 1.17 и новее") : <>{loaderName[loader]} {t("не поддерживает Minecraft")} {version}</>}</span>
            ) : (
              <select className="field" value={loaderVersion} onChange={(e) => setLoaderVersion(e.target.value)}>
                {loaderVersions.map((v) => (
                  <option key={v.version} value={v.version}>{v.version}</option>
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
