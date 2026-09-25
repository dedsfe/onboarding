/**
 * Teste E2E da ponte MCP — valida o pipeline completo sem humano:
 * 1. Sobe o servidor MCP (stdio + WS 8765)
 * 2. Abre o app num Chromium headless (a ponte conecta sozinha)
 * 3. Chama status_ponte e criar_posts via JSON-RPC no stdio
 * 4. Confere o .zip gerado em lotes/ e o estado do canvas
 *
 * Uso: node mcp/test/e2e-ponte.js
 */
const { spawn } = require('child_process');
// Porta própria: não briga com o MCP que o Claude Code já deixa ligado na 8765
const PORTA_PONTE = process.env.TCM_BRIDGE_PORT || '8766';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const LOTE_DIR = path.join(ROOT, 'lotes', 'teste-e2e');

function fail(msg) { console.error('❌', msg); process.exit(1); }

async function main() {
  // limpa execução anterior
  fs.rmSync(LOTE_DIR, { recursive: true, force: true });

  const mcp = spawn('node', [path.join(ROOT, 'mcp/server.js')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, TCM_BRIDGE_PORT: PORTA_PONTE } });
  mcp.stderr.on('data', (d) => process.stderr.write('[mcp] ' + d));

  // cliente JSON-RPC do MCP
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

  await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1.0' } });
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  console.log('✓ MCP no ar');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => { if (m.text().includes('tcm-ponte')) console.log('  [browser]', m.text()); });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.goto(`http://localhost:3000/?ponte=${PORTA_PONTE}`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => window.__tcmPonteStatus && window.__tcmPonteStatus().conectada, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__tcmCanvas && window.__tcmBatch, null, { timeout: 20000 });
  console.log('✓ app aberto e ponte conectada');

  const status = await call('tools/call', { name: 'status_ponte', arguments: {} });
  console.log('✓ status_ponte:', JSON.parse(status.content[0].text).canvas.cadeias.length, 'cadeia(s) inicial(is)');

  // criar_posts com 2 posts + 2 fundos locais (pngs já no repo)
  const fundos = [path.join(ROOT, 'kpi_card2.png'), path.join(ROOT, 'site_today_pure.png')];
  const res = await call('tools/call', {
    name: 'criar_posts',
    arguments: {
      nome: 'teste-e2e',
      template: 'quote_leadership',
      posts: [
        { frase_destaque: 'A ponte funciona de ponta a ponta', sub_frase: 'MCP + canvas + fundo trocado', principios_texto: 'Teste E2E do pipeline completo' },
        { frase_destaque: 'Segundo post com fundo diferente', sub_frase: 'Cada post com sua imagem', principios_texto: 'Teste E2E do pipeline completo' },
      ],
      fundos,
      limpar: true,
    },
  });
  console.log('--- criar_posts ---');
  console.log(res.content[0].text);
  if (res.isError) fail('criar_posts retornou erro');

  const zipPath = path.join(LOTE_DIR, 'teste-e2e.zip');
  if (!fs.existsSync(zipPath)) fail('zip não gerado em ' + zipPath);
  const kb = Math.round(fs.statSync(zipPath).size / 1024);
  console.log(`✓ zip gerado: ${kb} KB`);

  await page.screenshot({ path: '/tmp/tcm-e2e-canvas.png' });
  console.log('✓ screenshot: /tmp/tcm-e2e-canvas.png');

  await browser.close();
  mcp.kill();
  console.log('\n🎉 E2E OK');
}

main().catch((e) => fail(e.message));
process.on('exit', () => { try { mcp && mcp.kill(); } catch {} });
