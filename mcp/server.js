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
const os = require('os');
const path = require('path');
const vm = require('vm');
const { WebSocketServer } = require('ws');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const ROOT = path.resolve(__dirname, '..');
/* Dentro do repo do app, lotes/ e templates ficam na raiz. Instalado pelo npm
   (npx carousel-maker-mcp), os templates vêm no pacote e os lotes vão para
   ~/CarouselMaker/lotes — a pasta do pacote é um cache que o npm apaga. */
const NO_REPO = fs.existsSync(path.join(ROOT, 'index.html')) && fs.existsSync(path.join(ROOT, 'templates-data.js'));
const LOTES_DIR = process.env.TCM_LOTES_DIR || (NO_REPO ? path.join(ROOT, 'lotes') : path.join(os.homedir(), 'CarouselMaker', 'lotes'));
const TEMPLATES_FILE = NO_REPO ? path.join(ROOT, 'templates-data.js') : path.join(__dirname, 'templates-data.js');
const mostrar = (p) => (NO_REPO ? path.relative(ROOT, p) : p);


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
          text: `Lote criado: ${mostrar(file)}\nPosts: ${rows.length}\nColunas: ${headers.join(', ')}\n\nPróximo passo: abra o app, menu Lote → arraste o lote.csv para a tabela.`,
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

const PLAYBOOK = [
  'COMO FAZER UM LOTE DE ALTO NÍVEL (siga nesta ordem):',
  '1. ESTUDE OS EXEMPLOS (resultado desejado): abra os slides em alta com ver_exemplo_lote e anote a estrutura (capa / meio / CTA), o tamanho do hook, as palavras-gatilho e o ritmo de cada slide. Eles são o padrão de qualidade.',
  '2. PESQUISE O NICHO: use busca na web e, se tiver, ferramentas de tendências (ex.: trends get_top_trends / get_top_posts) para achar os posts que mais performam agora e os padrões de hook deles (curiosidade, número, contraste, dor, prova, segredo).',
  '3. VEJA AS FOTOS com ver_fotos_lote e case cada foto com o ângulo que ela sugere (campo _foto = índice da foto).',
  '4. ESCREVA as variações com ângulos realmente diferentes (nunca a mesma frase trocando palavras): hook forte na capa, uma ideia por slide, CTA no último. Em cada carrossel inclua _legenda (2–4 linhas + 3–5 hashtags do nicho).',
  '5. REVISE com previsualizar_lote (2–3 carrosséis): leia as imagens e os "problemas"; encurte o que estourar ou use _estilo { chave: { tamanho } } para diminuir a fonte. Só então chame gerar_lote com TODAS as variações.',
  '6. SEM MOLDE (molde: null): ANTES de criar, abra 2–3 slides dos exemplos com ver_exemplo_lote e meça posições e tamanhos reais (hook costuma ter 80–120px, texto de apoio 36–48px). Crie com criar_molde reproduzindo esse layout, com "chave" em cada texto e fundo.foto quando a foto do usuário for o fundo (texto claro + escurecer ≥ 30). Olhe as imagens que o criar_molde devolve e refaça até ficar no nível dos exemplos.',
  '7. No fim, conte ao usuário em 2–3 linhas o que achou na pesquisa e quais ângulos usou.',
].join('\n');

server.tool(
  'ver_pedido_lote',
  'PRIMEIRO PASSO para gerar carrosséis em lote a partir da tela "Criar em lote" do app. Devolve o pedido do usuário, quantas VARIAÇÕES ele quer, os carrosséis de RESULTADO DESEJADO (exemplos de como deve ficar), o molde (design) com os campos de copy, as fotos e a pasta de saída — com imagens — e o passo a passo para chegar num resultado de alto nível (estudar exemplos, pesquisar o nicho, prévia, gerar).',
  {},
  async () => {
    if (!ponteConectada()) return desconectado();
    const info = await ponteCmd('lote_pedido', {}, 90000);
    const { imagens, ...resto } = info || {};
    const conteudo = [{ type: 'text', text: JSON.stringify(resto, null, 2) }];
    const modelo = (imagens && imagens.modelo) || [];
    const fotos = (imagens && imagens.fotos) || [];
    const exemplos = (imagens && imagens.exemplos) || [];
    exemplos.forEach((ex, i) => {
      conteudo.push({ type: 'text', text: `RESULTADO DESEJADO — exemplo ${i + 1} "${ex.nome}" (${ex.slides.length} slide(s)). É o padrão de qualidade: copie estrutura, tom, tamanho e tipo de texto. Para ler um slide em alta: ver_exemplo_lote { carrossel: ${i + 1}, slide: N }.` });
      ex.slides.map(dataUrlParaImagem).filter(Boolean).forEach(img => conteudo.push(img));
    });
    if (modelo.length) {
      conteudo.push({ type: 'text', text: `Molde (${modelo.length} slide(s)) — é o design que monta as imagens. Cada caixa de texto é uma chave em "copys" (texto_do_modelo = o que está lá hoje; mantenha um tamanho parecido):` });
      modelo.map(dataUrlParaImagem).filter(Boolean).forEach(img => conteudo.push(img));
    }
    if (fotos.length) {
      conteudo.push({ type: 'text', text: `Fotos do usuário (${fotos.length} de ${resto.fotos ? resto.fotos.total : fotos.length}; todas com índice em ver_fotos_lote):` });
      fotos.map(dataUrlParaImagem).filter(Boolean).forEach(img => conteudo.push(img));
    }
    if (resto.copys && resto.copys.length) {
      const exemplo = Object.fromEntries(resto.copys.map(c => [c.chave, '...']));
      exemplo._foto = 1;
      exemplo._legenda = '...';
      conteudo.push({ type: 'text', text: `Formato de cada carrossel (previsualizar_lote e gerar_lote): ${JSON.stringify(exemplo)} — gere ${resto.quantidade} variação(ões).` });
    }
    if (resto.modo === 'ia_decide') {
      conteudo.push({ type: 'text', text: `MODO "A IA DECIDE": o usuário quer que você crie a copy${resto.pedido ? ' seguindo a direção acima' : ' — ele não deu direção, deduza o nicho pelos exemplos e fotos'}.` });
    }
    conteudo.push({ type: 'text', text: PLAYBOOK });
    if (resto.faltando && resto.faltando.length) {
      conteudo.push({ type: 'text', text: `Antes de gerar, falta: ${resto.faltando.join('; ')}.` });
    }
    return { content: conteudo };
  }
);

server.tool(
  'ver_exemplo_lote',
  'Abre um slide do RESULTADO DESEJADO em alta resolução (1080px) para ler a copy e o layout dos melhores posts que o usuário escolheu como referência.',
  {
    carrossel: z.number().int().min(1).default(1).describe('Número do carrossel de exemplo (1 = primeiro)'),
    slide: z.number().int().min(1).default(1).describe('Número do slide dentro do exemplo'),
  },
  async ({ carrossel, slide }) => {
    if (!ponteConectada()) return desconectado();
    try {
      const r = await ponteCmd('lote_exemplo', { carrossel, slide }, 30000);
      return { content: [
        { type: 'text', text: `Exemplo "${r.carrossel}" — slide ${r.slide} de ${r.de}.` },
        dataUrlParaImagem(r.img),
      ].filter(Boolean) };
    } catch (e) {
      return { content: [{ type: 'text', text: e.message }], isError: true };
    }
  }
);

server.tool(
  'ver_fotos_lote',
  'Mostra as fotos que o usuário escolheu para o lote, com o índice de cada uma (12 por página). Use o índice em _foto para casar a foto certa com cada copy.',
  { pagina: z.number().int().min(1).default(1) },
  async ({ pagina }) => {
    if (!ponteConectada()) return desconectado();
    try {
      const r = await ponteCmd('lote_fotos', { pagina }, 60000);
      const conteudo = [{ type: 'text', text: `Fotos ${pagina}/${r.paginas} (total ${r.total}):` }];
      r.fotos.forEach(f => {
        conteudo.push({ type: 'text', text: `#${f.indice} — ${f.nome}` });
        const img = dataUrlParaImagem(f.img);
        if (img) conteudo.push(img);
      });
      return { content: conteudo };
    } catch (e) {
      return { content: [{ type: 'text', text: e.message }], isError: true };
    }
  }
);

const estiloTexto = z.object({
  tamanho: z.number().optional().describe('Tamanho da fonte em px (slide de 1080 de largura)'),
  cor: z.string().optional().describe('Cor hex, ex.: #FFFFFF'),
  peso: z.number().optional().describe('Peso da fonte: 400, 600, 700, 800'),
  alinhamento: z.enum(['left', 'center', 'right']).optional(),
});

const carrosselLote = z
  .object({
    _foto: z.union([z.number().int().min(1), z.string()]).optional().describe('Índice (1 = primeira) ou nome da foto para a variável de foto principal'),
    _fotos: z.record(z.string(), z.union([z.number().int().min(1), z.string()])).optional().describe('Outras variáveis de foto: { foto2: 5 }'),
    _estilo: z.record(z.string(), estiloTexto).optional().describe('Ajuste por campo de copy: { slide2_texto1: { tamanho: 56 } }'),
    _legenda: z.string().optional().describe('Legenda do post (vai para legenda.txt), com hashtags'),
  })
  .catchall(z.string());

server.tool(
  'previsualizar_lote',
  'Renderiza até 3 carrosséis com a copy proposta e devolve as imagens de cada slide + problemas (texto passando do fim do slide, palavra maior que a caixa). Use ANTES de gerar_lote para revisar e corrigir.',
  { textos: z.array(carrosselLote).min(1).max(3).describe('1 a 3 carrosséis no mesmo formato de gerar_lote') },
  async ({ textos }) => {
    if (!ponteConectada()) return desconectado();
    try {
      const r = await ponteCmd('lote_previa', { textos }, 120000);
      const conteudo = [];
      r.carrosseis.forEach(c => {
        conteudo.push({ type: 'text', text: `Carrossel ${c.indice}: ${c.problemas.length ? '⚠️ ' + c.problemas.join(' | ') : '✓ tudo cabe'}` });
        c.slides.map(dataUrlParaImagem).filter(Boolean).forEach(img => conteudo.push(img));
      });
      return { content: conteudo };
    } catch (e) {
      return { content: [{ type: 'text', text: `Não deu pra pré-visualizar: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'criar_molde',
  'Cria o molde (design) do carrossel no app quando o usuário não tem post no canvas: descreva cada slide — fundo (cor e/ou foto do usuário) e os textos com posição, tamanho e cor — reproduzindo o layout dos exemplos de resultado desejado. ANTES, abra os exemplos com ver_exemplo_lote e copie posições e tamanhos reais. Coordenadas em px no formato escolhido (ig-feed = 1080×1350, ig-story = 1080×1920). Cada texto com "chave" vira um campo de copy. Devolve a imagem de cada slide e corrige sozinho contraste ruim, fonte pequena (hook ≥ 64px, texto ≥ 28px) e texto colado no topo. Chamar de novo substitui o molde anterior da IA.',
  {
    nome: z.string().optional(),
    substituir: z.boolean().default(true).describe('true = troca o último molde criado pela IA (padrão); false = cria outro ao lado'),
    formato: z.enum(['ig-feed', 'ig-square', 'ig-story', 'reels', 'story', 'pinterest']).default('ig-feed'),
    slides: z.array(z.object({
      fundo: z.object({
        cor: z.string().optional().describe('Cor de fundo hex'),
        foto: z.string().optional().describe('Nome da variável de foto (ex.: "foto") — a foto do usuário vira o fundo'),
        escurecer: z.number().min(0).max(90).optional().describe('Película escura sobre a foto, 0–90 (%)'),
      }).optional(),
      textos: z.array(z.object({
        chave: z.string().optional().describe('Nome do campo de copy (ex.: "hook", "dica", "cta")'),
        texto: z.string().describe('Texto de exemplo'),
        x: z.number().optional(), y: z.number().optional(), w: z.number().optional(),
        tamanho: z.number().optional(), peso: z.number().optional(), cor: z.string().optional(),
        alinhamento: z.enum(['left', 'center', 'right']).optional(),
        fonte: z.string().optional().describe('Família da fonte, ex.: "Inter Tight", "Poppins", "Bebas Neue"'),
      })).optional(),
    })).min(1).max(20),
  },
  async (spec) => {
    if (!ponteConectada()) return desconectado();
    try {
      const r = await ponteCmd('lote_criar_molde', spec, 60000);
      const conteudo = [{ type: 'text', text: `✅ Molde criado: ${r.slides} slide(s) em ${r.formato}. Veja abaixo como ficou.` }];
      if (r.avisos && r.avisos.length) {
        conteudo.push({ type: 'text', text: `Revisão automática — corrigi isto no molde:\n- ${r.avisos.join('\n- ')}` });
      }
      (r.imagens || []).map(dataUrlParaImagem).filter(Boolean).forEach((img, i) => {
        conteudo.push({ type: 'text', text: `Slide ${i + 1}:` });
        conteudo.push(img);
      });
      conteudo.push({ type: 'text', text: 'COMPARE com os exemplos de resultado desejado (ver_exemplo_lote): tamanho do hook, posição dos textos, contraste, respiro. Se não estiver no mesmo nível, chame criar_molde de novo com os ajustes — ele SUBSTITUI este molde. Quando estiver bom, chame ver_pedido_lote para ver os campos de copy.' });
      return { content: conteudo };
    } catch (e) {
      return { content: [{ type: 'text', text: `Não criou o molde: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'gerar_lote',
  'Gera TODAS as variações da tela "Criar em lote" com a copy que você escreveu (depois de revisar com previsualizar_lote). Um objeto por carrossel com as chaves de `copys` + extras opcionais (_foto, _fotos, _estilo, _legenda). Grava cada carrossel numa pasta (slides em PNG + legenda.txt) e um copys.csv com tudo, na pasta de saída do app.',
  {
    textos: z
      .union([z.array(z.string().min(1)).min(1), z.array(carrosselLote).min(1)])
      .describe('Um objeto por carrossel: { chave_de_copys: texto, _foto?, _legenda?, _estilo? }. (Lista de strings também vale: só troca o primeiro texto.)'),
  },
  async ({ textos }) => {
    if (!ponteConectada()) return desconectado();
    try {
      const r = await ponteCmd('lote_gerar', { textos }, EXPORT_TIMEOUT_MS);
      return { content: [{ type: 'text', text: `✅ ${r.gerados} carrossel(éis) de ${r.slides} slide(s) gerado(s) → ${r.destino} (com legenda.txt e copys.csv).` }] };
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
              `✅ Lote pronto: ${mostrar(zipPath)}`,
              `Etapas: ${etapas.join(' → ')}`,
              ignoradas.length
                ? `⚠️ Chaves sem bind no design (ignoradas na renderização): ${ignoradas.join(', ')} — binds disponíveis: ${[...bindsValidos].join(', ')}`
                : `Binds usados: ${chavesUsadas.join(', ')}`,
              `CSV do lote salvo em: ${mostrar(csvPath)}`,
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
