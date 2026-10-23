// Testes do que deixa o dono independente (nucleo/painel-dono.php), chamados do fim do scripts/testar-api-contas.mjs
// (o PHP das contas, com o Z-API falso e os Avisos ligados):
// - admin-pronto e admin-pronto-salvar: as chaves, a cópia de segurança anotada pelo admin-backup, o "pular" de cada item
//   da lista do Resumo (só os que existem, com a Atividade), o liga/desliga da senha pelo WhatsApp da loja, CSRF e Origin;
//   gerente e atendente levam 403 (o "cada papel em cada rota" das contas confere pelo mapa);
// - a senha do dono pelo WhatsApp da loja (admin-recuperar-codigo e -entrar): sem Origin, desligada, a resposta igual pra
//   login que existe, que não existe e que não é de dono (e só o dono recebe a mensagem, no WhatsApp da loja), 1 por
//   minuto, 3 por hora por login, 5 por hora por IP, código só com hash no banco, chute errado conta e no 5º o código
//   morre, vence em 10 minutos, vale uma vez, troca a senha, derruba as sessões do dono, o grupo da loja fica sabendo e a
//   Atividade conta.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export async function testarDono(t) {
  const { parte, ok, igual, erro, novo, dono, falso, dados, PHP, AGORA, esperar } = t
  const ler = (q) => JSON.parse(execFileSync(PHP, ['-r', `$d=new PDO('sqlite:${join(dados, 'loja.sqlite')}');echo json_encode($d->query(${JSON.stringify(q)})->fetchAll(PDO::FETCH_ASSOC));`], { encoding: 'utf8' }))
  const LOJA = '5533991139036'
  const paraLoja = () => falso.recebidos.filter((x) => JSON.parse(x.corpo || '{}').phone === LOJA)
  const codigoDe = (x) => /\*(\d{6})\*/.exec(JSON.parse(x?.corpo ?? '{}').message ?? '')?.[1] ?? null

  parte('dono: a lista "Pra deixar a loja pronta" e a cópia de segurança')
  {
    const p = await dono.get('admin-pronto')
    igual(p.status, 200, 'admin-pronto responde pro dono')
    igual(Object.keys(p.json ?? {}).filter((k) => k !== 'ok').sort(), ['agora', 'avisos', 'copia', 'equipe', 'instaladoEm', 'outrosDonos', 'pulados', 'recuperacao', 'senhaTrocada'], 'Pronto com as chaves do contrato')
    igual([p.json.senhaTrocada, p.json.avisos.ligado, p.json.copia.ultimaEm, p.json.pulados], [false, true, null, []], 'senha da instalação, avisos ligados, nenhuma cópia, nada pulado')
    ok(p.json.equipe >= 2, `a equipe conta os outros acessos ativos (${p.json.equipe})`)
    igual(p.json.recuperacao, { disponivel: true, ligado: true, para: '(33) 9••••-9036' }, 'a senha pelo WhatsApp da loja tá valendo, com o número mascarado')
    erro(await dono.post('admin-pronto-salvar', { pular: { item: 'equipe', pular: true } }, { csrf: null }), 403, 'csrf', 'salvar sem o X-CSRF')
    erro(await dono.post('admin-pronto-salvar', { pular: { item: 'equipe', pular: true } }, { origem: 'https://golpe.example' }), 403, 'origem', 'salvar com Origin de fora')
    erro(await dono.post('admin-pronto-salvar', { pular: { item: 'qualquer', pular: true } }), 400, 'invalido', 'pular item que não existe')
    erro(await dono.post('admin-pronto-salvar', { pular: { item: 'equipe', pular: 'sim' } }), 400, 'invalido', 'pular que não é sim ou não')
    erro(await dono.post('admin-pronto-salvar', { recuperarPeloWhatsapp: 1 }), 400, 'invalido', 'liga/desliga que não é sim ou não')
    const pul = await dono.post('admin-pronto-salvar', { pular: { item: 'equipe', pular: true } })
    igual([pul.status, pul.json?.pulados], [200, ['equipe']], 'pulou "Cadastrar a equipe" (devolve o Pronto de novo)')
    igual((await dono.post('admin-pronto-salvar', { pular: { item: 'equipe', pular: true } })).json?.pulados, ['equipe'], 'pular de novo não repete')
    ok((await dono.get('admin-eventos')).json.eventos.some((x) => x.acao === 'pronto-pulou' && /Pra deixar a loja pronta.*Cadastrar a equipe/.test(x.texto)), 'o pular na Atividade')
    igual((await dono.post('admin-pronto-salvar', { pular: { item: 'equipe', pular: false } })).json?.pulados, [], 'voltou pra lista')
    const b = await dono.get('admin-backup')
    ok(b.status === 200 && /greencheese-loja-\d{4}-\d{2}-\d{2}-\d{4}\.sqlite/.test(b.headers.get('content-disposition') ?? ''), 'baixou a cópia')
    const depois = (await dono.get('admin-pronto')).json
    ok(Math.abs(Date.parse(depois.copia.ultimaEm) / 1000 - Date.now() / 1000) < 120, `a cópia de agora fica anotada (${depois.copia.ultimaEm})`)
    ok((await dono.get('admin-eventos')).json.eventos.some((x) => x.acao === 'backup-baixado' && x.texto === 'Baixou a cópia de segurança'), 'a cópia na Atividade')
    const des = await dono.post('admin-pronto-salvar', { recuperarPeloWhatsapp: false })
    igual(des.json?.recuperacao?.ligado, false, 'desligou a senha pelo WhatsApp')
    igual((await novo().get('admin-sessao')).json?.recuperarPeloWhatsapp, false, 'admin-sessao: a 2ª via não vale (sem dizer nada de login)')
    erro(await novo().post('admin-recuperar-codigo', { login: 'dono' }), 409, 'sem-whatsapp', 'pedir o código com a 2ª via desligada')
    ok((await dono.get('admin-eventos')).json.eventos.some((x) => x.acao === 'recuperacao-whatsapp' && /Desligou/.test(x.texto)), 'desligar na Atividade')
    await dono.post('admin-pronto-salvar', { recuperarPeloWhatsapp: true })
    igual((await novo().get('admin-sessao')).json?.recuperarPeloWhatsapp, true, 'religada: o admin-sessao diz que vale')
  }

  parte('dono: a senha pelo WhatsApp da loja')
  {
    // cada bloco numa hora própria do relógio de teste (o limite da loja inteira é de 10 por hora)
    const H = (n) => AGORA + 40 * 86400 + n * 7200
    erro(await novo().post('admin-recuperar-codigo', { login: 'dono' }, { origem: null, agora: H(0) }), 403, 'origem', 'sem Origin')
    erro(await novo().post('admin-recuperar-codigo', { login: '' }, { agora: H(0) }), 400, 'invalido', 'sem login')
    // a resposta é a mesma pra login de dono, que não existe e de gerente; só o dono recebe a mensagem
    const antes = paraLoja().length
    const rDono = await novo().post('admin-recuperar-codigo', { login: 'dono' }, { agora: H(0) })
    const rNada = await novo().post('admin-recuperar-codigo', { login: 'ninguem.aqui' }, { agora: H(0) })
    const rGer = await novo().post('admin-recuperar-codigo', { login: 'gerente.mg' }, { agora: H(0) })
    const forma = (r) => [r.status, Object.keys(r.json ?? {}).sort().join(), r.json?.mensagem, r.json?.para]
    igual(forma(rNada), forma(rDono), 'login que não existe: a mesma resposta do dono')
    igual(forma(rGer), forma(rDono), 'login de gerente: a mesma resposta')
    igual(rDono.status, 200, 'pediu o código')
    ok(/WhatsApp da loja \(\(33\) 9••••-9036\)/.test(rDono.json?.mensagem ?? ''), `diz pra onde vai, mascarado (${rDono.json?.mensagem})`)
    await esperar(() => paraLoja().length > antes)
    await new Promise((r) => setTimeout(r, 400))
    const msgs = paraLoja().slice(antes)
    igual(msgs.length, 1, 'só uma mensagem saiu (a do dono)')
    const msg = JSON.parse(msgs[0]?.corpo ?? '{}').message ?? ''
    ok(/^\*\d{6}\* é o código pra trocar a senha do painel/.test(msg) && /@dono/.test(msg) && /Vale por 10 minutos/.test(msg) && /Se não foi tu que pediu, ignora/.test(msg), 'a mensagem: o código, o login, a validade e o "se não foi tu"')
    const cod1 = codigoDe(msgs[0])
    const linhas = ler('SELECT codigo_hash, tentativas, usado_em FROM painel_codigos')
    ok(linhas.length >= 1 && linhas.every((x) => /^[0-9a-f]{64}$/.test(x.codigo_hash) && x.codigo_hash !== cod1), 'no banco só o hash do código')
    ok(ler("SELECT id FROM avisos_envios WHERE tipo = 'codigo-senha'").length >= 1 && !ler("SELECT texto FROM avisos_envios WHERE tipo = 'codigo-senha'").some((x) => x.texto.includes(cod1)), 'o histórico dos avisos não guarda o código')
    // 1 por minuto, 3 por hora por login
    erro(await novo().post('admin-recuperar-codigo', { login: 'dono' }, { agora: H(0) + 30 }), 429, 'muitas-tentativas', '2º pedido no mesmo minuto')
    igual((await novo().post('admin-recuperar-codigo', { login: 'dono' }, { agora: H(0) + 70 })).status, 200, 'passou 1 minuto: pede de novo')
    igual((await novo().post('admin-recuperar-codigo', { login: 'dono' }, { agora: H(0) + 140 })).status, 200, '3º na hora')
    erro(await novo().post('admin-recuperar-codigo', { login: 'dono' }, { agora: H(0) + 210 }), 429, 'muitas-tentativas', '4º na hora (3 por hora por login)')
    erro(await novo().post('admin-recuperar-codigo', { login: 'NINGUEM.AQUI ' }, { agora: H(0) + 30 }), 429, 'muitas-tentativas', 'o login que não existe tem o mesmo limite (não dá pra descobrir pelo limite)')
    // 5 por hora por IP
    const mesmoIp = novo()
    const rs = []
    for (let i = 0; i < 6; i++) rs.push((await mesmoIp.post('admin-recuperar-codigo', { login: `login.${i}` }, { agora: H(1) + i })).status)
    igual(rs, [200, 200, 200, 200, 200, 429], '5 por hora por IP')

    // usar o código
    await esperar(() => paraLoja().length > antes + 2)
    await new Promise((r) => setTimeout(r, 300))
    const ultimo = codigoDe(paraLoja().at(-1))
    const quem = novo()
    erro(await quem.post('admin-recuperar-codigo-entrar', { login: 'dono', codigo: ultimo, senha: 'curta' }, { agora: H(0) + 300 }), 400, 'invalido', 'senha nova curta (não gasta o código)')
    erro(await quem.post('admin-recuperar-codigo-entrar', { login: 'dono', codigo: '12', senha: 'senha-nova-do-dono' }, { agora: H(0) + 300 }), 400, 'invalido', 'código que não tem 6 números')
    const errado = ultimo === '000000' ? '111111' : '000000'
    const e1 = await quem.post('admin-recuperar-codigo-entrar', { login: 'dono', codigo: errado, senha: 'senha-nova-do-dono' }, { agora: H(0) + 300 })
    erro(e1, 403, 'codigo-invalido', 'código errado')
    const eNada = await novo().post('admin-recuperar-codigo-entrar', { login: 'ninguem.aqui', codigo: ultimo, senha: 'senha-nova-do-dono' }, { agora: H(0) + 300 })
    igual([eNada.status, eNada.json?.erro, eNada.json?.mensagem], [e1.status, e1.json?.erro, e1.json?.mensagem], 'login que não existe: a mesma resposta do código errado')
    erro(await novo().post('admin-recuperar-codigo-entrar', { login: 'dono', codigo: cod1, senha: 'senha-nova-do-dono' }, { agora: H(0) + 300 }), 403, 'codigo-invalido', 'o código de antes parou de valer (só o último vale)')
    // mais 3 erros: no 5º chute o código morre, nem o certo entra depois
    for (let i = 0; i < 3; i++) await novo().post('admin-recuperar-codigo-entrar', { login: 'dono', codigo: errado, senha: 'senha-nova-do-dono' }, { agora: H(0) + 301 + i })
    erro(await novo().post('admin-recuperar-codigo-entrar', { login: 'dono', codigo: ultimo, senha: 'senha-nova-do-dono' }, { agora: H(0) + 310 }), 403, 'codigo-invalido', '5 chutes errados: o código certo não vale mais')

    // vence em 10 minutos
    const antes2 = paraLoja().length
    igual((await novo().post('admin-recuperar-codigo', { login: 'dono' }, { agora: H(2) })).status, 200, 'código novo')
    await esperar(() => paraLoja().length > antes2)
    const cod2 = codigoDe(paraLoja().at(-1))
    erro(await novo().post('admin-recuperar-codigo-entrar', { login: 'dono', codigo: cod2, senha: 'senha-nova-do-dono' }, { agora: H(2) + 601 }), 403, 'codigo-invalido', 'passou de 10 minutos: venceu')

    // o certo, no prazo: troca a senha, entra, derruba as sessões do dono e avisa o grupo
    const antes3 = falso.recebidos.length
    const antes4 = paraLoja().length
    igual((await novo().post('admin-recuperar-codigo', { login: 'dono' }, { agora: H(3) })).status, 200, 'mais um código')
    await esperar(() => paraLoja().length > antes4)
    const cod3 = codigoDe(paraLoja().at(-1))
    igual((await dono.get('admin-resumo')).status, 200, 'a sessão do dono vale antes de trocar')
    const certo = novo()
    const ent = await certo.post('admin-recuperar-codigo-entrar', { login: 'DONO ', codigo: ` ${cod3.slice(0, 3)} ${cod3.slice(3)} `, senha: 'senha-nova-do-dono' }, { agora: H(3) + 60 })
    igual([ent.status, ent.json?.usuario?.login, ent.json?.usuario?.papel, typeof ent.json?.csrf], [200, 'dono', 'dono', 'string'], 'o código certo troca a senha e entra (login com maiúscula/espaço, código com espaço)')
    igual((await certo.get('admin-resumo')).status, 200, 'a sessão nova entra no painel')
    erro(await dono.get('admin-resumo'), 401, 'sem-sessao', 'as sessões de antes do dono caíram')
    erro(await novo().post('admin-recuperar-codigo-entrar', { login: 'dono', codigo: cod3, senha: 'outra-senha-nova-1' }, { agora: H(3) + 70 }), 403, 'codigo-invalido', 'o código vale uma vez')
    erro(await novo().post('admin-entrar', { login: 'dono', senha: 'senha-forte-123' }), 401, 'credenciais', 'a senha velha não entra mais')
    const nova = await dono.post('admin-entrar', { login: 'dono', senha: 'senha-nova-do-dono' })
    igual(nova.status, 200, 'a senha nova entra')
    const ev = (await dono.get('admin-eventos')).json.eventos
    ok(ev.some((x) => x.acao === 'senha-codigo-pedido' && x.usuario === 'dono') && ev.some((x) => x.acao === 'senha-recuperada-whatsapp' && x.texto === 'Senha nova com o código do WhatsApp da loja'), 'o pedido e a troca na Atividade')
    await esperar(() => falso.recebidos.slice(antes3).some((x) => /SENHA DO PAINEL TROCADA/.test(JSON.parse(x.corpo || '{}').message ?? '')))
    const aviso = falso.recebidos.slice(antes3).find((x) => /SENHA DO PAINEL TROCADA/.test(JSON.parse(x.corpo || '{}').message ?? ''))
    ok(!!aviso && JSON.parse(aviso.corpo).phone === '120363012345678901-group', 'o grupo da loja fica sabendo da troca')
    igual((await dono.get('admin-pronto')).json?.senhaTrocada, true, 'a lista do Resumo vê a senha trocada')

    // gerente e atendente não recebem (o dono gera a provisória em Equipe)
    const antes5 = paraLoja().length
    await novo().post('admin-recuperar-codigo', { login: 'atende.rj' }, { agora: H(4) })
    await new Promise((r) => setTimeout(r, 800))
    igual(paraLoja().length, antes5, 'atendente: nenhuma mensagem sai')
    // avisos desligados: a 2ª via some
    await dono.post('admin-avisos-salvar', { motor: 'nenhum' })
    igual((await novo().get('admin-sessao')).json?.recuperarPeloWhatsapp, false, 'avisos desligados: a 2ª via não vale')
    erro(await novo().post('admin-recuperar-codigo', { login: 'dono' }, { agora: H(5) }), 409, 'sem-whatsapp', 'avisos desligados: pedir o código dá 409')
    igual((await dono.get('admin-pronto')).json?.recuperacao?.disponivel, false, 'a Conta mostra que precisa dos Avisos')
  }
}
