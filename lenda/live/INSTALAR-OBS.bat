@echo off
chcp 65001 >nul
title LENDA - Instalar no OBS
cd /d "%~dp0.."

rem Copia para o OBS Studio o perfil "LENDA" e a colecao de cenas "LENDA Live" (pasta live\obs).
rem Uma vez so. Pode rodar de novo quando quiser: o que ja existia vai para uma copia de seguranca,
rem e o servidor e a chave de transmissao salvos no perfil continuam la.

rem ---- Node.js 22 ou mais novo ----
where node >nul 2>nul
if errorlevel 1 goto sem_node
set "NODE_MAIOR="
for /f "delims=" %%v in ('node -p "parseInt(process.versions.node)"') do set "NODE_MAIOR=%%v"
if not defined NODE_MAIOR goto sem_node
if %NODE_MAIOR% LSS 22 goto node_antigo

rem ---- acha o OBS, espera ele fechar e copia os arquivos ----
node live\obs\obs-kit.mjs instalar
if errorlevel 1 goto parou
echo.
pause
exit /b 0

:parou
echo.
echo  A instalacao no OBS nao terminou. Veja a mensagem acima.
echo.
pause
exit /b 1

:sem_node
echo.
echo  Nao achei o Node.js neste computador.
echo  Instale a versao LTS ^(22 ou mais nova^) em https://nodejs.org
echo  Depois feche esta janela e abra o INSTALAR-OBS.bat de novo.
echo.
pause
exit /b 1

:node_antigo
echo.
echo  Seu Node.js e a versao %NODE_MAIOR%, antiga demais para o LENDA.
echo  Instale a versao LTS ^(22 ou mais nova^) em https://nodejs.org
echo  Depois feche esta janela e abra o INSTALAR-OBS.bat de novo.
echo.
pause
exit /b 1
