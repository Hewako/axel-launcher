Axel Launcher — портативная версия для Windows
=============================================

Запуск: откройте «Axel Launcher.exe». Устанавливать ничего не нужно, папку можно положить
куда угодно (в том числе на флешку).

Нужен Microsoft Edge WebView2 — в Windows 11 он уже есть. Если на Windows 10 лаунчер не
открывается, установите WebView2: https://go.microsoft.com/fwlink/p/?LinkId=2124703
(или возьмите обычный установщик Axel-Launcher-Windows.exe — он поставит WebView2 сам).

При первом запуске Windows может показать «Система Windows защитила ваш компьютер»:
«Подробнее» → «Выполнить в любом случае». Файл не подписан сертификатом разработчика.

Миры, профили и настройки хранятся в папке %USERPROFILE%\.axel — не рядом с программой.
Удалить портативную версию — просто удалить эту папку; данные в .axel останутся.

Лицензии сторонних компонентов — THIRD-PARTY-NOTICES.txt.
Сайт проекта: https://github.com/Hewako/axel-launcher


Axel Launcher — portable version for Windows
============================================

Run "Axel Launcher.exe"; nothing to install. It needs Microsoft Edge WebView2 (built into
Windows 11; on Windows 10 install it from the link above, or use the regular installer
Axel-Launcher-Windows.exe, which installs it for you). On first launch Windows may say
"Windows protected your PC": choose "More info" → "Run anyway" (the file is not signed).
Worlds, profiles and settings live in %USERPROFILE%\.axel, not next to the program.
