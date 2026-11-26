; Хуки установщика сборки разработчика «Axel Launcher Dev» (только .github/workflows/dev-build.yml).
; Обычные хуки — те же; плюс перед установкой тихо удаляется обычный Axel Launcher, чтобы
; на компьютере не было двух лаунчеров. Миры и профили в %USERPROFILE%\.axel не трогаются.
;
; Обычный Axel Launcher ищем по имени в списке «Приложения» (раздел Uninstall), а не по одному
; известному ключу: он мог быть поставлен для текущего пользователя (HKCU, .exe) или для всех
; (HKLM), а самые первые пробные сборки — через .msi. Каждый шаг пишется в журнал
; %TEMP%\axel-dev-install.log: если что-то не удалилось, видно, на каком месте.
!include "${__FILEDIR__}\hooks.nsh"

!define AXEL_UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall"

!macro AxelLog TEXT
  FileOpen $R8 "$TEMP\axel-dev-install.log" a
  FileSeek $R8 0 END
  FileWrite $R8 "${TEXT}$\r$\n"
  FileClose $R8
!macroend

; Убрать кавычки по краям значения реестра.
!macro AxelUnquote VAR
  StrCpy $R7 ${VAR} 1
  StrCmp $R7 "$\"" 0 +2
    StrCpy ${VAR} ${VAR} -1 1
!macroend

; Найти и удалить обычный Axel Launcher в корне реестра ROOT (HKCU или HKLM). FALLBACK — папка по
; умолчанию, если в реестре не записано, где он стоит.
!macro AxelRemoveNormal ROOT FALLBACK
  StrCpy $R5 0 ; сколько раз удаляли: страховка от бесконечного цикла, если удаление не удалось
  axel_restart_${ROOT}:
  StrCpy $R0 0
  axel_loop_${ROOT}:
    EnumRegKey $R1 ${ROOT} "${AXEL_UNINST}" $R0
    StrCmp $R1 "" axel_done_${ROOT}
    IntOp $R0 $R0 + 1
    ReadRegStr $R2 ${ROOT} "${AXEL_UNINST}\$R1" "DisplayName"
    StrCmp $R2 "Axel Launcher" axel_found_${ROOT}
    Goto axel_loop_${ROOT}
  axel_found_${ROOT}:
    IntOp $R5 $R5 + 1
    IntCmp $R5 4 axel_done_${ROOT} 0 axel_done_${ROOT}
    ReadRegStr $R3 ${ROOT} "${AXEL_UNINST}\$R1" "UninstallString"
    ReadRegStr $R4 ${ROOT} "${AXEL_UNINST}\$R1" "InstallLocation"
    !insertmacro AxelLog "найден обычный Axel Launcher (${ROOT}\$R1): $R3"
    ; Запущенный обычный лаунчер мешает удалению.
    nsExec::Exec 'taskkill /F /T /IM "Axel Launcher.exe"'
    Pop $R6
    StrCpy $R6 $R3 8
    StrCmp $R6 "MsiExec." axel_msi_${ROOT}
    StrCmp $R6 "msiexec " axel_msi_${ROOT}
    ; Установщик NSIS (.exe): тихое удаление на месте, ExecWait дожидается конца.
    !insertmacro AxelUnquote $R4
    StrCmp $R4 "" 0 +2
      StrCpy $R4 "${FALLBACK}"
    ExecWait '$R3 /S _?=$R4' $R6
    !insertmacro AxelLog "  удаление .exe завершилось с кодом $R6"
    Delete "$R4\uninstall.exe"
    RMDir "$R4"
    Goto axel_restart_${ROOT}
  axel_msi_${ROOT}:
    ; Установщик .msi: ключ называется кодом продукта.
    ExecWait 'msiexec /x $R1 /qn /norestart' $R6
    !insertmacro AxelLog "  удаление .msi завершилось с кодом $R6"
    Goto axel_restart_${ROOT}
  axel_done_${ROOT}:
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro AxelLog "установка Axel Launcher Dev: ищем обычный Axel Launcher"
  !insertmacro AxelRemoveNormal HKCU "$LOCALAPPDATA\Axel Launcher"
  !insertmacro AxelRemoveNormal HKLM "$PROGRAMFILES64\Axel Launcher"
  !insertmacro AxelLog "поиск закончен"
!macroend
