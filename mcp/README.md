# The Carousel Maker — Servidor MCP

Expõe o app para qualquer cliente IA (Claude Code, Claude Desktop, Cursor) via
[Model Context Protocol](https://modelcontextprotocol.io), transporte stdio.

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `ver_pedido_lote` ⭐ | Lê o pedido da tela **Criar em lote** (o que escrever, quantos, fotos, saída) + imagens do modelo e das fotos |
| `gerar_lote` ⭐ | Recebe os textos da IA e gera os carrosséis na pasta de saída escolhida no app |
| `ver_exemplo_lote` | Abre um slide do resultado desejado em alta pra ler a copy dos melhores posts |
| `ver_fotos_lote` | Todas as fotos do lote com índice (pra casar foto × copy via `_foto`) |
| `previsualizar_lote` | Renderiza até 3 carrosséis com a copy proposta + avisa texto estourando |
| `criar_molde` | Cria o design do carrossel sem precisar de post no canvas |
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

## Conectar (um comando, rodado na pasta do app)

| Cliente | Comando |
|---|---|
| Claude Code | `claude mcp add carousel-maker -- node "$(pwd)/mcp/server.js"` |
| Claude Desktop | `npm run mcp:desktop` (escreve no `claude_desktop_config.json`, guarda `.bak`) |
| Cursor | `npm run mcp:cursor` (escreve no `~/.cursor/mcp.json`, guarda `.bak`) |

Depois reabra o cliente. A tela **Criar em lote** mostra a conexão ao vivo (bolinha verde).

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
