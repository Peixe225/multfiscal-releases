"""Catálogo fixo de permissões e as perguntas "fulano pode X?".

O catálogo mora no código (não no banco): cada permissão é conferida por
alguma rota, então só existe a que o código conhece. Os cargos guardam
listas de chaves deste catálogo; o Administrador tem TODAS, sempre (inclusive
as que vierem em versões futuras), calculado aqui e não lido do banco. O mesmo
catálogo, na mesma ordem e com os mesmos rótulos, está em
php/app/Auth/Permissoes.php: GET /api/permissoes sai igual nos dois.

Hierarquia: cada cargo tem um nível (Administrador 100; os outros de 1 a 99).
Quem gerencia a equipe só mexe em quem tem nível MENOR que o seu e só concede
cargo de nível menor que o seu; o Administrador passa por cima das duas
regras (ver servicos/hierarquia.py).
"""
from __future__ import annotations

from collections.abc import Iterable

from fastapi import HTTPException, status

# chave -> (rótulo, grupo). A ordem é a da tela (grupos juntos).
CATALOGO: dict[str, tuple[str, str]] = {
    "equipe.ver": ("Ver a equipe", "Equipe"),
    "equipe.gerenciar": ("Gerenciar pessoas de cargo abaixo do seu (cadastrar, editar, desativar)", "Equipe"),
    "equipe.definir_cargo": ("Definir o cargo das pessoas", "Equipe"),
    "equipe.definir_setor": ("Definir o setor das pessoas", "Equipe"),
    "cargos.gerenciar": ("Criar e editar cargos e permissões", "Equipe"),
    "setores.gerenciar": ("Criar, renomear e desativar setores", "Equipe"),
    "canais.ver": ("Ver os canais", "Canais"),
    "canais.gerenciar": ("Cadastrar e configurar canais", "Canais"),
    "conversas.ver_todas": ("Ver todas as conversas", "Conversas"),
    "conversas.ver_setor": ("Ver as conversas do próprio setor", "Conversas"),
    "conversas.transferir": ("Transferir conversas para outra pessoa ou setor", "Conversas"),
    "conversas.resolver": ("Resolver conversas", "Conversas"),
    "conversas.reabrir": ("Reabrir conversas resolvidas", "Conversas"),
    "contatos.editar": ("Editar a ficha do contato", "Contatos"),
    "contatos.mesclar": ("Mesclar contatos", "Contatos"),
    "respostas.gerenciar": ("Criar e apagar respostas rápidas", "Catálogo"),
    "etiquetas.gerenciar": ("Criar e apagar etiquetas", "Catálogo"),
    "metricas.ver_todas": ("Ver as métricas de todo o atendimento", "Métricas"),
    "metricas.ver_setor": ("Ver as métricas do próprio setor", "Métricas"),
    "chat.criar_grupo": ("Criar grupos no chat da equipe", "Chat da equipe"),
    "chat.moderar": ("Moderar o chat da equipe (apagar mensagem de outros)", "Chat da equipe"),
    "simulador.usar": ("Usar o simulador de clientes", "Ferramentas"),
}

TODAS: list[str] = list(CATALOGO)
NIVEL_ADMINISTRADOR = 100
NIVEL_MAXIMO_OUTROS = 99

# chaves dos cargos de fábrica (coluna cargos.chave)
ADMINISTRADOR = "administrador"
GERENTE = "gerente"
LIDER = "lider"
CONFERENTE = "conferente"
COLABORADOR = "colaborador"

# Os cargos de fábrica como são criados pela migração (app/db.py), do mais
# alto ao mais baixo: os mesmos da migração PHP M20260925_1500_CargosESetores.
FABRICA: dict[str, tuple[str, int, list[str]]] = {
    ADMINISTRADOR: ("Administrador", 100, TODAS),
    GERENTE: ("Gerente", 80, [
        "equipe.ver", "equipe.gerenciar", "equipe.definir_cargo", "equipe.definir_setor",
        "setores.gerenciar", "canais.ver", "conversas.ver_todas", "conversas.ver_setor",
        "conversas.transferir", "conversas.resolver", "conversas.reabrir", "contatos.editar",
        "contatos.mesclar", "respostas.gerenciar", "etiquetas.gerenciar", "metricas.ver_todas",
        "metricas.ver_setor", "chat.criar_grupo", "chat.moderar", "simulador.usar",
    ]),
    LIDER: ("Líder", 60, [
        "equipe.ver", "equipe.gerenciar", "equipe.definir_cargo", "canais.ver",
        "conversas.ver_setor", "conversas.transferir", "conversas.resolver", "conversas.reabrir",
        "contatos.editar", "contatos.mesclar", "respostas.gerenciar", "etiquetas.gerenciar",
        "metricas.ver_setor", "chat.criar_grupo", "simulador.usar",
    ]),
    CONFERENTE: ("Conferente", 40, [
        "equipe.ver", "canais.ver", "conversas.ver_setor", "conversas.resolver", "conversas.reabrir",
        "contatos.editar", "metricas.ver_setor", "chat.criar_grupo",
    ]),
    COLABORADOR: ("Colaborador", 20, [
        "equipe.ver", "canais.ver", "conversas.resolver", "contatos.editar", "chat.criar_grupo",
    ]),
}


def existe(chave: str) -> bool:
    return chave in CATALOGO


def catalogo() -> list[dict]:
    """GET /api/permissoes: [{chave, rotulo, grupo}] na ordem do catálogo."""
    return [{"chave": chave, "rotulo": rotulo, "grupo": grupo} for chave, (rotulo, grupo) in CATALOGO.items()]


def ordenar(chaves: Iterable) -> list[str]:
    """Só as chaves do catálogo, sem repetição, na ordem do catálogo."""
    tem = {c for c in chaves if isinstance(c, str)}
    return [c for c in TODAS if c in tem]


def mensagem(permissao: str) -> str:
    """"sem permissão para ver os canais": a frase vem do rótulo do catálogo."""
    rotulo = CATALOGO.get(permissao, (permissao, ""))[0]
    return "sem permissão para " + rotulo[:1].lower() + rotulo[1:]


def tem(atendente, permissao: str) -> bool:
    return permissao in atendente.permissoes


def exigir(atendente, permissao: str) -> None:
    """403 se o atendente não tiver a permissão."""
    if not tem(atendente, permissao):
        raise HTTPException(status.HTTP_403_FORBIDDEN, mensagem(permissao))
