@echo off
rem Sobe o IHchat no Windows: de dois cliques neste arquivo.
rem Pelo prompt aceita as opcoes do lancador: iniciar.bat --porta 9000 --sem-navegador --sem-demo
rem (este arquivo fica so em ASCII: o cmd le o .bat na pagina de codigo do
rem console, e acento em UTF-8 viraria lixo na tela)
setlocal
title IHchat

rem O duplo clique abre a janela em outra pasta (System32, Area de Trabalho).
rem pushd em vez de "cd /d": tambem funciona com o projeto numa pasta de rede.
pushd "%~dp0"

rem Aberto de dentro do .zip, o Windows extrai so este arquivo para uma pasta
rem temporaria e o resto do projeto nao vem junto.
if not exist "scripts\iniciar.py" goto fora_do_projeto

rem "py -3" e o lancador do python.org e escolhe o Python 3 mais novo instalado;
rem "python" cobre quem instalou pela Microsoft Store ou de outro jeito. A versao
rem e conferida aqui, antes de rodar o iniciar.py: um Python 2.7 ou 3.5 que outro
rem programa deixou no PATH nem consegue ler aquele arquivo, e o dono veria um
rem SyntaxError em vez de "instale o 3.10". O atalho "python" que o Windows traz
rem sem Python instalado so abre a Store e sai com erro, entao tambem cai fora.
set "PYTHON="
set "ANTIGO="
call :testar py -3
if not defined PYTHON call :testar python
if defined PYTHON goto rodar
if defined ANTIGO goto python_antigo
goto sem_python

:rodar
%PYTHON% scripts\iniciar.py %*
if errorlevel 1 goto erro
popd
exit /b 0

:testar
rem O candidato vem nos argumentos (py -3, ou python). Serve se for 3.10 ou mais
rem novo; se so responder ao --version, fica guardado para a mensagem de versao
rem antiga. O teste de sucesso e o do proprio comando, nao "if not errorlevel 1":
rem esse aceitaria um codigo de saida negativo, que e como o Windows encerra um
rem python.exe quebrado (DLL faltando).
%* -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1 && set "PYTHON=%*"
if defined PYTHON exit /b 0
if defined ANTIGO exit /b 0
%* --version >nul 2>&1 && set "ANTIGO=%*"
exit /b 0

:erro
echo.
echo O IHchat parou com erro. Leia as mensagens acima.
echo.
pause
popd
exit /b 1

:python_antigo
echo.
echo O IHchat precisa do Python 3.10 ou mais novo. O desta maquina e:
%ANTIGO% --version
echo.
echo   1. Baixe o instalador atual em https://www.python.org/downloads/
echo   2. Na primeira tela do instalador, marque "Add python.exe to PATH".
echo   3. Terminada a instalacao, feche esta janela e de dois cliques no iniciar.bat de novo.
echo.
pause
popd
exit /b 1

:sem_python
echo.
echo Nao encontrei o Python nesta maquina. O IHchat precisa do Python 3.10 ou mais novo.
echo.
echo   1. Baixe o instalador em https://www.python.org/downloads/
echo   2. Na primeira tela do instalador, marque "Add python.exe to PATH".
echo   3. Terminada a instalacao, feche esta janela e de dois cliques no iniciar.bat de novo.
echo.
pause
popd
exit /b 1

:fora_do_projeto
echo.
echo Nao encontrei a pasta scripts ao lado deste arquivo.
echo Se voce abriu o iniciar.bat de dentro do .zip, extraia o .zip inteiro primeiro
echo (botao direito no arquivo .zip, "Extrair tudo") e rode o iniciar.bat da pasta extraida.
echo.
pause
popd
exit /b 1
