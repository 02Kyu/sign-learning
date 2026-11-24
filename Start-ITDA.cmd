@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 goto failed

set "ITDA_OPEN_BROWSER=1"
if /i "%~1"=="--no-browser" set "ITDA_OPEN_BROWSER=0"

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$ErrorActionPreference = 'Stop'; Add-Type -Path 'tools\windows\ItdaLocalServer.cs'; [ItdaLocalServer]::Run((Join-Path $PWD.Path 'web'), ($env:ITDA_OPEN_BROWSER -eq '1'))"
set "ITDA_EXIT_CODE=%ERRORLEVEL%"
popd
if "%ITDA_EXIT_CODE%"=="0" exit /b 0

:failed
echo ITDA could not start. Extract the entire project and retry from the extracted folder.
if /i not "%~1"=="--no-browser" pause
exit /b 1
