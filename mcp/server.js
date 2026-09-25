/**
 * The Carousel Maker — MCP Server
 *
 * Expõe o app de carrosséis para clientes IA (Claude Code, Claude Desktop,
 * Cursor...) via Model Context Protocol (transporte stdio).
 *
 * Ferramentas:
 * - listar_templates / detalhar_template: catálogo de templates do app
 * - criar_lote / listar_lotes: gera CSVs de automação em lote prontos para
 *   soltar na tabela de lote do app (Modal Lote → arrastar o .csv)
 * - guia_uso: como o fluxo lote + binds {{}} funciona no app
 *
 * Zero estado no servidor: tudo é arquivo (lotes/ na raiz do projeto).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { WebSocketServer } = require('ws');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const ROOT = path.resolve(__dirname, '..');
const LOTES_DIR = path.join(ROOT, 'lotes');
const TEMPLATES_FILE = path.join(ROOT, 'templates-data.js');


/* ---------------------------------------------------------------------------
 * Carrega o catálogo de templates (script de browser) num sandbox do Node.
 * Só a metadata é lida — generateFrames() exige APIs de canvas do browser.
 * ------------------------------------------------------------------------- */
function loadTemplates() {
  const code = fs.readFileSync(TEMPLATES_FILE, 'utf8');
  const sandbox = {};
  sandbox.window = sandbox;
  vm.runInNewContext(code, sandbox, { filename: 'templates-data.js' });
  return sandbox.CarouselTemplates;
}

function templateSummary(t) {
  return {
    id: t.id,
    titulo: t.title,
    categoria: t.category,
    categoria_label: t.categoryLabel,
    descricao: t.description,
    slides: t.slideCount,
    formato: t.aspect,
    badge: t.badge || null,
  };
}

function templateDetail(t) {
  const deck = t.deck || {};
  return {
    ...templateSummary(t),
    deck: {
      estilo_capa: deck.coverBg || null,
      cor_destaque: deck.accentColor || null,
      tag_exemplo: deck.tag || null,
      headline_exemplo: deck.headline || null,
      subtitulo_exemplo: deck.sub || null,
      autor_exemplo: deck.author || null,
    },
  };
}

/* ---------------------------------------------------------------------------
 * CSV no formato que o parseCSV() do app entende: tudo entre aspas,
 * delimitador vírgula, escapes de aspas duplicadas.
 * ------------------------------------------------------------------------- */
function csvEscape(value) {
  return '"' + String(value ?? '').replace(/"/g, '""') + '"';
}

function toCSV(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

function slugify(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'lote';
}

function writeLote(nome, headers, rows) {
  let dir = path.join(LOTES_DIR, slugify(nome));
  let n = 2;
  while (fs.existsSync(path.join(dir, 'lote.csv'))) {
    dir = path.join(LOTES_DIR, `${slugify(nome)}-${n++}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'lote.csv');
  fs.writeFileSync(file, toCSV(headers, rows), 'utf8');
  return file;
}

function readLotes() {
  if (!fs.existsSync(LOTES_DIR)) return [];
  return fs
    .readdirSync(LOTES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const csvPath = path.join(LOTES_DIR, d.name, 'lote.csv');
      if (!fs.existsSync(csvPath)) return null;
      const text = fs.readFileSync(csvPath, 'utf8');
      const dataRows = text.trim().split(/\r\n|\n/).length - 1;
      const headers = (text.split(/\r\n|\n/)[0] || '')
        .split(',')
        .map((h) => h.replace(/^"|"$/g, ''));
      return { lote: d.name, posts: dataRows, colunas: headers, arquivo: csvPath };
    })
    .filter(Boolean)
    .sort((a, b) => b.arquivo.localeCompare(a.arquivo));
}

/* ---------------------------------------------------------------------------
 * Ponte WebSocket com o app no navegador (mcp-bridge.js)
 *
 * O browser não escuta portas, então o servidor MCP sobe o ws://localhost:8765
 * e a página conecta nele. Comandos seguem {id, cmd, args} → {id, ok, data}.
 * ------------------------------------------------------------------------- */
// TCM_BRIDGE_PORT deixa o teste E2E rodar com o MCP da sessão ligado
const BRIDGE_PORT = Number(process.env.TCM_BRIDGE_PORT) || 8765;
const EXPORT_TIMEOUT_MS = 10 * 60 * 1000; // lote grande em scale 2 demora

let bridgeSocket = null;
let bridgeSeq = 1;
const bridgePendentes = new Map();

function logBridge(msg) {
  console.error(`[carousel-maker ponte] ${msg}`); // stderr: não suja o protocolo stdio
}

function iniciarBridgeWs() {
  const httpServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'POST' && req.url === '/cmd') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const { cmd, args, timeoutMs } = JSON.parse(body || '{}');
          const data = await ponteCmd(cmd, args, timeoutMs);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, data }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, erro: err.message }));
        }
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ conectada: ponteConectada(), seq: bridgeSeq }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer, maxPayload: 256 * 1024 * 1024 });
  wss.on('connection', (socket) => {
    bridgeSocket = socket;
    logBridge('app conectado no navegador');
    socket.on('close', () => {
      if (bridgeSocket === socket) bridgeSocket = null;
      logBridge('app desconectado');
    });
    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.tipo === 'hello') return; // aviso de chegada, sem resposta
      const pendente = bridgePendentes.get(msg.id);
      if (!pendente) return;
      bridgePendentes.delete(msg.id);
      clearTimeout(pendente.timer);
      if (msg.ok) pendente.resolve(msg.data);
      else pendente.reject(new Error(msg.erro || 'erro na ponte'));
    });
  });
  httpServer.on('error', (e) => {
    logBridge(`http/ws erro: ${e.message}`);
    if (e.code === 'EADDRINUSE') {
      logBridge('a porta da ponte já está em uso — outra instância do servidor deve estar rodando. Feche-a antes de subir de novo.');
      process.exit(1);
    }
  });
  httpServer.listen(BRIDGE_PORT, () => {
    logBridge(`ponte ouvindo na porta ${BRIDGE_PORT} (WS + HTTP /cmd)`);
  });
}

function ponteConectada() {
  return !!bridgeSocket && bridgeSocket.readyState === 1;
}

function ponteCmd(cmd, args = {}, timeoutMs = 60000) {
  if (!ponteConectada()) {
    throw new Error('app não está conectado — abra o The Carousel Maker no navegador (npm run dev → http://localhost:3000) e aguarde a ponte conectar.');
  }
  const id = `c${bridgeSeq++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bridgePendentes.delete(id);
      reject(new Error(`ponte: tempo esgotado no comando "${cmd}"`));
    }, timeoutMs);
    bridgePendentes.set(id, { resolve, reject, timer });
    bridgeSocket.send(JSON.stringify({ id, cmd, args }));
  });
}

/* Imagem local → data URL (formato que os overrides de bind do app aceitam) */
const MIME_POR_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif',
};

function imageDataURL(p) {
  const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  const buf = fs.readFileSync(abs);
  const mime = MIME_POR_EXT[path.extname(abs).toLowerCase()] || 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/* ---------------------------------------------------------------------------
 * Servidor
 * ------------------------------------------------------------------------- */
const server = new McpServer({ name: 'carousel-maker', version: '1.1.0' });



server.tool(
  'listar_templates',
  'Lista os templates de carrossel disponíveis no The Carousel Maker (id, título, categoria, nº de slides e formato).',
  {},
  async () => {
    const catalog = loadTemplates();
    const templates = catalog.getAll().map(templateSummary);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { categorias: catalog.getCategories(), total: templates.length, templates },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  'detalhar_template',
  'Detalha um template pelo id (cores, tag, estrutura de headline e subtítulo) para orientar a criação de conteúdo no mesmo estilo.',
  { id: z.string().describe('id do template, ex.: tutorial_5steps') },
  async ({ id }) => {
    const catalog = loadTemplates();
    const t = catalog.getById(id);
    if (!t) {
      return { content: [{ type: 'text', text: `Template "${id}" não encontrado. Use listar_templates.` }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(templateDetail(t), null, 2) }] };
  }
);

server.tool(
  'criar_lote',
  'Cria um lote de posts: grava lotes/<nome>/lote.csv pronto para arrastar na tabela de Automação em Lote do app. Cada chave do objeto vira uma coluna do CSV (case com o bind {{}} do design).',
  {
    nome: z.string().describe('Nome do lote (vira a pasta em lotes/)'),
    posts: z
      .array(z.record(z.string(), z.string()))
      .min(1)
      .describe('Posts do lote. Ex.: [{titulo, versiculo, mensagem, referencia}] — as chaves viram as colunas do CSV.'),
  },
  async ({ nome, posts }) => {
    const headers = [...new Set(posts.flatMap((p) => Object.keys(p)))];
    const rows = posts.map((p) => {
      const row = {};
      for (const h of headers) row[h] = p[h] ?? '';
      return row;
    });
    const file = writeLote(nome, headers, rows);
    return {
      content: [
        {
          type: 'text',
          text: `Lote criado: ${path.relative(ROOT, file)}\nPosts: ${rows.length}\nColunas: ${headers.join(', ')}\n\nPróximo passo: abra o app, menu Lote → arraste o lote.csv para a tabela.`,
        },
      ],
    };
  }
);

server.tool(
  'listar_lotes',
  'Lista os lotes já gerados em lotes/ (pasta, nº de posts e colunas de cada CSV).',
  {},
  async () => ({
    content: [{ type: 'text', text: JSON.stringify({ lotes: readLotes() }, null, 2) }],
  })
);

server.tool(
  'status_ponte',
  'Verifica se o app está aberto no navegador e conectado à ponte. Devolve frames, binds e cadeias do canvas atual. Se desconectado, instrua o usuário a abrir o app (npm run dev → http://localhost:3000).',
  {},
  async () => {
    if (!ponteConectada()) {
      return {
        content: [{ type: 'text', text: 'Ponte DESCONECTADA. O app precisa estar aberto no navegador: rode `npm run dev` e abra http://localhost:3000 (a ponte conecta sozinha em ~2s).' }],
        isError: true,
      };
    }
    const status = await ponteCmd('status', {}, 15000);
    return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
  }
);

/* ---------------------------------------------------------------------------
 * Criar em lote (tela passo a passo do app): o usuário escolhe fotos, escreve
 * o pedido e a pasta de saída; a IA lê tudo e devolve os textos.
 * ------------------------------------------------------------------------- */
function desconectado() {
  return {
    content: [{ type: 'text', text: 'Ponte DESCONECTADA. O app precisa estar aberto no navegador: rode `npm run dev` e abra http://localhost:3000 (a ponte conecta sozinha em ~2s).' }],
    isError: true,
  };
}

function dataUrlParaImagem(url) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(url || '');
  return m ? { type: 'image', mimeType: m[1], data: m[2] } : null;
}

server.tool(
  'ver_pedido_lote',
  'PRIMEIRO PASSO para gerar carrosséis em lote a partir da tela "Criar em lote" do app. Devolve o pedido do usuário (o que escrever e quantos carrosséis), os carrosséis de RESULTADO DESEJADO (exemplos de como deve ficar), o molde do canvas com as variáveis de texto, as fotos e a pasta de saída — tudo com imagens. Depois escreva a COPY COMPLETA de `quantidade` carrosséis — um objeto por carrossel com todas as chaves de `copys` (um texto por slide/caixa de texto) — seguindo o pedido e o estilo dos exemplos, e chame gerar_lote.',
  {},
  async () => {
    if (!ponteConectada()) return desconectado();
    const info = await ponteCmd('lote_pedido', {}, 60000);
    const { imagens, ...resto } = info || {};
    const conteudo = [{ type: 'text', text: JSON.stringify(resto, null, 2) }];
    const modelo = (imagens && imagens.modelo) || [];
    const fotos = (imagens && imagens.fotos) || [];
    const exemplos = (imagens && imagens.exemplos) || [];
    exemplos.forEach((ex, i) => {
      conteudo.push({ type: 'text', text: `RESULTADO DESEJADO — exemplo ${i + 1} "${ex.nome}" (${ex.slides.length} slide(s)). É assim que o usuário quer que fique: copie o tom, o tamanho e o tipo de texto.` });
      ex.slides.map(dataUrlParaImagem).filter(Boolean).forEach(img => conteudo.push(img));
    });
    if (modelo.length) {
      conteudo.push({ type: 'text', text: `Molde do canvas (${modelo.length} slide(s)) — é o design que vai montar as imagens. Cada caixa de texto dele é uma chave em "copys" (texto_do_modelo mostra o que está lá hoje; mantenha um tamanho parecido para caber):` });
      modelo.map(dataUrlParaImagem).filter(Boolean).forEach(img => conteudo.push(img));
    }
    if (fotos.length) {
      conteudo.push({ type: 'text', text: `Fotos do usuário (${fotos.length} de ${resto.fotos ? resto.fotos.total : fotos.length}) — cada carrossel usa uma, na ordem:` });
      fotos.map(dataUrlParaImagem).filter(Boolean).forEach(img => conteudo.push(img));
    }
    if (resto.copys && resto.copys.length) {
      const exemplo = Object.fromEntries(resto.copys.map(c => [c.chave, '...']));
      conteudo.push({ type: 'text', text: `Formato para gerar_lote: textos = [ ${JSON.stringify(exemplo)}, ... ] — ${resto.quantidade} objeto(s), um por carrossel.` });
    }
    if (!resto.pedido) {
      conteudo.push({ type: 'text', text: 'O usuário ainda não escreveu um pedido na tela. Pergunte o tema/tom ou peça para ele escrever no passo 2 ("Pedir pra IA escrever").' });
    }
    if (resto.faltando && resto.faltando.length) {
      conteudo.push({ type: 'text', text: `Antes de gerar, falta no app: ${resto.faltando.join('; ')}. Peça para o usuário resolver e tente de novo.` });
    }
    return { content: conteudo };
  }
);

server.tool(
  'gerar_lote',
  'Gera os carrosséis da tela "Criar em lote" com a copy que você escreveu (depois de ver_pedido_lote). Mande um objeto por carrossel com as chaves de `copys` (slide1_texto1, slide2_texto1, … ou nomes de variáveis) e o texto de cada uma. Cada carrossel usa a próxima foto do usuário e é gravado na pasta de saída escolhida no app.',
  {
    textos: z
      .union([z.array(z.string().min(1)).min(1), z.array(z.record(z.string(), z.string())).min(1)])
      .describe('Um objeto por carrossel: { chave_de_copys: texto }. (Lista de strings também vale: só troca o primeiro texto de cada carrossel.)'),
  },
  async ({ textos }) => {
    if (!ponteConectada()) return desconectado();
    try {
      const r = await ponteCmd('lote_gerar', { textos }, EXPORT_TIMEOUT_MS);
      return { content: [{ type: 'text', text: `✅ ${r.gerados} carrossel(éis) de ${r.slides} slide(s) gerado(s) → ${r.destino}.` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Não gerou: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'criar_posts',
  'PIPELINE COMPLETO: aplica um template no app aberto no navegador, injeta os textos nos binds, troca o fundo pelas imagens fornecidas, renderiza e devolve o .zip dos posts prontos em lotes/<nome>/. Requer o app aberto (ponte). Posts = array de objetos cujas chaves são os binds do template (confira com listar_templates/detalhar_template ou status_ponte).',
  {
    nome: z.string().describe('Nome do lote (pasta e arquivo em lotes/)'),
    template: z.string().describe('id do template, ex.: quote_leadership'),
    posts: z
      .array(z.record(z.string(), z.string()))
      .min(1)
      .describe('Conteúdo por post. Chaves = binds do template (ex.: titulo, citacao, autor).'),
    fundos: z
      .array(z.string())
      .optional()
      .describe('Caminhos locais das imagens de fundo (jpg/png/webp). Post i usa fundos[i % fundos.length].'),
    fundo_bind: z.string().default('fundo').describe('Nome do bind de fundo a criar/amarrar no design.'),
    limpar: z.boolean().default(true).describe('Limpar o canvas antes de aplicar o template.'),
    gerar_no_canvas: z.boolean().default(false).describe('Multiplicar também os posts como frames no canvas (feedback visual; mais lento).'),
  },
  async ({ nome, template, posts, fundos, fundo_bind, limpar, gerar_no_canvas }) => {
    if (!ponteConectada()) {
      return {
        content: [{ type: 'text', text: 'App não conectado à ponte. Abra o The Carousel Maker no navegador (npm run dev → http://localhost:3000) e tente de novo.' }],
        isError: true,
      };
    }

    const etapas = [];
    try {
      if (limpar) { await ponteCmd('limpar_canvas'); etapas.push('canvas limpo'); }

      const aplicado = await ponteCmd('aplicar_template', { id: template }, 30000);
      etapas.push(`template "${aplicado.template}" (${aplicado.slides} slides)`);

      const dataURLs = (fundos || []).map(imageDataURL);

      if (dataURLs.length > 0) {
        const fb = await ponteCmd('definir_fundo_bind', { nome: fundo_bind }, 15000);
        etapas.push(`bind de fundo {{${fb.bind}}} em ${fb.slides} slide(s)`);
      }

      const registros = posts.map((p, i) =>
        dataURLs.length > 0
          ? { ...p, [fundo_bind]: dataURLs[i % dataURLs.length] }
          : { ...p }
      );

      const info = await ponteCmd('status', {}, 15000);
      const bindsValidos = new Set((info.canvas && info.canvas.binds || []).map((b) => b.nome));
      const chavesUsadas = [...new Set(registros.flatMap((r) => Object.keys(r)))];
      const ignoradas = chavesUsadas.filter((k) => !bindsValidos.has(k));

      const lote = await ponteCmd('definir_lote', { registros }, 60000);
      etapas.push(`${lote.posts} posts carregados na tabela`);

      if (gerar_no_canvas) {
        await ponteCmd('gerar_no_canvas', {}, 5 * 60 * 1000);
        etapas.push('frames multiplicados no canvas');
      }

      etapas.push('exportando (renderização em scale 2)...');
      const zip = await ponteCmd('exportar_zip', {}, EXPORT_TIMEOUT_MS);

      // Persiste zip + CSV do lote para reuso
      const dir = path.join(LOTES_DIR, slugify(nome));
      fs.mkdirSync(dir, { recursive: true });
      const zipPath = path.join(dir, `${slugify(nome)}.zip`);
      fs.writeFileSync(zipPath, Buffer.from(zip.zip, 'base64'));

      const headers = [...new Set(registros.flatMap((r) => Object.keys(r)))];
      const csvRows = registros.map((r) => {
        const row = {};
        for (const h of headers) row[h] = String(r[h] ?? '');
        return row;
      });
      const csvPath = path.join(dir, 'lote.csv');
      fs.writeFileSync(csvPath, toCSV(headers, csvRows), 'utf8');

      return {
        content: [
          {
            type: 'text',
            text: [
              `✅ Lote pronto: ${path.relative(ROOT, zipPath)}`,
              `Etapas: ${etapas.join(' → ')}`,
              ignoradas.length
                ? `⚠️ Chaves sem bind no design (ignoradas na renderização): ${ignoradas.join(', ')} — binds disponíveis: ${[...bindsValidos].join(', ')}`
                : `Binds usados: ${chavesUsadas.join(', ')}`,
              `CSV do lote salvo em: ${path.relative(ROOT, csvPath)}`,
            ].join('\n'),
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: 'text', text: `Falha no pipeline após [${etapas.join(' → ') || 'início'}]: ${e.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  'guia_uso',
  'Explica como o fluxo de automação em lote do The Carousel Maker funciona (binds {{}}, CSV e fotos) para a IA gerar conteúdo no formato certo.',
  {},
  async () => ({
    content: [
      {
        type: 'text',
        text: [
          'COMO USAR O THE CAROUSEL MAKER VIA LOTE:',
          '0. PIPELINE COMPLETO (o app aberto no navegador): criar_posts aplica template, injeta textos nos binds, troca o fundo por imagens locais e devolve o .zip pronto em lotes/. Confira os binds do template com detalhar_template antes.',
          '1. No app, o design usa variáveis {{titulo}}, {{mensagem}} etc. (binds). Cada bind vira uma coluna do CSV.',
          '2. Gere o conteúdo com criar_lote (ou escreva o CSV à mão) — as chaves dos posts devem bater com os binds do design.',
          '3. No app: menu ⚡ Lote → arraste o lote.csv para a tabela → as colunas casam pelos nomes (exato antes de parcial).',
          '4. Fotos: inclua uma coluna de foto no CSV (caminho local ou URL).',
          '5. Exportar: o app gera uma pasta por post com as imagens finais.',
          '',
          'DICAS: veja os templates com listar_templates e o estilo com detalhar_template antes de escrever o conteúdo.',
        ].join('\n'),
      },
    ],
  })
);

async function main() {
  iniciarBridgeWs();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logBridge(`servindo ponte em ws://localhost:${BRIDGE_PORT}`);
}

main().catch((e) => {
  console.error('[carousel-maker mcp] erro fatal:', e);
  process.exit(1);
});
