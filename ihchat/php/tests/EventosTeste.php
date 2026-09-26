<?php
declare(strict_types=1);

use IHchat\Banco\Banco;
use IHchat\Eventos\Eventos;
use IHchat\Nucleo\Datas;

return [
    'sem cursor devolve so o ultimo id' => function (): void {
        Eventos::publicar('conversa.atualizada', ['id' => 1]);
        $r = Eventos::desde(null);
        Afirmar::igual([], $r['eventos']);
        Afirmar::igual(1, $r['ultimo']);
    },
    'desde devolve em ordem e respeita limite' => function (): void {
        foreach (range(1, 5) as $i) {
            Eventos::publicar('mensagem.nova', ['id' => $i, 'vazio' => []], 10);
        }
        $r = Eventos::desde(0, 3);
        Afirmar::igual([1, 2, 3], array_column($r['eventos'], 'id'));
        Afirmar::igual(3, $r['ultimo']);
        $r = Eventos::desde(3);
        Afirmar::igual([4, 5], array_column($r['eventos'], 'id'));
        Afirmar::igual(['id' => 5, 'vazio' => []], $r['eventos'][1]['dados']);
        Afirmar::igual(5, Eventos::desde(5)['ultimo']);
    },
    'visitante so ve saida propria sem nota' => function (): void {
        Eventos::publicar('mensagem.nova', ['direcao' => 'saida', 'tipo' => 'texto', 'conteudo' => 'oi'], 7);
        Eventos::publicar('mensagem.nova', ['direcao' => 'saida', 'tipo' => 'nota_interna'], 7);
        Eventos::publicar('mensagem.nova', ['direcao' => 'entrada', 'tipo' => 'texto'], 7);
        Eventos::publicar('mensagem.nova', ['direcao' => 'saida', 'tipo' => 'texto'], 8);
        Eventos::publicar('conversa.atualizada', ['direcao' => 'saida'], 7);
        $r = Eventos::desdeDoVisitante(0, 7);
        Afirmar::igual([1], array_column($r['eventos'], 'id'));
        Afirmar::igual(5, $r['ultimo']);
    },
    'lacuna recente segura o cursor, antiga nao' => function (): void {
        Eventos::publicar('a', ['n' => 1]);
        Banco::inserir('fila_eventos', ['id' => 3, 'tipo' => 'b', 'dados' => '{}', 'contato_id' => null, 'criado_em' => Datas::agoraBanco()]);
        $r = Eventos::desde(1);
        Afirmar::igual([], $r['eventos'], 'lacuna recente');
        Afirmar::igual(1, $r['ultimo']);
        Datas::congelar(Datas::agora()->modify('+10 seconds'));
        $r = Eventos::desde(1);
        Afirmar::igual([3], array_column($r['eventos'], 'id'), 'lacuna antiga');
    },
    'poda apaga o que passou da retencao' => function (): void {
        Datas::congelar(new DateTimeImmutable('2026-01-01T00:00:00Z'));
        Eventos::publicar('velho', []);
        Datas::congelar(new DateTimeImmutable('2026-01-05T00:00:00Z'));
        Eventos::publicar('novo', []);
        Afirmar::igual(1, Eventos::podar());
        Afirmar::igual(['novo'], array_column(Eventos::desde(0)['eventos'], 'tipo'));
    },
];
