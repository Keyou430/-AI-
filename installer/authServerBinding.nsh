!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var authAppData
!define /ifndef AUTH_DATA_DIRECTORY "$authAppData\${APP_PACKAGE_NAME}"

!macro extractAuthHelper
  ReadEnvStr $authAppData "APPDATA"
  InitPluginsDir
  File /oname=$PLUGINSDIR\authServerBinding.ps1 "${PROJECT_DIR}\installer\authServerBinding.ps1"
!macroend

!ifndef BUILD_UNINSTALLER
Var authServerDialog
Var authServerInput
Var authServerUrl
Var authPreviousInstall

!macro customInit
  !insertmacro extractAuthHelper
  File /oname=$PLUGINSDIR\legacy-auth-config.json "${PROJECT_DIR}\dist-electron\auth-config.json"
  StrCpy $authPreviousInstall "0"
  ${If} $hasPerUserInstallation == "1"
  ${OrIf} $hasPerMachineInstallation == "1"
    StrCpy $authPreviousInstall "1"
  ${EndIf}
  ${If} ${Silent}
  ${AndIf} $authPreviousInstall != "1"
    IfFileExists "${AUTH_DATA_DIRECTORY}\auth-server-binding.json" authSilentReady
    SetErrorLevel 1
    Quit
    authSilentReady:
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom AuthServerPage AuthServerLeave
!macroend

Function AuthServerPage
  IfFileExists "${AUTH_DATA_DIRECTORY}\auth-server-binding.json" 0 +2
    Abort
  ${If} $authPreviousInstall == "1"
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "绑定授权服务器" "首次安装时填写，绑定成功后不可修改"
  nsDialogs::Create 1018
  Pop $authServerDialog
  ${If} $authServerDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 22u "授权服务器地址（HTTPS 根地址，例如 https://auth.example.com）"
  Pop $0
  ${NSD_CreateText} 0 28u 100% 14u "$authServerUrl"
  Pop $authServerInput
  ${NSD_CreateLabel} 0 54u 100% 45u "请确认地址属于你的授权服务器。填错后需要卸载重装；卸载会清除本机 API 设置。网络故障不会解除绑定。"
  Pop $0
  nsDialogs::Show
FunctionEnd

Function AuthServerLeave
  ${NSD_GetText} $authServerInput $authServerUrl
  ClearErrors
  FileOpen $0 "$PLUGINSDIR\auth-server-url.txt" w
  FileWriteUTF16LE /BOM $0 "$authServerUrl"
  FileClose $0
  IfErrors authValidationFailed
  nsExec::ExecToStack /TIMEOUT=25000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\authServerBinding.ps1" -Action Validate -UrlFile "$PLUGINSDIR\auth-server-url.txt"'
  Pop $0
  Pop $1
  ${If} $0 != "0"
    Goto authValidationFailed
  ${EndIf}
  MessageBox MB_OKCANCEL|MB_ICONQUESTION "验证通过。绑定后无法在软件中修改服务器地址，是否确认？" IDOK authValidationDone
  Abort
  authValidationFailed:
    MessageBox MB_OK|MB_ICONEXCLAMATION "验证失败，请检查 HTTPS 根地址、服务器网络和授权接口后重试。"
    Abort
  authValidationDone:
FunctionEnd

!macro customInstall
  StrCpy $2 ""
  ${If} $authPreviousInstall == "1"
    StrCpy $2 '-LegacyConfig "$PLUGINSDIR\legacy-auth-config.json"'
  ${EndIf}
  nsExec::ExecToStack /TIMEOUT=15000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\authServerBinding.ps1" -Action Install -DataDirectory "${AUTH_DATA_DIRECTORY}" -UrlFile "$PLUGINSDIR\auth-server-url.txt.validated" $2'
  Pop $0
  Pop $1
  ${If} $0 != "0"
    MessageBox MB_OK|MB_ICONSTOP "无法保存授权服务器绑定，请卸载后重新安装。首次安装需要在安装向导中填写并验证地址。"
    Abort
  ${EndIf}
!macroend
!endif

!macro customUnInstall
  ${IfNot} ${isUpdated}
    !insertmacro extractAuthHelper
    nsExec::ExecToStack /TIMEOUT=15000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\authServerBinding.ps1" -Action Uninstall -DataDirectory "${AUTH_DATA_DIRECTORY}"'
    Pop $0
    Pop $1
    ${If} $0 != "0"
      MessageBox MB_OK|MB_ICONSTOP "无法清除本机绑定或 API 设置，请检查文件权限后重试卸载。"
      Abort
    ${EndIf}
  ${EndIf}
!macroend
