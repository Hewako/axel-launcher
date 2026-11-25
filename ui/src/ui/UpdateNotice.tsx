import { api, type LauncherRelease } from "../api";
import { t } from "../i18n";
import { Icon } from "./icons";

/** Новая версия Axel': лента внизу окна (`ribbon`, с «Позже») и блок в «Настройки → О Axel'»
 *  (`block`). Один компонент, чтобы тексты и порядок кнопок не разошлись. */
export function UpdateNotice({ release, variant, onLater }: { release: LauncherRelease; variant: "ribbon" | "block"; onLater?: () => void }) {
  const open = (url: string) => api.openLink(url).catch(() => {});
  return (
    <div className={`updnote ${variant}`} role="status">
      <Icon name="info" size={18} />
      <div className="txt">
        <b>{t("Вышла новая версия Axel' {0}", release.version)}</b>
        <span>{release.download_url ? t("Установите поверх, миры и сборки останутся.") : t("Её можно скачать на странице релизов.")}</span>
      </div>
      <div className="acts">
        {release.download_url && <button className="btn get" onClick={() => open(release.download_url!)}><Icon name="download" size={15} /> {t("Скачать")}</button>}
        <button className="btn" onClick={() => open(release.url)}>{t("Открыть страницу загрузки")}</button>
        {variant === "ribbon" && onLater && <button className="btn later" onClick={onLater}>{t("Позже")}</button>}
      </div>
    </div>
  );
}
