// Быстрый переход к сборке: окно со списком и поиском. Открывается нажатием на название сборки в
// шапке и клавишами ⌘/Ctrl K; ⌘/Ctrl 1–9 сразу открывают первые девять сборок этого списка.
import { useMemo, useState } from "react";
import { loaderName, type Instance } from "../api";
import { t } from "../i18n";
import { MOD } from "../keys";
import { ProfileIcon } from "./common";
import { Modal } from "./Dialog";

/** Порядок сборок для перехода: избранные, потом по последнему запуску; архивные не показываются. */
export function buildOrder(instances: Instance[]): Instance[] {
  return instances
    .filter((i) => !i.archived)
    .sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || (b.last_launch?.at ?? 0) - (a.last_launch?.at ?? 0));
}

export function BuildPicker({ instances, current, onPick, onClose }: {
  instances: Instance[];
  current?: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const all = useMemo(() => buildOrder(instances), [instances]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? all.filter((i) => i.name.toLowerCase().includes(s) || i.game_version.includes(s)) : all;
  }, [all, q]);
  const pick = (i?: Instance) => { if (i) { onPick(i.id); onClose(); } };
  const optId = (i: number) => `buildpick-${i}`;
  return (
    <Modal title={t("Перейти к сборке")} onClose={onClose}>
      <input className="field" type="search" data-autofocus placeholder={t("Название или версия")} aria-label={t("Найти сборку")}
        role="combobox" aria-expanded aria-controls="buildpick-list" aria-activedescendant={shown.length ? optId(active) : undefined}
        value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(shown[active]); }
        }} />
      <ul className="buildpick" id="buildpick-list" role="listbox" aria-label={t("Сборки")}>
        {shown.length === 0 && <li className="muted">{t("Ничего не нашлось.")}</li>}
        {shown.map((i, n) => {
          const hotkey = all.indexOf(i);
          return (
            <li key={i.id} id={optId(n)} role="option" aria-selected={n === active} className={`${n === active ? "on" : ""} ${i.id === current ? "cur" : ""}`}
              onMouseEnter={() => setActive(n)} onClick={() => pick(i)}>
              <ProfileIcon id={i.id} name={i.name} color={i.color} size={28} />
              <span className="grow"><b>{i.name}</b><small className="muted">{i.game_version}, {i.loader === "vanilla" ? t("без модов") : loaderName[i.loader]}{i.id === current ? ` · ${t("открыта сейчас")}` : ""}</small></span>
              {hotkey < 9 && <kbd>{MOD} {hotkey + 1}</kbd>}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
