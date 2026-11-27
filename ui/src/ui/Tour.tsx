// Знакомство при первом запуске (идея 35): 5 подсказок поверх настоящих элементов окна.
// Подсказка, чьего элемента сейчас нет на экране (например, сборок ещё нет), пропускается.
// Пройденный тур запоминается в этом окне; «Пропустить» и Esc закрывают его сразу.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { MOD } from "../keys";

const KEY = "axel.tourDone";

export function tourDone(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
function markDone() {
  try { localStorage.setItem(KEY, "1"); } catch { /* без хранилища тур покажется ещё раз — не страшно */ }
}

type Step = { at: string; title: string; text: string };

const STEPS = (): Step[] => [
  { at: "builds", title: t("Сборки"), text: t("Здесь все ваши сборки. В этом же разделе миры, корзина и история изменений.") },
  { at: "catalog", title: t("Каталог"), text: t("Моды, модпаки, шейдеры и ресурспаки с Modrinth и CurseForge.") },
  { at: "switch", title: t("Быстрый переход"), text: t("Нажмите на название, чтобы открыть другую сборку. Из любого места: {0} K.", MOD) },
  { at: "play", title: t("Играть"), text: t("Запуск игры. {0} Enter делает то же самое.", MOD) },
  { at: "account", title: t("Аккаунт"), text: t("Вход через Microsoft или Ely.by и скины.") },
];

const target = (at: string) => {
  const el = document.querySelector<HTMLElement>(`[data-tour="${at}"]`);
  return el && el.getClientRects().length ? el : null;
};

export function Tour({ onClose }: { onClose: () => void }) {
  // Шаги выбираются, когда окно уже отрисовано: сразу после запуска сборки ещё грузятся.
  const [steps, setSteps] = useState<Step[] | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setSteps(STEPS().filter((s) => target(s.at))), 600);
    return () => clearTimeout(id);
  }, []);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const next = useRef<HTMLButtonElement>(null);
  const step = steps?.[i];
  const finish = () => { markDone(); onClose(); };

  useLayoutEffect(() => {
    if (!step) return;
    const place = () => setRect(target(step.at)?.getBoundingClientRect() ?? null);
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [step]);
  const shown = !!rect;
  useEffect(() => { next.current?.focus(); }, [i, shown]);
  // Показывать нечего — закрыть, но не запоминать: тур покажется в следующий раз.
  useEffect(() => { if (steps && steps.length === 0) onClose(); }, [steps, onClose]);

  if (!steps || !step || !rect) return null;
  const last = i === steps.length - 1;
  // Элементы рельсы — подсказка справа от них, остальное — под элементом, не выходя за окно.
  const W = 300;
  const inRail = rect.right < 90;
  const leftHalf = rect.left + rect.width / 2 < window.innerWidth / 2;
  const clampX = (x: number) => Math.min(Math.max(8, x), window.innerWidth - W - 8);
  const style = inRail
    ? { left: rect.right + 14, top: Math.min(Math.max(8, rect.top - 6), window.innerHeight - 190) }
    : { left: clampX(leftHalf ? rect.left : rect.right - W), top: rect.bottom + 12 };
  return (
    <div className="tour" onKeyDown={(e) => {
      if (e.key === "Escape") { e.stopPropagation(); finish(); }
      else if (e.key === "Tab") {
        // Фокус не уходит из подсказки, пока она открыта.
        const b = [...e.currentTarget.querySelectorAll<HTMLElement>(".tour-card button")];
        const k = b.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        b[(k + (e.shiftKey ? b.length - 1 : 1)) % b.length]?.focus();
      }
      else if (e.key === "ArrowRight" && !last) setI(i + 1);
      else if (e.key === "ArrowLeft" && i > 0) setI(i - 1);
    }}>
      <div className="tour-ring" aria-hidden style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />
      <div className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text" style={{ ...style, width: W }}>
        <div className="muted small">{t("{0} из {1}", i + 1, steps.length)}</div>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-text">{step.text}</p>
        <div className="tour-acts">
          <button className="btn link" onClick={finish}>{t("Пропустить")}</button>
          <span style={{ flex: 1 }} />
          {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>{t("Назад")}</button>}
          <button ref={next} className="btn pri" onClick={() => (last ? finish() : setI(i + 1))}>{last ? t("Готово") : t("Дальше")}</button>
        </div>
      </div>
    </div>
  );
}
