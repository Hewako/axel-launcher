// Левая половина «Ресурсов и конфигов» (макет 04): ресурспаки (порядок, совместимость), шейдеры (выбор для Iris), датапаки мира.
import { useCallback, useEffect, useState } from "react";
import { api, errText, sizeText, snapshots, type Instance, type PackInfo, type ResKind, type WorldInfo } from "../api";
import { useDialog } from "../ui/Dialog";
import { CatalogDialog } from "./ModsTab";
import type { CatalogKind } from "./Catalog";
import { t } from "../i18n";

type View = { packs: PackInfo[]; game_format?: number; shader_loader: boolean };

function PackRow({ p, children }: { p: PackInfo; children: React.ReactNode }) {
  return (
    <div className="rrow">
      {p.icon ? <img className="sicon" src={p.icon} alt="" /> : <div className="sicon" aria-hidden />}
      <div className="grow">
        <b>{p.file_name.replace(/\.zip$/i, "")}</b>
        {p.compatible === false && <span className="badge warn" style={{ marginLeft: 6 }} title={t("Сделан для формата {0}–{1}", p.formats?.[0], p.formats?.[1])}>{t("для другой версии игры")}</span>}
        <div className="muted small">{p.description || (p.is_dir ? t("папка") : "")}{p.description || p.is_dir ? " · " : ""}{sizeText(p.size)}</div>
      </div>
      <div className="ctl">{children}</div>
    </div>
  );
}

/** Переключатель в строке ресурса; действие по-прежнему называется словами для экранного диктора. */
function Switch({ on, disabled, name, onChange }: { on: boolean; disabled: boolean; name: string; onChange: () => void }) {
  return <button className={`tog ${on ? "on" : ""}`} role="switch" aria-checked={on} disabled={disabled} aria-label={`${on ? t("Выключить") : t("Включить")} ${name}`} title={on ? t("Выключить") : t("Включить")} onClick={onChange} />;
}

export function ResourcesTab({ inst, running, onCatalog }: { inst: Instance; running: boolean; onCatalog: (kind: CatalogKind, query: string) => void }) {
  const dialog = useDialog();
  const [packs, setPacks] = useState<View | null>(null);
  const [shaders, setShaders] = useState<View | null>(null);
  const [catalog, setCatalog] = useState<ResKind | null>(null);
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [world, setWorld] = useState("");
  const [datapacks, setDatapacks] = useState<View | null>(null);

  const load = useCallback(() => {
    api.resources(inst.id, "resourcepack").then(setPacks).catch(() => setPacks({ packs: [], shader_loader: false }));
    api.resources(inst.id, "shader").then(setShaders).catch(() => setShaders({ packs: [], shader_loader: false }));
  }, [inst.id]);
  useEffect(load, [load]);
  useEffect(() => {
    snapshots.worlds(inst.id).then((w) => { setWorlds(w); setWorld((cur) => cur || w[0]?.folder || ""); }).catch(() => setWorlds([]));
  }, [inst.id]);
  const loadDatapacks = useCallback(() => {
    if (!world) { setDatapacks(null); return; }
    api.resources(inst.id, "datapack", world).then(setDatapacks).catch(() => setDatapacks({ packs: [], shader_loader: false }));
  }, [inst.id, world]);
  useEffect(loadDatapacks, [loadDatapacks]);

  const act = async (f: () => Promise<unknown>) => {
    try { await f(); load(); } catch (e) { await dialog.alert(t("Не получилось"), errText(e)); }
  };
  const enabled = packs?.packs.filter((p) => p.enabled).map((p) => p.file_name) ?? [];
  const setOrder = (next: string[]) => act(() => api.setResourcePacks(inst.id, next));
  const move = (i: number, d: -1 | 1) => {
    const next = [...enabled];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setOrder(next);
  };
  const enable = async (p: PackInfo) => {
    if (p.compatible === false) {
      const ok = await dialog.confirm({
        title: t("Ресурспак для другой версии игры"),
        body: t("Он может выглядеть неправильно или не загрузиться. Включить всё равно?"),
        confirm: t("Включить"),
      });
      if (!ok) return;
    }
    setOrder([p.file_name, ...enabled]);
  };
  const remove = async (kind: ResKind, p: PackInfo) => {
    const ok = await dialog.confirm({ title: t("Убрать {0}?", p.file_name), body: t("Файл переместится в корзину Axel' (папка trash в данных лаунчера), оттуда его можно вернуть вручную."), confirm: t("Убрать"), danger: true });
    if (ok) await act(() => api.removeResource(inst.id, kind, p.file_name, kind === "datapack" ? world : undefined));
    if (ok && kind === "datapack") loadDatapacks();
  };

  return (
    <section className="card panel" aria-label={t("Ресурспаки и шейдеры")}>
      <div className="sechead">
        <div>
          <h3>{t("Ресурспаки")}</h3>
          <p className="muted small">{t("Верхний перекрывает нижние.")}{packs && packs.game_format === undefined && t(" Совместимость проверится после первого запуска этой версии игры.")}</p>
        </div>
        <button className="btn" onClick={() => onCatalog("resourcepack", "")}>{t("Найти ресурспак…")}</button>
      </div>
      {packs === null ? <p className="muted"><span className="spinner" /> {t("Загружаем…")}</p> : packs.packs.length === 0 ? (
        <p className="muted">{t("Ресурспаков нет. Найдите их в каталоге или положите .zip в папку resourcepacks.")}</p>
      ) : (
        <div className="rlist">
          {packs.packs.map((p) => {
            const i = enabled.indexOf(p.file_name);
            return (
              <PackRow key={p.file_name} p={p}>
                {p.enabled ? (
                  <>
                    <button className="btn link small" aria-label={t("Поднять {0}", p.file_name)} disabled={running || i === 0} onClick={() => move(i, -1)}>{t("↑ выше")}</button>
                    <button className="btn link small" aria-label={t("Опустить {0}", p.file_name)} disabled={running || i === enabled.length - 1} onClick={() => move(i, 1)}>{t("↓ ниже")}</button>
                  </>
                ) : <button className="btn link small" disabled={running} onClick={() => remove("resourcepack", p)}>{t("Убрать")}</button>}
                <Switch on={p.enabled} disabled={running} name={p.file_name} onChange={() => (p.enabled ? setOrder(enabled.filter((x) => x !== p.file_name)) : enable(p))} />
              </PackRow>
            );
          })}
        </div>
      )}

      <div className="sechead">
        <h3>{t("Шейдеры")}</h3>
        <button className="btn" onClick={() => onCatalog("shader", "")}>{t("Найти шейдер…")}</button>
      </div>
      {shaders && !shaders.shader_loader && (
        <div className="alert warn">
          <span>{t("Шейдеры работают только с модом Iris (Fabric, Quilt) или Oculus (NeoForge).")} {inst.loader === "vanilla" ? t("В профиле без загрузчика модов шейдеры не запустятся.") : t("Установите Iris на вкладке «Моды».")}</span>
        </div>
      )}
      {shaders === null ? <p className="muted"><span className="spinner" /> {t("Загружаем…")}</p> : shaders.packs.length === 0 ? (
        <p className="muted">{t("Шейдеров нет.")}</p>
      ) : (
        <div className="rlist">
          {shaders.packs.map((p) => (
            <PackRow key={p.file_name} p={{ ...p, description: p.enabled ? t("Сейчас включён") : "" }}>
              {!p.enabled && <button className="btn link small" disabled={running} onClick={() => remove("shader", p)}>{t("Убрать")}</button>}
              <Switch on={p.enabled} disabled={running} name={p.file_name} onChange={() => act(() => api.setShader(inst.id, p.enabled ? null : p.file_name))} />
            </PackRow>
          ))}
        </div>
      )}

      <details className="rdetails">
        <summary>{t("Датапаки мира")}{datapacks ? `: ${datapacks.packs.length}` : ""}</summary>
        <div className="row rdetails-head">
          {worlds.length > 0 && (
            <select className="field auto" aria-label={t("Мир")} value={world} onChange={(e) => setWorld(e.target.value)}>
              {worlds.map((w) => <option key={w.folder} value={w.folder}>{w.name}</option>)}
            </select>
          )}
          <button className="btn" disabled={!world} onClick={() => setCatalog("datapack")}>{t("Найти датапак…")}</button>
        </div>
        {worlds.length === 0 ? <p className="muted">{t("Датапаки ставятся в мир. Миров пока нет, сначала создайте мир в игре.")}</p>
          : datapacks === null ? <p className="muted"><span className="spinner" /> {t("Загружаем…")}</p>
          : datapacks.packs.length === 0 ? <p className="muted">{t("В этом мире датапаков нет. Новые игра включит сама при входе в мир.")}</p>
          : (
            <div className="rlist">
              {datapacks.packs.map((p) => (
                <PackRow key={p.file_name} p={p}>
                  <button className="btn link small" disabled={running} onClick={() => remove("datapack", p)}>{t("Убрать")}</button>
                </PackRow>
              ))}
            </div>
          )}
      </details>
      {catalog && <CatalogDialog inst={inst} initial="" kinds={[catalog]} world={catalog === "datapack" ? world : undefined} onClose={() => setCatalog(null)} onInstalled={catalog === "datapack" ? loadDatapacks : load} />}
    </section>
  );
}
