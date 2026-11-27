// Перевод интерфейса. Исходные строки — русские; t() ищет их перевод в словаре языка.
// Язык читается при запуске (кеш в localStorage, источник — настройки лаунчера); при смене
// языка окно перерисовывается и возвращается на тот же экран: так строки в константах
// модулей тоже переводятся.
import { EN } from "./i18n.en";
import { CORE_EN } from "./i18n.core.en";
import { coreTranslator } from "./i18n.core";

const KEY = "axel.lang";
/** Ключ до переименования лаунчера (Quarry): читаем, если нового ещё нет. */
const OLD_KEY = "quarry.lang";

function initial(): string {
  try { return (localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY)) ?? "ru"; } catch { return "ru"; }
}

let lang = initial();

export const currentLang = () => lang;

const RESUME = "axel.resume";

/** Сменить язык: запомнить и перерисовать окно (идея 65). `resume` — где был игрок: после
 *  перерисовки окно откроется там же, а не на главном экране. */
export function switchLang(next: string, resume?: Record<string, string | undefined>) {
  if (next === lang) return;
  try {
    localStorage.setItem(KEY, next);
    if (resume) sessionStorage.setItem(RESUME, JSON.stringify(resume));
  } catch { /* не страшно: откроется главный экран */ }
  location.reload();
}

/** Куда вернуться после смены языка (читается один раз). */
export function takeResume(): Record<string, string | undefined> | null {
  try {
    const v = sessionStorage.getItem(RESUME);
    sessionStorage.removeItem(RESUME);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

/** Синхронизация с настройками лаунчера (если кеш пуст или устарел). */
export function syncLang(fromSettings: string) {
  if (fromSettings && fromSettings !== lang) switchLang(fromSettings);
}

/** Перевести строку. `{0}`, `{1}` … заменяются аргументами. Нет перевода — русский текст. */
export function t(ru: string, ...args: unknown[]): string {
  const s = lang === "en" ? EN[ru] ?? ru : ru;
  return args.length ? s.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? "")) : s;
}

const core = lang === "en" ? coreTranslator({ ...EN, ...CORE_EN }) : (s: string) => s;

/** Русский исходник с подстановками — для того, что хранится (уведомления) и переводится при показе через tc(). */
export function src(ru: string, ...args: unknown[]): string {
  return args.length ? ru.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? "")) : ru;
}

/** Перевести сообщение ядра или сохранённый исходник: ошибку, предупреждение, находку Mod Doctor, уведомление. */
export function tc(ru: string): string;
export function tc(ru: string | undefined): string | undefined;
export function tc(ru?: string) {
  return ru && core(ru);
}
