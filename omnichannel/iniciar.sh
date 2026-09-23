#!/bin/sh
# Sobe o OmniChannel 2 no Linux e no macOS: ./iniciar.sh
# Opções: --porta 9000, --sem-navegador, --sem-demo (veja scripts/iniciar.py).

# o lançador resolve tudo a partir da pasta do projeto, de onde quer que o
# script tenha sido chamado
cd "$(dirname "$0")" || exit 1

# python3 pode ser um 3.8 do sistema com um 3.11 instalado ao lado (Ubuntu
# antigo, python.org no macOS): fica com o primeiro que atende
for candidato in python3 python3.15 python3.14 python3.13 python3.12 python3.11 python3.10; do
    if command -v "$candidato" >/dev/null 2>&1 &&
        "$candidato" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
        exec "$candidato" scripts/iniciar.py "$@"
    fi
done

# Nenhum atende. A explicação sai daqui e não do iniciar.py: um python3 3.5
# (Debian 9, Ubuntu 16.04) nem consegue ler aquele arquivo e mostraria um
# SyntaxError no lugar de "instale o 3.10".
if command -v python3 >/dev/null 2>&1; then
    echo "O OmniChannel 2 precisa do Python 3.10 ou mais novo. O python3 desta máquina: $(python3 --version 2>&1)" >&2
else
    echo "Não encontrei o Python 3 nesta máquina. O OmniChannel 2 precisa do 3.10 ou mais novo." >&2
fi
echo "  Ubuntu/Debian: sudo apt install python3 python3-venv" >&2
echo "  Fedora:        sudo dnf install python3" >&2
echo "  macOS:         brew install python  (ou o instalador de https://www.python.org/downloads/)" >&2
echo "  Distribuição antiga, sem Python 3.10 nos pacotes: https://www.python.org/downloads/ ou pyenv" >&2
exit 1
