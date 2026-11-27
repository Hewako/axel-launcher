import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { DataDirButton } from "../ui/DataDirButton";
import { api, diagnostics, errText, sizeText, type AppInfo, type GlobalSettings, type LauncherRelease } from "../api";
import { useDialog } from "../ui/Dialog";
import { path, setStreamer } from "../streamer";
import { switchLang, t, tc } from "../i18n";
import { UpdateNotice } from "../ui/UpdateNotice";
import { isMod } from "../keys";

type Section = "general" | "look" | "game" | "data" | "privacy" | "about";
const ACCENTS: [string, string][] = [["#3fb950", t("Зелёный")], ["#2563eb", t("Синий")], ["#7c3aed", t("Фиолетовый")], ["#d0703a", t("Оранжевый")], ["#c2415d", t("Малиновый")], ["#2a9d8f", t("Бирюзовый")]];

// Строка поиска по настройкам (в нижнем регистре); пусто — поиска нет.
const Query = createContext("");

/** Одна настройка: название, подсказка, поле и «Сбросить», когда значение не по умолчанию. */
function Row({ label, hint, extra, reset, children }: { label: string; hint?: string; extra?: React.ReactNode; reset?: () => void; children: React.ReactNode }) {
  const q = useContext(Query);
  if (q && !`${label} ${hint ?? ""}`.toLowerCase().includes(q)) return null;
  return (
    <div className="setting">
      <div className="lbl">{label}{hint && <span className="hint">{hint}</span>}</div>
      {children}
      <span className="send">
        {extra}
        {reset && <button className="btn link small" title={t("Вернуть значение по умолчанию")} aria-label={t("Сбросить: {0}", label)} onClick={reset}>{t("Сбросить")}</button>}
      </span>
    </div>
  );
}

/** Раздел: при поиске показывается с названием, без совпадений прячется. */
function Group({ name, children }: { name: string; children: React.ReactNode }) {
  const q = useContext(Query);
  return q ? <div className="sgroup"><h3 className="subhead">{name}</h3>{children}</div> : <>{children}</>;
}

export function Settings({ info, theme, onTheme, onAppearance, release }: { info: AppInfo; theme: string; onTheme: (t: string) => void; onAppearance: (g: GlobalSettings) => void; release: LauncherRelease | null }) {
  const dialog = useDialog();
  const [s, setS] = useState<GlobalSettings | null>(null);
  const [args, setArgs] = useState("");
  const [saved, setSaved] = useState(false);
  const [sec, setSec] = useState<Section>("general");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const show = (k: Section) => !!q || sec === k;
  const [d, setD] = useState<GlobalSettings | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { api.globalSettingsDefault().then(setD).catch(() => {}); }, []);
  // ⌘/Ctrl F — к поиску по настройкам.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (isMod(e) && e.code === "KeyF" && !document.querySelector("[role=dialog]")) { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [storage, setStorage] = useState<{ label: string; size: number; cleanable: boolean }[] | null>(null);
  const loadStorage = () => { diagnostics.storage().then(setStorage).catch(() => setStorage([])); };

  useEffect(() => {
    api.globalSettings().then((g) => { setS(g); setArgs((g.launch.jvm_args ?? []).join(" ")); }).catch(() => {});
  }, []);
  // Изменения сохраняются сами: через полсекунды после правки и сразу при уходе с экрана.
  // Иначе внешний вид менялся на глазах, а после перезапуска молча возвращался.
  const pending = useRef<GlobalSettings | null>(null);
  const loaded = useRef(false);
  const flush = useCallback(async () => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    try {
      await api.saveGlobalSettings(next);
      setStreamer(next.streamer_mode);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      await dialog.alert(t("Настройки не сохранены"), errText(e));
    }
  }, [dialog]);
  useEffect(() => {
    if (!s) return;
    if (!loaded.current) { loaded.current = true; return; }
    pending.current = { ...s, theme, launch: { ...s.launch, jvm_args: args.trim() ? args.trim().split(/\s+/) : undefined } };
    const timer = setTimeout(flush, 500);
    return () => clearTimeout(timer);
  }, [s, args]);
  useEffect(() => () => { void flush(); }, [flush]);
  if (!s) return <p className="muted"><span className="spinner" /> {t("Загружаем…")}</p>;

  const SECTIONS: [Section, string][] = [["general", t("Общие")], ["look", t("Внешний вид")], ["game", t("Игра")], ["data", t("Данные и сеть")], ["privacy", t("Приватность")], ["about", t("О Axel'")]];
  const title = SECTIONS.find(([k]) => k === sec)![1];
  /** «Сбросить» для простой настройки: есть, только когда значение отличается от умолчания. */
  const reset = <K extends keyof GlobalSettings>(k: K, appearance = false) =>
    d && (s[k] ?? null) !== (d[k] ?? null) ? () => { const n = { ...s, [k]: d[k] ?? undefined }; setS(n); if (appearance) onAppearance(n); } : undefined;
  return (
    <>
      <h1>{t("Настройки Axel'")}</h1>
      <p className="sub">{t("Настройки лаунчера и значения по умолчанию для сборок.")}</p>
      <div className="settings">
        <nav className="secnav" aria-label={t("Разделы настроек")}>
          <input ref={searchRef} className="field" type="search" placeholder={t("Найти настройку")} aria-label={t("Найти настройку")} aria-keyshortcuts="Control+F Meta+F"
            value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape" && query) { e.stopPropagation(); setQuery(""); } }} />
          {SECTIONS.map(([k, l]) => <button key={k} className={!q && sec === k ? "on" : ""} aria-current={!q && sec === k ? "page" : undefined} onClick={() => { setQuery(""); setSec(k); }}>{l}</button>)}
        </nav>
        <Query.Provider value={q}>
        <section className="card scard" aria-label={q ? t("Поиск по настройкам") : title}>
          <h2>{q ? t("Найдено по «{0}»", query.trim()) : title}</h2>
          {show("general") && <Group name={t("Общие")}>
        <Row label={t("Язык")} hint="Language">
          <select className="field" value={s.language} onChange={async (e) => {
            const next = { ...s, language: e.target.value };
            try { await api.saveGlobalSettings(next); switchLang(next.language); } catch (er) { await dialog.alert(t("Настройки не сохранены"), errText(er)); }
          }}>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </Row>
        <Row label={t("Тема")} reset={d && theme !== d.theme ? () => onTheme(d.theme) : undefined}>
          <div className="seg" role="radiogroup" aria-label={t("Тема")}>
            {([["light", t("Светлая")], ["dark", t("Тёмная")], ["system", t("Как в системе")]] as const).map(([v, l]) => (
              <button key={v} role="radio" aria-checked={theme === v} className={theme === v ? "on" : ""} onClick={() => onTheme(v)}>{l}</button>
            ))}
          </div>
        </Row>
        <Row label={t("Папка данных")} extra={<DataDirButton />}>
          <span className="mono" style={{ userSelect: "text" }}>{path(info.data_dir, s.streamer_mode)}</span>
        </Row>
        <Row label={t("Память по умолчанию")} hint={t("для сборок без своего значения")} extra={<span className="muted small">{t("МБ")}</span>}
          reset={d && s.launch.max_memory_mb !== d.launch.max_memory_mb ? () => setS({ ...s, launch: { ...s.launch, max_memory_mb: d.launch.max_memory_mb, min_memory_mb: undefined } }) : undefined}>
          <input className="field" type="number" min={1024} step={512} placeholder="4096" value={s.launch.max_memory_mb ?? ""}
            onChange={(e) => setS({ ...s, launch: { ...s.launch, max_memory_mb: e.target.value ? Number(e.target.value) : undefined, min_memory_mb: undefined } })} />
        </Row>
        <Row label={t("Сообщать о новой версии Axel'")} hint={t("проверка на GitHub при запуске, скачивание только по вашему нажатию")} reset={reset("check_launcher_updates")}>
          <label className="row"><input type="checkbox" checked={s.check_launcher_updates} onChange={(e) => setS({ ...s, check_launcher_updates: e.target.checked })} /></label>
        </Row>
        <Row label={t("Режим стримера")} hint={t("скрывать ник, пути и адреса серверов на экране, в логах и в отчётах")} reset={reset("streamer_mode")}>
          <label className="row"><input type="checkbox" checked={s.streamer_mode} onChange={(e) => setS({ ...s, streamer_mode: e.target.checked })} /></label>
        </Row>
          </Group>}
          {show("look") && <Group name={t("Внешний вид")}>
        <Row label={t("Акцентный цвет")} reset={reset("accent", true)}>
          <div className="row" role="radiogroup" aria-label={t("Акцентный цвет")}>
            <button className={`swatch auto ${!s.accent ? "on" : ""}`} role="radio" aria-checked={!s.accent} aria-label={t("Как в теме")} title={t("Как в теме")} onClick={() => { const n = { ...s, accent: undefined }; setS(n); onAppearance(n); }}>A</button>
            {ACCENTS.map(([c, name]) => (
              <button key={c} className={`swatch ${s.accent === c ? "on" : ""}`} role="radio" aria-checked={s.accent === c} aria-label={name} title={name} style={{ background: c }}
                onClick={() => { const n = { ...s, accent: c }; setS(n); onAppearance(n); }} />
            ))}
          </div>
        </Row>
        <Row label={t("Масштаб интерфейса")} reset={reset("ui_scale", true)}>
          <select className="field" value={s.ui_scale} onChange={(e) => { const n = { ...s, ui_scale: Number(e.target.value) }; setS(n); onAppearance(n); }}>
            {[90, 100, 110, 125, 150].map((v) => <option key={v} value={v}>{v}%</option>)}
          </select>
        </Row>
        <Row label={t("Шрифт")} reset={reset("font", true)}>
          <select className="field" value={s.font} onChange={(e) => { const n = { ...s, font: e.target.value }; setS(n); onAppearance(n); }}>
            <option value="system">{t("Системный")}</option>
            <option value="readable">{t("Разборчивый (шире буквы)")}</option>
            <option value="serif">{t("С засечками")}</option>
          </select>
        </Row>
        <Row label={t("Компактный режим")} hint={t("меньше отступов, больше строк на экране")} reset={reset("compact", true)}>
          <label className="row"><input type="checkbox" checked={s.compact} onChange={(e) => { const n = { ...s, compact: e.target.checked }; setS(n); onAppearance(n); }} /></label>
        </Row>
          </Group>}
          {show("game") && <Group name={t("Игра")}>
        <Row label={t("Java по умолчанию")} hint={t("пусто: подбор по версии игры")}
          reset={d && (s.launch.java_path ?? "") !== (d.launch.java_path ?? "") ? () => setS({ ...s, launch: { ...s.launch, java_path: d.launch.java_path } }) : undefined}>
          <input className="field mono" placeholder={t("Авто")} value={s.launch.java_path ?? ""}
            onChange={(e) => setS({ ...s, launch: { ...s.launch, java_path: e.target.value || undefined } })} />
        </Row>
        <Row label={t("Аргументы JVM по умолчанию")} reset={d && args.trim() !== (d.launch.jvm_args ?? []).join(" ") ? () => setArgs((d.launch.jvm_args ?? []).join(" ")) : undefined}>
          <input className="field mono" value={args} onChange={(e) => setArgs(e.target.value)} placeholder={t("например -XX:+UseG1GC")} />
        </Row>
            {!q && <h3 className="subhead">{t("Бэкапы миров")}</h3>}
        <Row label={t("Бэкап мира перед рискованным запуском")} hint={t("если моды менялись после прошлой игры")} reset={reset("backup_before_risky_launch")}>
          <label className="row"><input type="checkbox" checked={s.backup_before_risky_launch} onChange={(e) => setS({ ...s, backup_before_risky_launch: e.target.checked })} /></label>
        </Row>
        <Row label={t("Бэкап мира после выхода из игры")} hint={t("последний мир, в который играли")} reset={reset("backup_after_exit")}>
          <label className="row"><input type="checkbox" checked={s.backup_after_exit} onChange={(e) => setS({ ...s, backup_after_exit: e.target.checked })} /></label>
        </Row>
        <Row label={t("Бэкап миров по расписанию")} hint={t("перед запуском, если в мир играли после прошлого бэкапа")} reset={reset("backup_every_days")}>
          <select className="field" value={s.backup_every_days} onChange={(e) => setS({ ...s, backup_every_days: Number(e.target.value) })}>
            <option value={0}>{t("Выключен")}</option>
            <option value={1}>{t("Каждый день")}</option>
            <option value={3}>{t("Раз в 3 дня")}</option>
            <option value={7}>{t("Раз в неделю")}</option>
          </select>
        </Row>
          </Group>}
          {show("data") && <Group name={t("Данные и сеть")}>
        <Row label={t("Скорость загрузок")} hint={t("чтобы не мешать другим в сети")} reset={reset("download_limit_kbps")}>
          <select className="field" value={s.download_limit_kbps} onChange={(e) => setS({ ...s, download_limit_kbps: Number(e.target.value) })}>
            <option value={0}>{t("Без ограничения")}</option>
            <option value={512}>{t("до 0,5 МБ/с")}</option>
            <option value={1024}>{t("до 1 МБ/с")}</option>
            <option value={2048}>{t("до 2 МБ/с")}</option>
            <option value={5120}>{t("до 5 МБ/с")}</option>
            <option value={10240}>{t("до 10 МБ/с")}</option>
          </select>
        </Row>
        <Row label={t("Удалённые сборки в корзине")} hint={t("потом папка удаляется, рецепт остаётся в истории")} reset={reset("trash_days")}>
          <select className="field" value={s.trash_days} onChange={(e) => setS({ ...s, trash_days: Number(e.target.value) })}>
            {[[1, t("24 часа")], [3, t("3 дня")], [7, t("7 дней")], [14, t("14 дней")], [30, t("30 дней")], [60, t("60 дней")]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Row>
            {!q && <>
            <h3 className="subhead">{t("Место на диске")}</h3>
        {storage === null ? (
          <button className="btn" onClick={loadStorage}>{t("Посчитать, сколько занимают данные Axel'")}</button>
        ) : (
          <>
            <div className="usage">
              {storage.map((p) => (
                <div key={p.label} className="urow">
                  <span>{tc(p.label)}</span>
                  <div className="bar"><i style={{ width: `${Math.max(1, (p.size / Math.max(1, storage[0]?.size ?? 1)) * 100)}%` }} /></div>
                  <span className="muted small">{sizeText(p.size)}</span>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" disabled={!storage.some((p) => p.cleanable && p.size > 0)} onClick={async () => {
                try { const freed = await diagnostics.cleanCache(); loadStorage(); await dialog.alert(t("Готово"), t("Освобождено {0}. Миры, моды, настройки и корзина не тронуты.", sizeText(freed))); }
                catch (e) { await dialog.alert(t("Не очищено"), errText(e)); }
              }}>{t("Очистить временные файлы и кеш")}</button>
              <span className="muted small">{t("Удаляется только то, что лаунчер скачает или соберёт заново.")}</span>
            </div>
          </>
        )}
            </>}
          </Group>}
          {!q && sec === "privacy" && <>
            <ul className="privacy">
              <li>{t("Axel' не собирает статистику и ничего не отправляет разработчикам.")}</li>
              <li>{t("Лаунчер обращается только к нужным сервисам: Mojang и Microsoft (игра и вход), Modrinth и CurseForge (моды), Adoptium (Java), GitHub (проверка новой версии Axel'), а для комнаты через интернет к серверам iroh (каталог адресов и посредник, через которого игра идёт в зашифрованном виде).")}</li>
              <li>{t("Данные входа хранятся в защищённом хранилище системы, а не в файлах.")}</li>
              <li>{t("Из логов и отчётов скрываются токены, путь к домашней папке и IP-адреса.")}</li>
            </ul>
            <button className="btn link" onClick={() => api.openLink("https://github.com/Hewako/axel-launcher/blob/main/docs/PRIVACY.md").catch(() => {})}>{t("Подробнее о приватности")}</button>
          </>}
          {!q && sec === "about" && <>
            {release && <UpdateNotice release={release} variant="block" />}
            <p>Axel' {info.version} {t("· открытый проект под GPL-3.0 · не связан с Mojang и Microsoft.")}</p>
            {!release && <p className="muted small">{s.check_launcher_updates ? t("У вас последняя версия.") : t("Проверка новой версии выключена в «Общих».")}</p>}
            <button className="btn link" onClick={() => api.openLink("https://github.com/Hewako/axel-launcher/releases").catch(() => {})}>{t("Все версии")}</button>
          </>}
          {q && <p className="muted snone">{t("Таких настроек нет. Попробуйте другое слово.")}</p>}
          <p className="muted small" role="status" aria-live="polite">{saved ? t("Сохранено") : ""}</p>
        </section>
        </Query.Provider>
      </div>
    </>
  );
}
