# The Carousel Maker — Servidor MCP

Expõe o app para qualquer cliente IA (Claude Code, Claude Desktop, Cursor) via
[Model Context Protocol](https://modelcontextprotocol.io), transporte stdio.

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `criar_posts` ⭐ | **Pipeline completo**: aplica template, injeta textos nos binds, troca o fundo por imagens, renderiza e salva o `.zip` pronto em `lotes/` |
| `status_ponte` | App conectado? Frames, binds e cadeias do canvas atual |
| `listar_templates` / `detalhar_template` | Catálogo de templates e estilo de cada um |
| `criar_lote` / `listar_lotes` | CSV de lote pronto pra arrastar no menu ⚡ Lote do app |
| `guia_uso` | Explica o fluxo binds `{{}}` + CSV + fotos |

## Ponte com o navegador (ws://localhost:8765)

`criar_posts` e `status_ponte` dependem do **app aberto no navegador** — a
renderização é canvas do browser, então o servidor comanda a página via
WebSocket (`mcp-bridge.js`, incluído no `index.html`):

1. `npm run dev` e abra `http://localhost:3000` (ponte conecta sozinha em ~2s)
2. Servidor MCP sobe junto (`.mcp.json`) — pronto

Fluxo: `criar_posts` → limpa canvas → aplica template → amarra `{{fundo}}` →
carrega os posts → exporta → grava `lotes/<nome>/<nome>.zip` (+ `lote.csv`).
Imagens de fundo: caminhos locais (jpg/png/webp), ciclando `fundos[i % n]`.

## Claude Code (neste repo)

O `.mcp.json` da raiz já registra o servidor. Ao abrir o Claude Code no projeto,
aceite o servidor `carousel-maker` quando perguntar (ou rode `/mcp`).

## Claude Desktop

Em `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "carousel-maker": {
      "command": "node",
      "args": ["/Users/andrefelipe/Programação/AnalyticsOnboard/mcp/server.js"]
    }
  }
}
```

## Desenvolvimento

```bash
npm run mcp           # sobe o servidor manualmente (stdio + ponte ws)
npm run test:ponte    # E2E: abre Chromium headless e valida o pipeline inteiro
```

Dependências: `@modelcontextprotocol/sdk`, `zod`, `ws` (Node 18+);
`playwright` (dev, só para o teste E2E).
