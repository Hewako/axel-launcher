import { useState } from "react";
import { errText } from "../api";
import { room, useRoom } from "../room";
import { t } from "../i18n";

/** «Игра с друзьями»: комната по коду, в одной сети или через интернет. */
export function RoomCard() {
  const r = useRoom();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const run = (f: () => Promise<void>) => { setError(""); f().catch((e) => setError(errText(e))); };
  const err = error || (r.role === "none" ? r.error : "");
  return (
    <section className="card room" aria-label={t("Игра с друзьями")}>
      <h2>{t("Игра с друзьями")}</h2>
      {r.role === "none" && (
        <div className="row">
          <button className="btn pri" onClick={() => run(room.create)}>{t("Создать комнату")}</button>
          <span className="muted">{t("или")}</span>
          <input className="field mono roomcode" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t("Код")} aria-label={t("Код комнаты")}
            onKeyDown={(e) => { if (e.key === "Enter" && code.trim()) run(() => room.join(code)); }} />
          <button className="btn" disabled={!code.trim()} onClick={() => run(() => room.join(code))}>{t("Войти")}</button>
        </div>
      )}
      {r.role === "host" && (
        <>
          <div className="row">
            <span className="roomcode big mono" aria-label={t("Код комнаты")}>{r.code}</span>
            <button className="btn" onClick={() => { navigator.clipboard?.writeText(r.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>{copied ? t("Скопировано") : t("Скопировать")}</button>
            <button className="btn" onClick={() => run(room.leave)}>{t("Закрыть комнату")}</button>
          </div>
          <p className="roomstate">
            {r.world
              ? (r.guests ? t("Мир «{0}» открыт, друзей в комнате: {1}", r.world, r.guests) : t("Мир «{0}» открыт, друзья могут заходить", r.world))
              : t("Отправьте код друзьям и откройте мир в игре: Esc, «Открыть для сети».")}
          </p>
          {r.internet === true && <p className="muted small">{t("По этому коду зайдут и друзья из другой сети, через интернет.")}</p>}
          {r.internet === false && <p className="muted small">{t("Через интернет комната сейчас недоступна, зайти можно только из этой же сети.")}</p>}
        </>
      )}
      {r.role === "guest" && (
        <>
          <div className="row">
            <span className="roomcode big mono">{r.code}</span>
            <button className="btn" onClick={() => run(room.leave)}>{t("Выйти из комнаты")}</button>
          </div>
          <p className="roomstate">
            {r.world ? (r.internet ? t("Мир «{0}» ждёт вас в игре: «Сетевая игра». Связь через интернет.", r.world) : t("Мир «{0}» ждёт вас в игре: «Сетевая игра».", r.world)) : <><span className="spinner" /> {t("Ищем комнату в вашей сети и в интернете…")}</>}
          </p>
        </>
      )}
      {err && <div className="alert err"><span>{err}</span></div>}
    </section>
  );
}
