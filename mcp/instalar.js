#!/usr/bin/env node
/**
 * Liga o servidor MCP do Carousel Maker num cliente de IA, sem editar JSON à mão.
 *
 *   npm run mcp:desktop   → Claude Desktop
 *   npm run mcp:cursor    → Cursor
 *
 * Junta com o que já existe no arquivo de configuração (guarda um .bak antes)
 * e usa caminhos absolutos: o app de desktop não herda o PATH do terminal,
 * então "node" sozinho falha em quem usa nvm.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, 'server.js');
const NOME = 'carousel-maker';

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

function main() {
  const alvo = process.argv[2];
  const arquivo = configPath(alvo);
  if (!arquivo) {
    console.error('Uso: node mcp/instalar.js <desktop|cursor>');
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
  config.mcpServers[NOME] = { command: process.execPath, args: [SERVER] };
  fs.writeFileSync(arquivo, JSON.stringify(config, null, 2) + '\n');

  const app = alvo === 'cursor' ? 'Cursor' : 'Claude Desktop';
  console.log(`✅ ${NOME} ligado no ${app}`);
  console.log(`   ${arquivo}`);
  console.log(`   Feche e abra o ${app} de novo para ele carregar.`);
}

main();
