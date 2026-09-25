/**
 * E2E da tela "Criar em lote" com a IA pelo MCP — sem nenhum post no canvas:
 * 1. Sobe o servidor MCP (stdio + WS numa porta própria)
 * 2. Abre o app headless com o canvas VAZIO
 * 3. Na tela: fotos → resultado desejado → "A IA decide" → 3 variações → saída
 * 4. Como cliente MCP, faz o que uma IA faria:
 *    ver_pedido_lote (sem molde) → criar_molde → ver_pedido_lote → ver_fotos_lote
 *    → ver_exemplo_lote → previsualizar_lote (com um texto que estoura)
 *    → gerar_lote com _foto, _legenda e _estilo
 * 5. Confere pastas, slides, legenda.txt e copys.csv na saída; depois o CSV.
 *
 * Pastas do teste vivem no sistema de arquivos privado do navegador (OPFS):
 * o seletor de pasta do Chrome não abre em modo headless.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const PORTA_PONTE = process.env.TCM_BRIDGE_PORT || '8767';
const ROOT = path.resolve(__dirname, '../..');

let mcpProc = null;
function fail(msg) {
  console.error('❌', msg);
  if (mcpProc) mcpProc.kill(); // senão o servidor fica preso na porta
  process.exit(1);
}

async function main() {
  const mcp = spawn('node', [path.join(ROOT, 'mcp/server.js')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, TCM_BRIDGE_PORT: PORTA_PONTE } });
  mcpProc = mcp;
  mcp.stderr.on('data', (d) => process.stderr.write('[mcp] ' + d));

  let buf = '';
  const pendentes = new Map();
  let seq = 1;
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = seq++;
    pendentes.set(id, { resolve, reject });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  mcp.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id && pendentes.has(msg.id)) {
        const p = pendentes.get(msg.id); pendentes.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      }
    }
  });
  const tool = (name, args = {}) => call('tools/call', { name, arguments: args });
  const textoDe = (r) => r.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  const imagensDe = (r) => r.content.filter(c => c.type === 'image').length;

  await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e-lote', version: '1.0' } });
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  console.log('✓ MCP no ar');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => console.error('  [browser erro]', e.message));
  await page.goto(`http://localhost:3000/?ponte=${PORTA_PONTE}`, { waitUntil: 'networkidle', timeout: 60000 });

  // Canvas vazio + estado do lote limpo
  await page.evaluate(async () => {
    localStorage.setItem('tcm_canvas_v1', JSON.stringify({ cam: { x: 200, y: 100, scale: 0.3 }, frames: [], links: [] }));
    await new Promise(r => { const d = indexedDB.deleteDatabase('tcm-batch-workflow'); d.onsuccess = d.onerror = d.onblocked = r; });
    const opfs = await navigator.storage.getDirectory();
    for (const n of ['e2e-fotos', 'e2e-saida', 'e2e-exemplos']) await opfs.removeEntry(n, { recursive: true }).catch(() => {});
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__tcmPonteStatus && window.__tcmPonteStatus().conectada, null, { timeout: 15000 });
  console.log('✓ app aberto (canvas vazio) e ponte conectada');

  // Pastas falsas no OPFS + seletor de pasta trocado por elas
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    const png = async (dir, nome, cor, texto, w = 400, h = 500) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = cor; x.fillRect(0, 0, w, h);
      if (texto) { x.fillStyle = '#fff'; x.font = 'bold 28px sans-serif'; x.fillText(texto, 30, h / 2); }
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const fh = await dir.getFileHandle(nome, { create: true });
      const w2 = await fh.createWritable(); await w2.write(blob); await w2.close();
    };
    const fotos = await opfs.getDirectoryHandle('e2e-fotos', { create: true });
    const cores = ['#e63946', '#2a9d8f', '#e9c46a'];
    for (let i = 0; i < cores.length; i++) await png(fotos, `foto-${i + 1}.png`, cores[i]);
    const exemplos = await opfs.getDirectoryHandle('e2e-exemplos', { create: true });
    for (const nome of ['exemplo-a', 'exemplo-b']) {
      const d = await exemplos.getDirectoryHandle(nome, { create: true });
      for (let i = 1; i <= 3; i++) await png(d, `slide-${i}.png`, '#222', `${nome} ${i}`, 320, 400);
    }
    const saida = await opfs.getDirectoryHandle('e2e-saida', { create: true });
    window.showDirectoryPicker = async (o) => (o && o.id === 'tcm-saida' ? saida : o && o.id === 'tcm-ref' ? exemplos : fotos);
  });

  // Tela: fotos → exemplos → A IA decide → 3 variações → saída
  await page.click('#canvas-batch-btn');
  await page.click('.bw-node--photos .bw-btn--primary');
  await page.waitForSelector('.bw-node--photos.is-done');
  await page.click('.bw-node--ref .bw-btn--primary');
  await page.waitForSelector('.bw-node--ref.is-done');
  await page.click('.bw-choice:has-text("A IA decide")');
  await page.click('.bw-brief >> text=Pronto');
  await page.fill('.bw-qty-big', '3');
  await page.click('.bw-node--qty >> text=OK');
  await page.waitForSelector('.bw-node--qty.is-done');
  await page.click('text=Escolher saída');
  await page.waitForSelector('.bw-node--out.is-done', { timeout: 5000 });
  console.log('✓ tela: fotos + exemplos + A IA decide + 3 variações + saída');

  // 1. Sem molde: o pedido avisa e a IA cria o molde pelos exemplos
  let pedido = await tool('ver_pedido_lote');
  let info = JSON.parse(pedido.content[0].text);
  if (info.molde !== null) fail('canvas vazio deveria dar molde null');
  if (!textoDe(pedido).includes('criar_molde')) fail('o playbook deveria mandar criar o molde');
  // Molde ruim de propósito (o caso da issue #19): story, texto branco sem
  // película, fonte minúscula colada no topo, texto preto em fundo preto
  const ruim = await tool('criar_molde', {
    nome: 'OD - Chorando POV', formato: 'ig-story',
    slides: [
      { fundo: { foto: 'foto', escurecer: 0 }, textos: [{ chave: 'hook', texto: 'POV', x: 80, y: 20, w: 920, tamanho: 30, cor: '#FFFFFF' }] },
      { fundo: { cor: '#000000' }, textos: [{ chave: 'corpo', texto: 'texto', x: 80, y: 900, w: 920, tamanho: 12, cor: '#111111' }] },
    ],
  });
  if (ruim.isError) fail('criar_molde (ruim): ' + textoDe(ruim));
  const revisao = textoDe(ruim);
  for (const esperado of ['hook com 30px', 'colado no topo', 'película de 0%', '12px ilegível', 'contraste']) {
    if (!revisao.includes(esperado)) fail(`revisão do molde deveria acusar "${esperado}" — veio:\n${revisao}`);
  }
  if (imagensDe(ruim) !== 2) fail('criar_molde deveria devolver 2 imagens, veio ' + imagensDe(ruim));
  console.log('✓ criar_molde (story ruim): revisão acusou contraste/tamanho/topo + 2 imagens');

  const molde = await tool('criar_molde', {
    nome: 'Molde da IA', formato: 'ig-feed',
    slides: [
      { fundo: { foto: 'foto', escurecer: 35 }, textos: [{ chave: 'hook', texto: 'Hook forte aqui', x: 80, y: 900, w: 920, tamanho: 84, peso: 800, cor: '#FFFFFF' }] },
      { fundo: { cor: '#111111' }, textos: [
        { chave: 'dica', texto: 'Título da dica', x: 80, y: 200, w: 920, tamanho: 64, peso: 800, cor: '#FFFFFF' },
        { chave: 'corpo', texto: 'Explicação curta da dica em duas linhas.', x: 80, y: 420, w: 920, tamanho: 40, peso: 500, cor: '#DDDDDD' }] },
    ],
  });
  if (molde.isError) fail('criar_molde: ' + textoDe(molde));
  console.log('✓ criar_molde:', textoDe(molde).split('.')[0]);
  const totalFrames = await page.evaluate(() => JSON.parse(localStorage.getItem('tcm_canvas_v1')).frames.length);
  if (totalFrames !== 2) fail('criar_molde de novo deveria substituir o molde anterior — canvas tem ' + totalFrames + ' frames');

  pedido = await tool('ver_pedido_lote');
  info = JSON.parse(pedido.content[0].text);
  const chaves = info.copys.map(c => c.chave).join(',');
  if (chaves !== 'hook,dica,corpo') fail('copys do molde deveriam ser hook,dica,corpo — vieram ' + chaves);
  if (info.quantidade !== 3) fail('variações deveriam ser 3, veio ' + info.quantidade);
  if (info.modo !== 'ia_decide') fail('modo deveria ser ia_decide');
  if (!info.pronto) fail('deveria estar pronto, falta: ' + info.faltando);
  if (!/PESQUISE O NICHO/.test(textoDe(pedido))) fail('playbook sem pesquisa de nicho');
  console.log(`✓ ver_pedido_lote: molde com ${chaves}, ${info.quantidade} variações, ${imagensDe(pedido)} imagens + playbook`);

  // 2. Fotos com índice e exemplo em alta
  const fotos = await tool('ver_fotos_lote', { pagina: 1 });
  if (imagensDe(fotos) !== 3 || !/#3 — foto-3\.png/.test(textoDe(fotos))) fail('ver_fotos_lote deveria listar 3 fotos com índice');
  const exemplo = await tool('ver_exemplo_lote', { carrossel: 2, slide: 3 });
  if (imagensDe(exemplo) !== 1 || !/exemplo-b/.test(textoDe(exemplo))) fail('ver_exemplo_lote não abriu o slide 3 do exemplo-b');
  console.log('✓ ver_fotos_lote (3 com índice) e ver_exemplo_lote (slide em alta)');

  // 3. Prévia: um carrossel certo e um que estoura
  const longo = 'Esse texto é gigante de propósito para passar do fim do slide '.repeat(25);
  const previa = await tool('previsualizar_lote', { textos: [
    { hook: 'Trabalhe menos, entregue mais', dica: 'Bloqueie a manhã', corpo: 'Sem reunião antes das 11h.', _foto: 2 },
    { hook: 'Seu sofá não é escritório', dica: 'Canto fixo', corpo: longo },
  ] });
  if (previa.isError) fail('previsualizar_lote: ' + textoDe(previa));
  const txtPrevia = textoDe(previa);
  if (!/Carrossel 1: ✓ tudo cabe/.test(txtPrevia)) fail('carrossel 1 deveria caber: ' + txtPrevia);
  if (!/Carrossel 2: ⚠️ corpo: passa do fim do slide/.test(txtPrevia)) fail('carrossel 2 deveria acusar o corpo estourando: ' + txtPrevia);
  if (imagensDe(previa) !== 4) fail('prévia deveria trazer 2 slides × 2 carrosséis');
  console.log('✓ previsualizar_lote: imagens + aviso de texto estourando');

  // 4. Gera as 3 variações com foto escolhida, legenda e estilo
  const gerado = await tool('gerar_lote', { textos: [
    { hook: 'Trabalhe menos, entregue mais', dica: 'Bloqueie a manhã', corpo: 'Sem reunião antes das 11h.', _foto: 3, _legenda: 'Teste 1 #produtividade' },
    { hook: 'Seu sofá não é escritório', dica: 'Tenha um canto fixo', corpo: 'O cérebro associa lugar a foco.', _foto: 1, _legenda: 'Teste 2 #homeoffice', _estilo: { corpo: { tamanho: 34 } } },
    { hook: 'O truque dos 25 minutos', dica: 'Pomodoro de verdade', corpo: '25 de foco, 5 de pausa, repete.', _foto: 'foto-2.png', _legenda: 'Teste 3 #foco' },
  ] });
  if (gerado.isError) fail('gerar_lote: ' + textoDe(gerado));
  console.log('✓ gerar_lote:', textoDe(gerado));

  const saida = await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('e2e-saida');
    const r = { pastas: [], csv: '' };
    for await (const e of dir.values()) {
      if (e.kind === 'file') { if (e.name === 'copys.csv') r.csv = await (await e.getFile()).text(); continue; }
      const fs = []; let legenda = '';
      for await (const f of e.values()) {
        fs.push(f.name);
        if (f.name === 'legenda.txt') legenda = await (await f.getFile()).text();
      }
      r.pastas.push({ nome: e.name, arquivos: fs.sort().join(','), legenda });
    }
    r.pastas.sort((a, b) => a.nome.localeCompare(b.nome));
    return r;
  });
  if (saida.pastas.length !== 3) fail('esperava 3 carrosséis na saída: ' + JSON.stringify(saida.pastas));
  if (!saida.pastas.every(p => p.arquivos === 'legenda.txt,slide-1.png,slide-2.png')) fail('cada carrossel deveria ter 2 slides + legenda: ' + JSON.stringify(saida.pastas));
  if (saida.pastas[1].legenda !== 'Teste 2 #homeoffice') fail('legenda errada: ' + saida.pastas[1].legenda);
  if (!/pasta,hook,dica,corpo,legenda/.test(saida.csv) || !/Teste 3 #foco/.test(saida.csv)) fail('copys.csv incompleto: ' + saida.csv.slice(0, 200));
  console.log('✓ saída:', saida.pastas.map(p => p.nome).join(' | '), '+ copys.csv');

  // 5. Caminho do CSV: 2 linhas, mas quem manda na quantidade é Variações (3)
  const csv = 'hook,dica,corpo\nHook do CSV 1,Título 1,Corpo 1\n"Hook, com vírgula",Título 2,Corpo 2\n';
  const csvPath = path.join(os.tmpdir(), 'tcm-e2e-copy.csv');
  fs.writeFileSync(csvPath, csv);
  await page.click('.bw-node--texts .bw-swap');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.bw-choice:has-text("CSV")')]);
  await chooser.setFiles(csvPath);
  await page.waitForSelector('.bw-go:has-text("Gerar 3 carrosséis")', { timeout: 5000 }).catch(() => {});
  const botaoCsv = (await page.textContent('.bw-go')).trim();
  if (!/Gerar 3 carrosséis/.test(botaoCsv)) fail('CSV + 3 variações deveria dar 3 carrosséis, botão: ' + botaoCsv);
  console.log('✓ CSV com colunas de copy + Variações: ' + botaoCsv);

  await browser.close();
  mcp.kill();
  console.log('\n🎉 E2E lote OK');
  process.exit(0);
}

main().catch((e) => fail(e.stack || e.message));
