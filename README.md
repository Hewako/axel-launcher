# Axel'

Открытый лаунчер Minecraft: Java Edition для игроков с несколькими профилями и модпаками.
Рабочее название. Не связан с Mojang и Microsoft.

<p align="center">
  <a href="https://github.com/Hewako/quarry-launcher/releases/latest/download/Axel-Launcher-Windows.exe"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/img/download-windows-dark.png">
    <img alt="Скачать для Windows" src="docs/img/download-windows.png" width="240" height="56">
  </picture></a>
  <a href="https://github.com/Hewako/quarry-launcher/releases/latest/download/Axel-Launcher-macOS.dmg"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/img/download-macos-dark.png">
    <img alt="Скачать для macOS" src="docs/img/download-macos.png" width="240" height="56">
  </picture></a>
  <a href="#установка"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/img/download-linux-dark.png">
    <img alt="Скачать для Linux: .deb, .rpm, AppImage" src="docs/img/download-linux.png" width="240" height="56">
  </picture></a>
</p>

**Состояние:** ранняя разработка (0.1). Что нового — [CHANGELOG.md](CHANGELOG.md),
подробный журнал работы — [docs/PROGRESS.md](docs/PROGRESS.md).
Как описывать изменения — [docs/COMMITS.md](docs/COMMITS.md).

## Скачать

| Система | Файл |
|---|---|
| Windows 10 и 11 | [Axel-Launcher-Windows.exe](https://github.com/Hewako/quarry-launcher/releases/latest/download/Axel-Launcher-Windows.exe) — установщик · [без установки (.zip)](https://github.com/Hewako/quarry-launcher/releases/latest/download/Axel-Launcher-Windows-portable.zip) |
| macOS 11 и новее, любой Mac | [Axel-Launcher-macOS.dmg](https://github.com/Hewako/quarry-launcher/releases/latest/download/Axel-Launcher-macOS.dmg) |
| Ubuntu, Debian, Mint | [Axel-Launcher-Linux.deb](https://github.com/Hewako/quarry-launcher/releases/latest/download/Axel-Launcher-Linux.deb) |
| Fedora, openSUSE | [Axel-Launcher-Linux.rpm](https://github.com/Hewako/quarry-launcher/releases/latest/download/Axel-Launcher-Linux.rpm) |
| Другой Linux | [Axel-Launcher-Linux.AppImage](https://github.com/Hewako/quarry-launcher/releases/latest/download/Axel-Launcher-Linux.AppImage) |

Ссылки всегда ведут на последнюю вышедшую версию. Все версии и пробные сборки —
на [странице релизов](https://github.com/Hewako/quarry-launcher/releases).

## Установка

Установщики не подписаны сертификатом разработчика, поэтому при первом запуске система
предупредит об этом — это ожидаемо.

**Windows 10/11.** Запустите `Axel-Launcher-Windows.exe`. Если появится «Система Windows
защитила ваш компьютер», нажмите «Подробнее» → «Выполнить в любом случае». Пароль
администратора не нужен: программа ставится в папку пользователя, ярлыки — на рабочий стол и
в «Пуск». Если в системе нет WebView2, установщик скачает его сам (нужен интернет).
Без установки: распакуйте `…-portable.zip` и запустите `Axel Launcher.exe` (на Windows 10 может
понадобиться WebView2 — ссылка в `README-portable.txt` внутри архива).

**macOS** (один файл для Apple Silicon и Intel):
1. Откройте `.dmg` и перетащите Axel Launcher в «Программы».
2. Запустите Axel'. macOS скажет, что не может проверить приложение, — нажмите «Готово».
3. Откройте «Системные настройки → Конфиденциальность и безопасность», внизу найдите
   строку про Axel' и нажмите «Всё равно открыть», затем подтвердите паролем или Touch ID.
   Дальше Axel' открывается как обычно. На macOS 14 и старше хватит правого клика по
   приложению → «Открыть».

**Linux** (x86-64, glibc 2.35+ — Ubuntu 22.04, Debian 12, Fedora 38 и новее):
- Ubuntu и Debian: `sudo apt install ./Axel-Launcher-Linux.deb`
- Fedora: `sudo dnf install ./Axel-Launcher-Linux.rpm`
- другие: `chmod +x Axel-Launcher-Linux.AppImage` и запустите его. На Ubuntu 22.04 и новее
  AppImage нужна библиотека FUSE 2: `sudo apt install libfuse2` (на Ubuntu 24.04 —
  `libfuse2t64`).

Для входа нужно системное хранилище паролей (GNOME Keyring или KWallet): токены хранятся
только там, в файлы Axel' их не пишет.

**Обновление.** Когда выходит новая версия, Axel' показывает это сверху и в «Настройки → О Axel'»;
кнопка «Скачать» скачивает установщик для вашей системы. Поставьте его поверх — удалять старую
версию не нужно.

**Где данные и удаление.** Миры, профили и настройки лежат в папке `.quarry` в домашней папке
(`%USERPROFILE%\.quarry` на Windows). Обновление и удаление программы их не трогают; чтобы
убрать всё, удалите и эту папку. Удалить программу: Windows — «Параметры → Приложения»; macOS —
перетащить из «Программ» в Корзину; Linux — `sudo apt remove axel-launcher`,
`sudo dnf remove axel-launcher` или просто удалить AppImage.

**Проверить, что файл не подменён.** В каждом релизе есть `SHA256SUMS.txt`. На macOS и Linux:
`shasum -a 256 -c SHA256SUMS.txt --ignore-missing` в папке со скачанным файлом; на Windows —
`Get-FileHash <файл>` в PowerShell и сравните со строкой в `SHA256SUMS.txt`.

## Известные ограничения

- **Вход Microsoft** работает (приложение одобрено Mojang). Без входа игра не запускается:
  лаунчер проверяет, что Minecraft: Java Edition куплена.
- **Ely.by** — вход логином и паролем (с двухфакторной защитой, пароль не сохраняется), только
  вместе с Microsoft-аккаунтом, на котором куплена игра. Вживую вход Ely.by ещё не проверен.
- **Windows и Linux** проверены только автоматикой (сборка и тесты в CI, установка без запуска
  игры); вручную лаунчер проверен на macOS.
- **macOS, версии 1.13–1.17.1** без модов не открывают окно (ошибка игры MCL-15163). Для
  Fabric 1.14–1.17.1 Mod Doctor предложит мод-исправление; без модов работают 1.12.2 и старше
  или 1.18 и новее.
- **Forge** не поддерживается — есть Fabric, Quilt и NeoForge.
- **Каталог CurseForge** есть только в сборках с ключом API; сборки CurseForge можно
  импортировать из zip.
- **Автообновления нет:** лаунчер сообщает о новой версии и открывает страницу релизов.

## Что уже работает

- Версии из манифеста Mojang, включая схему 26.x; Java выбирается по `javaVersion` версии и
  показывает причину выбора; нужная Java (Temurin) скачивается и проверяется по SHA-256.
- Изолированные профили: Vanilla, Fabric, Quilt, NeoForge. Совместимость загрузчика проверяется до скачивания.
- Загрузка с проверкой хэшей, повторами, прогрессом и отменой; общий кеш библиотек и ассетов.
- Команда запуска по `arguments` из JSON версии (Quick Play, старые `minecraftArguments`),
  logging-конфиг Mojang против Log4Shell.
- Логи игры с маскированием токенов, домашней папки и IP; история 20 последних запусков каждого профиля.
- Вход Microsoft с проверкой покупки (нужен одобренный client ID — [docs/MICROSOFT_SETUP.md](docs/MICROSOFT_SETUP.md)).
  Ely.by — только вместе с Microsoft-аккаунтом, на котором куплена игра.

## Сборка

Нужны Rust (stable) и Node.js 20+.

```bash
cd ui && npm ci && npm run tauri dev
```

Сборка разработчика, разрешающая запуск без входа (только debug, для проверки на своей копии игры):

```bash
cd ui && npm run tauri dev -- --features dev-launch
```

CLI:

```bash
cargo run -p quarry-core --bin quarry -- --help
```

Тесты: `cargo test --workspace` (сетевые помечены `#[ignore]`: `cargo test -- --ignored`).

## Структура

```
core/          библиотека quarry-core и CLI quarry (без зависимости от интерфейса)
ui/            интерфейс Tauri 2 + React; ui/src-tauri — тонкие команды над ядром
docs/          журнал прогресса, сверка API, инструкции
```

Данные лежат в `~/.quarry` (см. `core/src/paths.rs`); токены — только в хранилище секретов ОС.

## Лицензия

GPL-3.0-or-later, см. [LICENSE](LICENSE).

## Приватность

Axel' не собирает статистику и ничего не отправляет разработчикам. Что и куда уходит — в [docs/PRIVACY.md](docs/PRIVACY.md).

## Релизы

Установщики для macOS, Windows и Linux собираются в GitHub Actions по тегу `v*` (черновик релиза, без сертификата разработчика; на macOS — ad-hoc подпись, см. «Установка»). Лаунчер сам сообщает о новой версии и даёт скачать установщик для своей системы — автообновления нет. Имена файлов постоянные (без номера версии), рядом — `SHA256SUMS.txt`.
