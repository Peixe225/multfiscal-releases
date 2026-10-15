<?php
// Gera o código de instalação do painel: mostra o código UMA vez e grava só o hash em public/api/instalacao.php.
// Uso: php scripts/codigo-instalacao.php [arquivo-de-saída]   (sem argumento, reescreve public/api/instalacao.php)
// Depois: npm run build, publicar (o publicar.mjs recusa o hash de desenvolvimento) e passar o código ao dono por um
// canal seguro. Cada código vale uma vez: instala o painel ou, se o dono esquecer a senha, troca a senha dele.
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit;
}

// sem os que confundem: 0/o, 1/l/i
const ALFABETO = '23456789abcdefghjkmnpqrstuvwxyz';

$grupos = [];
for ($g = 0; $g < 4; $g++) {
    $grupo = '';
    for ($i = 0; $i < 5; $i++) {
        $grupo .= ALFABETO[random_int(0, strlen(ALFABETO) - 1)];
    }
    $grupos[] = $grupo;
}
$codigo = implode('-', $grupos);

// o servidor confere só letras e números minúsculos (tanto faz digitar com traço, espaço ou maiúscula)
$hash = password_hash(str_replace('-', '', $codigo), PASSWORD_DEFAULT, ['cost' => 11]);
$destino = $argv[1] ?? dirname(__DIR__) . '/public/api/instalacao.php';
$quando = gmdate('Y-m-d H:i') . ' UTC';

$conteudo = <<<PHP
<?php
// Código de instalação do painel: aqui fica SÓ o hash (o código nunca é guardado).
// Gerado por scripts/codigo-instalacao.php em {$quando}. Para trocar, rode o script de novo.
defined('GC_API') || exit;

return '{$hash}';

PHP;

if (file_put_contents($destino, $conteudo) === false) {
    fwrite(STDERR, "não deu pra gravar $destino\n");
    exit(1);
}

echo "Código de instalação (anote agora, ele não fica guardado em lugar nenhum):\n\n    $codigo\n\n";
echo "Hash gravado em $destino\n";
