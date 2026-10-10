<?php
declare(strict_types=1);
defined('GC_API') || exit;

// Rateios de exemplo, semeados na instalação: os mesmos do site sem servidor (demo, contadores em 0).
// Produtos de exemplo do catalogo.json; preços de exemplo. O dono apaga quando quiser (demo sempre pode apagar).

/** @return list<array<string, mixed>> */
function gc_exemplos(): array
{
    return [
        [
            'id' => 'arizona-green-tea',
            'titulo' => 'Arizona Green Tea 680 ml',
            'descricao' => 'Chá verde gelado da AriZona, na lata alta de 680 ml. Importado.',
            'produto_id' => 'arizona-green-tea',
            'preco_rateio' => 1490,
            'preco_depois' => 1990,
            'vagas' => 24,
            'limite_por_pessoa' => 6,
            'ufs' => 'rj,mg,sp,es',
        ],
        [
            'id' => 'dichavador-metal-4-partes',
            'titulo' => 'Dichavador de metal 4 partes 55 mm',
            'descricao' => 'Metal, 55 mm, 4 partes e com peneira.',
            'produto_id' => 'dichavador-metal-4-partes',
            'preco_rateio' => 4490,
            'preco_depois' => 5990,
            'vagas' => 10,
            'limite_por_pessoa' => 2,
            'ufs' => 'mg,sp,es,sc',
        ],
    ];
}

function gc_semear_exemplos(): void
{
    $agora = gc_agora();
    foreach (gc_exemplos() as $e) {
        if (gc_rateio_linha($e['id']) !== null) {
            continue;
        }
        gc_sql(
            "INSERT INTO rateios (id, titulo, descricao, produto_id, imagem, preco_rateio, preco_depois, vagas, limite_por_pessoa, ufs,
               status, previsao_min, previsao_max, fecha_em, reserva_horas, demo, criado_em, atualizado_em, aberto_em)
             VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'aberto', 6, 10, NULL, 24, 1, ?, ?, ?)",
            [
                $e['id'], $e['titulo'], $e['descricao'], $e['produto_id'], $e['preco_rateio'], $e['preco_depois'],
                $e['vagas'], $e['limite_por_pessoa'], $e['ufs'], $agora, $agora, $agora,
            ],
        );
        gc_evento('sistema', 'rateio-exemplo', 'rateio:' . $e['id'], ['titulo' => $e['titulo']]);
    }
}
