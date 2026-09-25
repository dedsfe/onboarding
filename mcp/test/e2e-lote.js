/**
 * E2E da tela "Criar em lote" com a IA pelo MCP:
 * 1. Sobe o servidor MCP (stdio + WS numa porta própria)
 * 2. Abre o app headless com um carrossel modelo ({{fotos}} + {{hooks}})
 * 3. Na tela: escolhe fotos, escreve o pedido pra IA (3 carrosséis) e a saída
 * 4. Como cliente MCP: ver_pedido_lote → confere pedido + imagens
 * 5. gerar_lote com 3 textos → confere as 3 pastas na saída
 *
 * Pastas do teste vivem no sistema de arquivos privado do navegador (OPFS):
 * o seletor de pasta do Chrome não abre em modo headless.
 */
const { spawn } = require('child_process');
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

  await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e-lote', version: '1.0' } });
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  console.log('✓ MCP no ar');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => console.error('  [browser erro]', e.message));
  const url = `http://localhost:3000/?ponte=${PORTA_PONTE}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

  // Modelo: fundo {{fotos}} + texto {{hooks}}; tela limpa
  await page.evaluate(async () => {
    const frames = [{ id: 1, name: 'Post 1', format: 'ig-feed', x: 0, y: 0, w: 1080, h: 1350, bg: '#111111', bgBind: 'fotos', children: [
      { id: 1, type: 'text', x: 90, y: 900, w: 900, text: 'Hook de exemplo', fontSize: 72, color: '#ffffff', bind: 'hooks' }] }];
    localStorage.setItem('tcm_canvas_v1', JSON.stringify({ cam: { x: 200, y: 100, scale: 0.4 }, frames, links: [] }));
    await new Promise(r => { const d = indexedDB.deleteDatabase('tcm-batch-workflow'); d.onsuccess = d.onerror = d.onblocked = r; });
    const opfs = await navigator.storage.getDirectory();
    for (const n of ['e2e-fotos', 'e2e-saida']) await opfs.removeEntry(n, { recursive: true }).catch(() => {});
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__tcmPonteStatus && window.__tcmPonteStatus().conectada, null, { timeout: 15000 });
  console.log('✓ app aberto e ponte conectada');

  // Pastas falsas no OPFS + seletor de pasta trocado por elas
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    const fotos = await opfs.getDirectoryHandle('e2e-fotos', { create: true });
    const cores = ['#e63946', '#2a9d8f', '#e9c46a'];
    for (let i = 0; i < cores.length; i++) {
      const c = document.createElement('canvas'); c.width = 400; c.height = 500;
      const x = c.getContext('2d'); x.fillStyle = cores[i]; x.fillRect(0, 0, 400, 500);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const fh = await fotos.getFileHandle(`foto-${i + 1}.png`, { create: true });
      const w = await fh.createWritable(); await w.write(blob); await w.close();
    }
    const saida = await opfs.getDirectoryHandle('e2e-saida', { create: true });
    window.showDirectoryPicker = async (o) => (o && o.id === 'tcm-saida' ? saida : fotos);
  });

  await page.click('#canvas-batch-btn');
  await page.click('text=Escolher pasta de fotos');
  await page.click('text=Pedir pra IA escrever');
  await page.fill('.bw-textarea', 'Hooks curtos sobre produtividade para quem trabalha em casa. Tom direto.');
  await page.fill('.bw-qty', '3');
  await page.click('.bw-brief >> text=Pronto');
  await page.click('text=Escolher saída');
  await page.waitForSelector('.bw-go:has-text("Esperando a IA")', { timeout: 5000 }).catch(() => {});
  const botao = await page.textContent('.bw-go');
  if (!/Esperando a IA/.test(botao)) fail(`botão deveria esperar a IA, veio "${botao}"`);
  console.log('✓ tela pronta: fotos + pedido + saída');

  const pedido = await tool('ver_pedido_lote');
  if (pedido.isError) fail('ver_pedido_lote: ' + JSON.stringify(pedido.content));
  const info = JSON.parse(pedido.content[0].text);
  const imagens = pedido.content.filter(c => c.type === 'image').length;
  if (!/produtividade/.test(info.pedido || '')) fail('pedido não veio: ' + info.pedido);
  if (info.quantidade !== 3) fail('quantidade deveria ser 3, veio ' + info.quantidade);
  if (!info.pronto) fail('deveria estar pronto, falta: ' + info.faltando);
  if (imagens < 4) fail(`esperava modelo + 3 fotos como imagem, vieram ${imagens}`);
  console.log(`✓ ver_pedido_lote: pedido, quantidade ${info.quantidade}, ${imagens} imagens, variável {{${info.variavel_de_texto}}}`);

  const gerado = await tool('gerar_lote', { textos: ['Trabalhe menos, entregue mais', 'Seu sofá não é escritório', 'O truque dos 25 minutos'] });
  if (gerado.isError) fail('gerar_lote: ' + gerado.content[0].text);
  console.log('✓ gerar_lote:', gerado.content[0].text);

  const pastas = await page.evaluate(async () => {
    const saida = await (await navigator.storage.getDirectory()).getDirectoryHandle('e2e-saida');
    const r = [];
    for await (const e of saida.values()) {
      const fs = []; for await (const f of e.values()) fs.push(f.name);
      r.push(`${e.name}/${fs.join(',')}`);
    }
    return r.sort();
  });
  if (pastas.length !== 3) fail('esperava 3 carrosséis na saída, veio: ' + pastas.join(' | '));
  console.log('✓ saída:', pastas.join(' | '));

  await browser.close();
  mcp.kill();
  console.log('\n🎉 E2E lote OK');
  process.exit(0);
}

main().catch((e) => fail(e.stack || e.message));
