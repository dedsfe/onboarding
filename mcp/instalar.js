#!/usr/bin/env node
/**
 * Liga o servidor MCP do Carousel Maker num cliente de IA, sem editar JSON à mão.
 *
 *   npx carousel-maker-mcp install desktop   → Claude Desktop
 *   npx carousel-maker-mcp install cursor    → Cursor
 *   npx carousel-maker-mcp install code      → Claude Code
 *   (no repo do app: npm run mcp:desktop / mcp:cursor)
 *
 * Junta com o que já existe no arquivo de configuração (guarda um .bak antes)
 * e usa caminhos absolutos: o app de desktop não herda o PATH do terminal,
 * então "node" ou "npx" sozinhos falham em quem usa nvm.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const NOME = 'carousel-maker';
const PACOTE = 'carousel-maker-mcp';
const SERVER = path.resolve(__dirname, 'server.js');
// Rodando de dentro do repo do app (dev) ou do pacote do npm (usuário final)?
const NO_REPO = fs.existsSync(path.resolve(__dirname, '..', 'index.html'));

/* No repo: node + caminho do server.js. Pelo npm: npx do mesmo Node que está
   rodando agora, com o PATH dele — a pasta do npx é cache e muda de lugar. */
function entradaServidor() {
  if (NO_REPO) return { command: process.execPath, args: [SERVER] };
  const binDir = path.dirname(process.execPath);
  const npx = path.join(binDir, process.platform === 'win32' ? 'npx.cmd' : 'npx');
  return {
    command: fs.existsSync(npx) ? npx : 'npx',
    args: ['-y', PACOTE],
    // Só o Node de agora + o básico do sistema (não copia o PATH inteiro do terminal)
    env: { PATH: process.platform === 'win32'
      ? [binDir, process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32') : ''].filter(Boolean).join(path.delimiter)
      : [binDir, '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'].join(path.delimiter) },
  };
}

function configPath(alvo) {
  const home = os.homedir();
  if (alvo === 'cursor') return path.join(home, '.cursor', 'mcp.json');
  if (alvo === 'desktop') {
    if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
    return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
  }
  return null;
}

function instalarClaudeCode() {
  const e = entradaServidor();
  const args = ['mcp', 'add', '--scope', 'user', NOME, '--', e.command, ...e.args];
  try {
    execFileSync('claude', args, { stdio: 'inherit' });
    console.log(`✅ ${NOME} ligado no Claude Code. Abra uma conversa nova (ou /mcp) para carregar.`);
  } catch (err) {
    console.error('❌ Não achei o comando "claude". Instale o Claude Code ou rode à mão:');
    console.error(`   claude ${args.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
    process.exit(1);
  }
}

function main() {
  const alvo = process.argv[2];
  if (alvo === 'code') return instalarClaudeCode();

  const arquivo = configPath(alvo);
  if (!arquivo) {
    console.error('Uso: npx carousel-maker-mcp install <desktop|cursor|code>');
    process.exit(1);
  }

  let config = {};
  if (fs.existsSync(arquivo)) {
    const bruto = fs.readFileSync(arquivo, 'utf8');
    try {
      config = bruto.trim() ? JSON.parse(bruto) : {};
    } catch (e) {
      console.error(`❌ ${arquivo} não é um JSON válido — corrija ou apague e rode de novo.`);
      process.exit(1);
    }
    fs.copyFileSync(arquivo, arquivo + '.bak');
  } else {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  }

  config.mcpServers = config.mcpServers || {};
  config.mcpServers[NOME] = entradaServidor();
  fs.writeFileSync(arquivo, JSON.stringify(config, null, 2) + '\n');

  const app = alvo === 'cursor' ? 'Cursor' : 'Claude Desktop';
  console.log(`✅ ${NOME} ligado no ${app}`);
  console.log(`   ${arquivo}`);
  console.log(`   Feche e abra o ${app} de novo para ele carregar.`);
}

main();
