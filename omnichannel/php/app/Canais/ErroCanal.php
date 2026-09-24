<?php
declare(strict_types=1);

namespace OmniChannel\Canais;

/**
 * Falha ao falar com o provedor (rede, credencial, formato).
 *
 * A mensagem é uma frase para a tela: vira o "erro" de uma mensagem que
 * falhou ou o resultado de "Testar conexão". Nunca leva token nem senha.
 */
class ErroCanal extends \RuntimeException
{
}
