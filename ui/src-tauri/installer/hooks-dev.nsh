; Хуки установщика сборки разработчика «Axel Launcher Dev» (только .github/workflows/dev-build.yml).
; Обычные хуки — те же; плюс перед установкой тихо удаляется обычный Axel Launcher, чтобы
; на компьютере не было двух лаунчеров. Миры и профили в %USERPROFILE%\.quarry не трогаются.
!include "${__FILEDIR__}\hooks.nsh"

!define AXEL_NORMAL_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Axel Launcher"

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R8 HKCU "${AXEL_NORMAL_UNINSTKEY}" "UninstallString"
  ReadRegStr $R9 HKCU "${AXEL_NORMAL_UNINSTKEY}" "InstallLocation"
  ${If} $R8 != ""
  ${AndIf} $R9 != ""
    StrCpy $R9 $R9 -1 1 ; InstallLocation записан в кавычках
    ; _?= — деинсталлятор работает на месте, и ExecWait дожидается конца; /S — без окон.
    ExecWait '$R8 /S _?=$R9'
    Delete "$R9\uninstall.exe"
    RMDir "$R9"
  ${EndIf}
!macroend
