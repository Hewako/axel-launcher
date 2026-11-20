; Хуки установщика Windows (NSIS) для Axel'. Подключаются в installer.nsi Tauri
; (bundle > windows > nsis > installerHooks). Строки — в installer/Russian.nsh и English.nsh.

; После удаления программы напомнить, что миры и профили остались в %USERPROFILE%\.quarry
; (решение владельца 21.11.2026: удаление не трогает данные игрока). Не показываем при
; тихом удалении и при обновлении поверх (установщик сам удаляет старую версию).
!macro NSIS_HOOK_POSTUNINSTALL
  ${IfNot} ${Silent}
  ${AndIf} $UpdateMode <> 1
    MessageBox MB_OK|MB_ICONINFORMATION "$(quarryDataKept)"
  ${EndIf}
!macroend
