#!/usr/bin/env node
/**
 * carousel-maker-mcp
 *
 *   npx carousel-maker-mcp                   → sobe o servidor MCP (stdio + ponte ws)
 *   npx carousel-maker-mcp install desktop   → liga no Claude Desktop
 *   npx carousel-maker-mcp install cursor    → liga no Cursor
 *   npx carousel-maker-mcp install code      → liga no Claude Code
 */
const [cmd, alvo] = process.argv.slice(2);

if (cmd === 'install' || cmd === 'instalar') {
  process.argv = [process.argv[0], require.resolve('./instalar.js'), alvo || ''];
  require('./instalar.js');
} else if (cmd === '--version' || cmd === '-v') {
  console.log(require('./package.json').version);
} else if (cmd === '--help' || cmd === '-h') {
  console.log([
    'carousel-maker-mcp',
    '  (sem argumentos)        sobe o servidor MCP',
    '  install desktop         liga no Claude Desktop',
    '  install cursor          liga no Cursor',
    '  install code            liga no Claude Code',
  ].join('\n'));
} else {
  require('./server.js');
}
