@echo off
chcp 65001 >nul
title LENDA - Live interativa
cd /d "%~dp0.."

rem ---- Node.js 22 ou mais novo ----
where node >nul 2>nul
if errorlevel 1 goto sem_node
set "NODE_MAIOR="
for /f "delims=" %%v in ('node -p "parseInt(process.versions.node)"') do set "NODE_MAIOR=%%v"
if not defined NODE_MAIOR goto sem_node
if %NODE_MAIOR% LSS 22 goto node_antigo

rem ---- dependencias: instala na primeira vez e de novo quando o LENDA for atualizado ----
node live\ponte.mjs --checar-dependencias
if errorlevel 1 goto instalar
goto abrir

:instalar
echo.
echo  Instalando as dependencias ^(na primeira vez e depois de atualizar o LENDA^)...
echo.
call npm install
if errorlevel 1 goto falha_instalar

:abrir
rem repassa as opcoes: INICIAR-LIVE.bat --usuario seuperfil   ou   --porta 5179
call npm run live -- --abrir %*
pause
exit /b 0

:sem_node
echo.
echo  Nao achei o Node.js neste computador.
echo  Instale a versao LTS ^(22 ou mais nova^) em https://nodejs.org
echo  Depois feche esta janela e abra o INICIAR-LIVE.bat de novo.
echo.
pause
exit /b 1

:node_antigo
echo.
echo  Seu Node.js e a versao %NODE_MAIOR%, antiga demais para o LENDA.
echo  Instale a versao LTS ^(22 ou mais nova^) em https://nodejs.org
echo  Depois feche esta janela e abra o INICIAR-LIVE.bat de novo.
echo.
pause
exit /b 1

:falha_instalar
echo.
echo  Nao consegui instalar as dependencias. Confira a internet e veja o erro acima.
echo  Para tentar de novo, feche esta janela e abra o INICIAR-LIVE.bat outra vez.
echo.
pause
exit /b 1
