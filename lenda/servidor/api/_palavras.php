<?php
/**
 * LENDA · lista do filtro de apelidos e nomes de jogador (palavrões, ofensas raciais e homofóbicas, termos de
 * ódio) e dos nomes reservados. Nunca é servido (o .htaccess nega _*.php e, se ele falhar, a linha abaixo
 * responde 404). Quem usa: textoProibido() em _lib.php.
 *
 * Tudo aqui já está NORMALIZADO como o filtro compara: minúsculo, sem acento, só letras a-z (o filtro troca
 * 4/@→a, 3→e, 1/!→i, 0→o, 5/$→s, 7→t, junta letras repetidas e tira o "s" do fim ao comparar palavra inteira).
 *
 * - `inteiras`: só quando é a palavra inteira (ou o apelido inteiro soletrado, "p.u.t.a"). Aqui ficam as curtas
 *   ou as que aparecem dentro de palavras comuns ("puta" está em "disputa", "cu" em "Cuiabá", "rola" em
 *   "controla", "bicha" em "bichano", "pica" em "picanha").
 * - `coladas`: valem em qualquer lugar do texto sem espaço ("filhodaputa", "vaitomarnocu", "M4c4c0L0k0"). Só
 *   as que não aparecem dentro de palavra comum do português.
 * - `reservadas_*`: nomes que parecem da equipe do jogo (o apelido não pode fingir ser o suporte).
 *
 * Para incluir uma palavra: escreva normalizada; se ela aparece dentro de alguma palavra comum, vai em
 * `inteiras`; senão, em `coladas`. Rode o teste (servidor/teste/rodar.sh): ele confere apelidos comuns que
 * NÃO podem ser barrados (nomes de clubes e de jogadores).
 */
declare(strict_types=1);

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string) $_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    http_response_code(404);
    exit;
}

return [
    'inteiras' => [
        // palavrões e baixo calão
        'cu', 'cuzao', 'cusao', 'cuzinho', 'puta', 'putinha', 'putona', 'putaria', 'puteiro', 'porra', 'caralho',
        'karalho', 'krl', 'crl', 'merda', 'bosta', 'foda', 'foder', 'fuder', 'fodase', 'fodasse', 'fodido', 'fodida',
        'fudido', 'fudida', 'buceta', 'boceta', 'bct', 'xota', 'xoxota', 'xereca', 'pica', 'piroca', 'pirocao', 'rola',
        'rolao', 'caceta', 'cacete', 'pentelho', 'punheta', 'punheteiro', 'siririca', 'boquete', 'arrombado',
        'arrombada', 'fdp', 'pqp', 'vsf', 'vtnc', 'tnc', 'tmnc', 'pnc', 'desgracado', 'desgracada', 'prostituta',
        'meretriz', 'vagabundo', 'vagabunda', 'vadia', 'biscate', 'corno', 'cornudo', 'escroto', 'escrota',
        // ofensas
        'otario', 'babaca', 'imbecil', 'idiota', 'cretino', 'retardado', 'retardada', 'mongoloide',
        // estupro, pedofilia
        'estupro', 'estuprador', 'estupradora', 'pedofilo', 'pedofila', 'pedofilia',
        // ofensas raciais e de origem
        'macaco', 'macaca', 'crioulo', 'crioula', 'nigger', 'nigga', 'negrada', 'chink', 'gook', 'spic',
        // ofensas homofóbicas e transfóbicas
        'viado', 'veado', 'viadinho', 'viadao', 'bicha', 'bichona', 'bichinha', 'boiola', 'baitola', 'sapatao',
        'fanchona', 'traveco', 'marica', 'maricas', 'maricon', 'fag', 'faggot', 'tranny',
        // ódio e extremismo
        'nazi', 'nazista', 'nazismo', 'hitler', 'fuhrer', 'heil', 'siegheil', 'whitepower',
        // inglês e espanhol mais comuns
        'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bitch', 'asshole', 'cunt', 'pussy', 'whore', 'slut',
        'mierda', 'pendejo', 'cabron', 'culero', 'chinga', 'chingada',
    ],
    'coladas' => [
        'caralh', 'karalh', 'buceta', 'boceta', 'porra', 'merda', 'bosta', 'fodase', 'fodasse', 'fodid', 'fudid',
        'punhet', 'siriric', 'xoxota', 'xereca', 'piroca', 'arrombad', 'filhodaput', 'filhadaput', 'fiadaput',
        'putaquepariu', 'putaqpariu', 'puteiro', 'vagabund', 'cuzao', 'cuzinh', 'tomarnocu',
        'tomanocu', 'paunocu', 'viadinh', 'viadao', 'boiola', 'baitola', 'sapatao', 'traveco', 'macaco', 'crioul',
        'nazista', 'hitler', 'siegheil', 'whitepower', 'nigger', 'nigga', 'faggot', 'motherfuck', 'fuck', 'bitch',
        'estupr', 'pedofil', 'retardad', 'mongoloid', 'escrot', 'babaca', 'imbecil', 'desgracad',
    ],
    'reservadas_inteiras' => [
        'adm', 'admin', 'administrador', 'administradora', 'moderador', 'moderadora', 'moderacao', 'lenda',
        'oficial', 'suporte', 'staff',
    ],
    'reservadas_coladas' => [
        'admin', 'moderador', 'oficial', 'suporte',
    ],
];
