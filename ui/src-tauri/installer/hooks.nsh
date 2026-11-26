; Хуки установщика Windows (NSIS) для Axel'. Подключаются в installer.nsi Tauri
; (bundle > windows > nsis > installerHooks). Строки — в installer/Russian.nsh и English.nsh.

; После удаления программы напомнить, где лежат миры и профили — %USERPROFILE%\.axel
; (решение владельца 21.11.2026: удаление не трогает данные игрока). Не показываем при тихом
; и пассивном удалении и с /UPDATE. Обычная установка поверх тоже запускает старый
; деинсталлятор без /UPDATE, и отличить её от удаления нельзя — поэтому текст нейтральный:
; не «программа удалена» и не «удалите папку», а только где данные и что их не трогают.
!macro NSIS_HOOK_POSTUNINSTALL
  ${IfNot} ${Silent}
  ${AndIf} $UpdateMode <> 1
  ${AndIf} $PassiveMode <> 1
    MessageBox MB_OK|MB_ICONINFORMATION "$(axelDataKept)"
  ${EndIf}
!macroend
