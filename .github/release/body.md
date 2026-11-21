## Какой файл взять

| У вас | Скачайте |
|---|---|
| Windows 10 или 11 (на ARM тоже работает) | `Axel-Launcher-Windows.exe` |
| Windows, но ставить ничего не хочется | `Axel-Launcher-Windows-portable.zip` — распакуйте и запустите `Axel Launcher.exe` |
| Mac на macOS 11 или новее, любой процессор | `Axel-Launcher-macOS.dmg` |
| Ubuntu, Debian, Mint | `Axel-Launcher-Linux.deb` |
| Fedora, openSUSE | `Axel-Launcher-Linux.rpm` |
| Другой Linux | `Axel-Launcher-Linux.AppImage` |

Если Axel' у вас уже стоит, просто поставьте новую версию поверх. Миры, профили и настройки
лежат в папке `.quarry` в домашней папке, установка и удаление программы её не трогают.

## Система ругается при первом запуске

Так и должно быть: установщики не подписаны платным сертификатом, и система не знает автора.

- **Windows.** В окне «Система Windows защитила ваш компьютер» нажмите «Подробнее», потом
  «Выполнить в любом случае».
- **macOS 15 и новее.** Перетащите Axel' из `.dmg` в «Программы» и запустите. macOS скажет, что
  не может проверить приложение: нажмите «Готово», откройте «Системные настройки →
  Конфиденциальность и безопасность» и внизу нажмите «Всё равно открыть». На macOS 14 и старше
  хватит правого клика по Axel' в «Программах» и пункта «Открыть».
- **AppImage на Ubuntu 22.04 и новее.** Сначала поставьте FUSE 2: `sudo apt install libfuse2`
  (на Ubuntu 24.04 пакет называется `libfuse2t64`). Потом «Свойства → Разрешить запуск как
  программу» и двойной клик.

Хотите убедиться, что файл никто не подменил? Суммы SHA-256 лежат в `SHA256SUMS.txt`. На macOS и
Linux: `shasum -a 256 -c SHA256SUMS.txt --ignore-missing`, на Windows: `Get-FileHash <файл>` в
PowerShell.

Что изменилось в этой версии — в [CHANGELOG.md](https://github.com/Hewako/quarry-launcher/blob/main/CHANGELOG.md),
установка по шагам — в [README](https://github.com/Hewako/quarry-launcher#установка).
Нашли ошибку — [расскажите о ней](https://github.com/Hewako/quarry-launcher/issues/new).

---

**English.** Windows: `Axel-Launcher-Windows.exe`, or `…-portable.zip` if you'd rather not
install anything. Mac (macOS 11+, Apple Silicon or Intel): `Axel-Launcher-macOS.dmg`. Linux:
`.deb`, `.rpm` or `.AppImage` (on Ubuntu 22.04+ the AppImage needs `libfuse2`). The files aren't
signed with a paid certificate, so your system will warn you the first time: on Windows click
"More info" → "Run anyway"; on macOS 15+ go to System Settings → Privacy & Security → Open Anyway
(on macOS 14 and older, right-click the app → Open). Install over the old version to update.
Your worlds and profiles live in the `.quarry` folder in your home folder and survive updates and
uninstalls. Checksums are in `SHA256SUMS.txt`.
