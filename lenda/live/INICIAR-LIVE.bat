@echo off
chcp 65001 >nul
title LENDA - Live interativa
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Instale o Node.js 20 ou mais novo: https://nodejs.org  ^(versao LTS^)
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando as dependencias ^(so na primeira vez^)...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm run live -- --abrir %*
pause
