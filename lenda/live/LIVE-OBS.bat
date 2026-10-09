@echo off
chcp 65001 >nul
title LENDA - Live com OBS
cd /d "%~dp0.."

rem Em cada live:
rem   1. pede o @ da live, o URL do servidor e a chave de transmissao do TikTok
rem      (a chave vai so para o perfil LENDA do proprio OBS);
rem   2. liga a ponte numa janela propria, como o INICIAR-LIVE.bat (e ela abre o painel da live);
rem   3. espera a ponte e abre o OBS no perfil "LENDA", na colecao e na cena "LENDA Live".
rem Antes, uma vez so: INSTALAR-OBS.bat.
rem   LIVE-OBS.bat --demo   testa tudo com o publico de demonstracao da ponte, sem chave e sem transmitir

set "DEMO="
if /i "%~1"=="--demo" set "DEMO=--demo"

rem ---- Node.js 22 ou mais novo ----
where node >nul 2>nul
if errorlevel 1 goto sem_node
set "NODE_MAIOR="
for /f "delims=" %%v in ('node -p "parseInt(process.versions.node)"') do set "NODE_MAIOR=%%v"
if not defined NODE_MAIOR goto sem_node
if %NODE_MAIOR% LSS 22 goto node_antigo

rem ---- 1. OBS fechado, @ da live, URL do servidor e chave de transmissao ----
node live\obs\obs-kit.mjs preparar %DEMO%
if errorlevel 1 goto parou

rem ---- 2. ponte da live numa janela propria (ja aberta? usa a que esta rodando) ----
node live\obs\obs-kit.mjs ponte-aberta
if errorlevel 1 goto ligar_ponte
echo.
echo  A ponte do LENDA ja esta aberta: vou usar a que esta rodando.
goto abrir_obs

:ligar_ponte
set "PONTE_OPCOES=%DEMO%"
set "LIVE_USUARIO="
if not defined DEMO for /f "delims=" %%u in ('node live\obs\obs-kit.mjs usuario') do set "LIVE_USUARIO=%%u"
if defined LIVE_USUARIO set "PONTE_OPCOES=--usuario %LIVE_USUARIO%"
start "LENDA - Live interativa" cmd /c live\INICIAR-LIVE.bat %PONTE_OPCOES%

:abrir_obs
rem ---- 3. espera a ponte servir a pagina do OBS e abre o OBS ----
node live\obs\obs-kit.mjs abrir-obs %DEMO%
if errorlevel 1 goto parou
echo.
echo  Pode fechar esta janela. Deixe aberta a janela preta da ponte durante toda a live.
echo.
pause
exit /b 0

:parou
echo.
echo  O LIVE-OBS.bat parou. Veja a mensagem acima.
echo.
pause
exit /b 1

:sem_node
echo.
echo  Nao achei o Node.js neste computador.
echo  Instale a versao LTS ^(22 ou mais nova^) em https://nodejs.org
echo  Depois feche esta janela e abra o LIVE-OBS.bat de novo.
echo.
pause
exit /b 1

:node_antigo
echo.
echo  Seu Node.js e a versao %NODE_MAIOR%, antiga demais para o LENDA.
echo  Instale a versao LTS ^(22 ou mais nova^) em https://nodejs.org
echo  Depois feche esta janela e abra o LIVE-OBS.bat de novo.
echo.
pause
exit /b 1
