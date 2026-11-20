## Какой файл скачать

| Ваша система | Файл |
|---|---|
| Windows 10 и 11 (в том числе на ARM — через встроенную эмуляцию) | `Axel-Launcher-Windows.exe` — установщик |
| Windows, без установки | `Axel-Launcher-Windows-portable.zip` — распакуйте и запустите `Axel Launcher.exe` |
| macOS 11 и новее, любой Mac | `Axel-Launcher-macOS.dmg` |
| Ubuntu, Debian, Mint | `Axel-Launcher-Linux.deb` |
| Fedora, openSUSE | `Axel-Launcher-Linux.rpm` |
| Другой Linux | `Axel-Launcher-Linux.AppImage` |

Миры, профили и настройки хранятся отдельно (папка `.quarry` в домашней папке) — обновление и
удаление программы их не трогают.

## Если система предупредила

Установщики не подписаны сертификатом разработчика, поэтому при первом запуске система
предупредит об этом — это ожидаемо.

- **Windows:** «Система Windows защитила ваш компьютер» → «Подробнее» → «Выполнить в любом случае».
- **macOS 15 и новее:** откройте `.dmg`, перетащите Axel' в «Программы» и запустите. macOS скажет,
  что не может проверить приложение, — нажмите «Готово», затем «Системные настройки →
  Конфиденциальность и безопасность → Всё равно открыть». **macOS 14 и старше:** правый клик по
  Axel' в «Программах» → «Открыть».
- **Linux, AppImage на Ubuntu 22.04 и новее:** нужна библиотека FUSE 2 —
  `sudo apt install libfuse2` (на Ubuntu 24.04 — `libfuse2t64`). Затем «Свойства → Разрешить
  запуск как программу» и двойной клик.

Проверить, что файл не подменён: суммы SHA-256 — в `SHA256SUMS.txt`
(`shasum -a 256 -c SHA256SUMS.txt --ignore-missing` на macOS и Linux,
`Get-FileHash <файл>` в PowerShell).

Что нового — в [CHANGELOG.md](https://github.com/Hewako/quarry-launcher/blob/main/CHANGELOG.md),
подробная установка — в [README](https://github.com/Hewako/quarry-launcher#установка).

---

**English.** Windows: `Axel-Launcher-Windows.exe` (installer) or `…-portable.zip`; macOS (any Mac,
11+): `Axel-Launcher-macOS.dmg`; Linux: `.deb`, `.rpm` or `.AppImage` (on Ubuntu 22.04+ AppImage
needs `libfuse2`). The installers are not signed with a developer certificate, so the system
warns on first launch: on Windows choose "More info" → "Run anyway"; on macOS 15+ open
"System Settings → Privacy & Security → Open Anyway" (on macOS 14 and older: right-click → Open).
Your worlds and profiles live in the `.quarry` folder in your home folder and are kept on update
and uninstall. Checksums: `SHA256SUMS.txt`.
