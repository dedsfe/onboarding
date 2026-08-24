(function () {
  'use strict';

  if (window.lucide) {
    lucide.createIcons();
  }

  /* No AnalyticsOnboard o canvas dividia a tela com o dashboard de analytics
     (view persistida em localStorage). Aqui o editor É o produto: nada de
     dashboard, então estas funções existem só para o código do canvas —
     copiado sem alteração de lá — não reclamar de referência ausente. */
  const VIEW_KEY = 'tcm_view_v1';
  function loadView() {
    try { return JSON.parse(localStorage.getItem(VIEW_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveView() { /* nada fora do editor para lembrar */ }

  /* --------------------------------------------------
     0. Toasts — avisos curtos no canto inferior direito
     O alert() do navegador congela a página inteira e obriga um clique
     para seguir; num editor isso quebra o fluxo. Aqui o aviso aparece,
     conta o tempo dele e sai sozinho.
     Uso: toast.success('Copiado') · toast.error('...') · toast.info('...')
     -------------------------------------------------- */
  const TOAST_MAX = 3;
  // Erro fica mais tempo porque quase sempre pede uma ação do usuário
  const TOAST_MS = { success: 3000, info: 3000, error: 5000 };
  const TOAST_EXIT_MS = 220; // igual à transição de saída em .oa-toast

  const TOAST_ICONS = {
    success: '<circle cx="12" cy="12" r="9"/><path d="m8.4 12.3 2.4 2.4 4.8-5"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M12 7.4v5.2"/><path d="M12 16.3h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11.2v5"/><path d="M12 7.8h.01"/>'
  };

  function toastIconSvg(kind) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (TOAST_ICONS[kind] || TOAST_ICONS.info) + '</svg>';
  }

  function toastStack() {
    let stack = document.getElementById('oa-toast-stack');
    if (!stack) {
      // Fallback: se o container do HTML sumir, o aviso ainda tem onde nascer
      stack = document.createElement('div');
      stack.id = 'oa-toast-stack';
      stack.className = 'oa-toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    return stack;
  }

  function dismissToast(el) {
    if (!el || el.dataset.leaving === '1') return;
    el.dataset.leaving = '1';
    clearTimeout(Number(el.dataset.timer));
    el.classList.remove('is-in');
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), TOAST_EXIT_MS);
  }

  function showToast(kind, message) {
    const msg = message == null ? '' : String(message).trim();
    if (!msg) return null;

    const stack = toastStack();

    /* Teto de 3 na tela: o mais antigo sai para o novo entrar */
    const alive = Array.from(stack.children).filter(el => el.dataset.leaving !== '1');
    while (alive.length >= TOAST_MAX) dismissToast(alive.shift());

    const el = document.createElement('div');
    el.className = 'oa-toast oa-toast--' + kind;
    el.innerHTML = '<span class="oa-toast__icon">' + toastIconSvg(kind) + '</span>' +
                   '<span class="oa-toast__msg"></span>';
    /* textContent e não innerHTML: a mensagem pode vir de err.message ou de
       um nome de arquivo escolhido pelo usuário */
    el.querySelector('.oa-toast__msg').textContent = msg;
    el.addEventListener('click', () => dismissToast(el));
    stack.appendChild(el);

    // Um frame antes de animar, senão o browser junta os dois estados
    requestAnimationFrame(() => el.classList.add('is-in'));

    el.dataset.timer = String(setTimeout(() => dismissToast(el), TOAST_MS[kind] || TOAST_MS.info));
    return el;
  }

  const toast = {
    success: (msg) => showToast('success', msg),
    error: (msg) => showToast('error', msg),
    info: (msg) => showToast('info', msg)
  };
  window.toast = toast;

  /* --------------------------------------------------
     10. Canvas Infinito (pan, zoom e notas)
     -------------------------------------------------- */
  (function initInfiniteCanvas() {
    const view = document.getElementById('canvas-view');
    const world = document.getElementById('canvas-world');
    const dots = document.getElementById('canvas-dots');
    const hint = document.getElementById('canvas-hint');
    // No produto standalone não existe dock de alternância: o canvas é a única tela.
    const openBtn = document.getElementById('dock-btn-canvas') || view;
    if (!view || !world || !dots || !openBtn) return;

    // Barra do editor no topo
    const btnAddFrame = document.getElementById('canvas-add-frame');
    const btnAddText = document.getElementById('canvas-add-text');
    const btnAddImage = document.getElementById('canvas-add-image');
    const btnDupFrame = document.getElementById('canvas-dup-frame');
    const btnDelFrame = document.getElementById('canvas-del-frame');
    const btnLinkFrames = document.getElementById('canvas-link-frames');
    // Declarados aqui em cima porque updateTextToolbar roda já na primeira câmera
    const btnTextBind = document.getElementById('canvas-text-bind');
    const btnImageBind = document.getElementById('canvas-image-bind');
    const topLabel = document.getElementById('canvas-topbar-label');
    const formatsMenu = document.getElementById('canvas-formats');
    const btnInsertMenu = document.getElementById('canvas-insert-menu-btn');
    const insertMenu = document.getElementById('canvas-insert-menu');
    const btnBatchMenu = document.getElementById('canvas-batch-menu-btn');
    const batchMenu = document.getElementById('canvas-batch-menu');
    const btnBatch = document.getElementById('canvas-batch-btn');

    const DOT_GRID = 20;
    // Faixa em que o espaçamento dos pontos pode viver na tela
    const GRID_MIN_PX = 22;
    const GRID_MAX_PX = 44;
    // Zoom mínimo baixo porque um frame tem 1080px de largura no mundo:
    // sem isso não dá para ver um carrossel inteiro de uma vez
    const MIN_SCALE = 0.05;
    const MAX_SCALE = 4;
    // Namespace próprio para não colidir com os dados do canvas do AnalyticsOnboard
    // no mesmo localhost/navegador.
    const STORAGE_KEY = 'tcm_canvas_v1';

    /* Formatos de post. w/h são os pixels reais do arquivo exportado:
       dentro do mundo, 1 unidade = 1px do PNG final. */
    /* Os três 9:16 têm o mesmo arquivo (1080 × 1920) e safe zones bem diferentes:
       Story tem barra de progresso e campo de resposta, Reels tem legenda menor
       que a do TikTok, e o TikTok é o que mais come rodapé e coluna direita. */
    const FORMATS = {
      'ig-feed':   { name: 'Instagram Feed',    w: 1080, h: 1350 },
      'ig-square': { name: 'Post Quadrado',     w: 1080, h: 1080 },
      'ig-story':  { name: 'Instagram Story',   w: 1080, h: 1920 },
      'reels':     { name: 'Reels',             w: 1080, h: 1920 },
      'story':     { name: 'TikTok',            w: 1080, h: 1920 },
      'pinterest': { name: 'Pinterest',         w: 1000, h: 1500 },
      'yt-thumb':  { name: 'Thumbnail YouTube', w: 1280, h:  720 },
    };
    const FRAME_GAP = 120;
    /* Abaixo disso o rótulo mais longo já é mais largo que o frame inteiro na
       tela (1080 × 0.26 ≈ 280px), então some. Em zoom visual: ~78%. */
    const BADGE_MIN_SCALE = 0.26;
    const BASE_SCALE = 0.3333; // Define que 1/3 da escala real (px final) é o 100% visual na tela

    let cam = { x: 0, y: 0, scale: BASE_SCALE };
    let frames = [];
    let frameSeq = 1;
    let selectedId = null; // ID do primeiro frame selecionado (para retrocompatibilidade)
    let selectedFrameIds = new Set(); // Múltiplos frames (posts) selecionados
    // Ligações entre frames: cada uma diz "este vem depois daquele" no carrossel
    let links = [];
    let linkSeq = 1;
    let selectedLinkId = null;
    let linksLayer = null;
    let linksRoot = null;
    
    let selectedTextNode = { frameId: null, childId: null }; // Primeiro nó filho selecionado
    let selectedChildNodes = []; // Múltiplos nós selecionados: [{ frameId, childId }, ...]
    let isSpacePressed = false;
    let croppingImage = null; // { frameId, childId }
    let childSeq = 1;
    let snapEnabled = localStorage.getItem('oa_canvas_snap') !== 'false';
    let showGuides = localStorage.getItem('oa_canvas_guides') === 'true';

    function getSelectedFrameIds() {
      return Array.from(selectedFrameIds);
    }
    function getSelectedFrames() {
      return frames.filter(f => selectedFrameIds.has(f.id));
    }
    /* O frame ativo da seleção. A exportação precisa de um frame só — quando há
       vários selecionados, manda o que está em `selectedId`. */
    function selectedFrame() {
      return frames.find(f => f.id === selectedId) || getSelectedFrames()[0] || null;
    }
    function isFrameSelected(id) {
      return selectedFrameIds.has(id);
    }
    function isChildNodeSelected(frameId, childId) {
      return selectedChildNodes.some(n => n.frameId === frameId && n.childId === childId);
    }
    
    /* --------------------------------------------------
       Armazenamento de Assets de Imagem em Alta Resolução (IndexedDB)
       Como o Figma/Canva: o JSON do canvas guarda só a referência (assetId),
       e a imagem original (4K/8K/PNG com transparência) é armazenada no IndexedDB
       do navegador sem perda nenhuma de qualidade e sem estourar o limite do localStorage.
       -------------------------------------------------- */
    const DB_NAME = 'oa_canvas_assets_db';
    const DB_VERSION = 1;
    const STORE_NAME = 'assets';
    const assetCache = new Map();

    function openAssetDB() {
      return new Promise((resolve) => {
        if (!window.indexedDB) return resolve(null);
        try {
          const req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
              db.createObjectStore(STORE_NAME);
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }

    /* Fundo de frame pode vir inline (`bgImage`, legado) ou por asset
       (`bgAssetId`). Clonar o data URL inline em cada post estoura a cota do
       localStorage, então tudo que é gerado em lote usa o assetId. */
    function frameBgSrc(frame) {
      if (!frame) return null;
      if (frame.bgImage) return frame.bgImage;
      if (frame.bgAssetId) return assetCache.get(frame.bgAssetId) || null;
      return null;
    }

    function hasFrameBg(frame) {
      return !!(frame && (frame.bgImage || frame.bgAssetId));
    }

    async function saveAsset(id, dataUrl) {
      try {
        const db = await openAssetDB();
        if (!db) return;
        return new Promise((resolve) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(dataUrl, id);
          tx.oncomplete = () => resolve(id);
          tx.onerror = () => resolve(null);
        });
      } catch { /* segue em memória caso IndexedDB falhe */ }
    }

    async function getAsset(id) {
      if (assetCache.has(id)) return assetCache.get(id);
      try {
        const db = await openAssetDB();
        if (!db) return null;
        return new Promise((resolve) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const req = tx.objectStore(STORE_NAME).get(id);
          req.onsuccess = () => {
            const res = req.result || null;
            if (res) assetCache.set(id, res);
            resolve(res);
          };
          req.onerror = () => resolve(null);
        });
      } catch {
        return null;
      }
    }
    
    /* --------------------------------------------------
       Tipografia do nó de texto

       O estilo base vive no nó inteiro, como um text layer do Figma. Com um
       trecho selecionado, porém, a barra passa a mexer só nele: o pedaço vira
       um <span data-run="1"> com o estilo inline, que ganha do nó por ser
       filho. O texto continua indo pro JSON como HTML (child.html), com
       child.text de espelho para o resto do canvas que só quer as letras.

       Nada de document.execCommand aqui: ele não cobre opacidade,
       letter-spacing nem tamanho em px, que é justamente o que a barra tem.
       -------------------------------------------------- */

    // Cada família declara os pesos que o Google Fonts realmente entrega.
    // Pedir 700 numa fonte que só tem 400 devolve peso sintético e borrado.
    const FONTS = [
      { css: '"Inter Tight", sans-serif',      name: 'Inter Tight',      weights: [300, 400, 500, 600, 700, 800] },
      { css: '"Inter", sans-serif',            name: 'Inter',            weights: [300, 400, 500, 600, 700, 800] },
      { css: '"Poppins", sans-serif',          name: 'Poppins',          weights: [300, 400, 500, 600, 700, 800] },
      { css: '"Space Grotesk", sans-serif',    name: 'Space Grotesk',    weights: [300, 400, 500, 600, 700] },
      // Arredondadas: da mais discreta (Nunito) à mais redonda (Fredoka)
      { css: '"Nunito", sans-serif',           name: 'Nunito Rounded',   weights: [300, 400, 500, 600, 700, 800] },
      { css: '"Quicksand", sans-serif',        name: 'Quicksand Rounded', weights: [300, 400, 500, 600, 700] },
      { css: '"Fredoka", sans-serif',          name: 'Fredoka Rounded',  weights: [300, 400, 500, 600] },
      { css: '"Bebas Neue", sans-serif',       name: 'Bebas Neue',       weights: [400] },
      { css: '"Playfair Display", serif',      name: 'Playfair Display', weights: [400, 500, 600, 700, 800, 900] },
      { css: '"DM Serif Display", serif',      name: 'DM Serif Display', weights: [400] },
      { css: '"Lora", serif',                  name: 'Lora',             weights: [400, 500, 600, 700] },
      { css: '"Caveat", cursive',              name: 'Caveat',           weights: [400, 500, 600, 700] },
      { css: '"JetBrains Mono", monospace',    name: 'JetBrains Mono',   weights: [300, 400, 500, 600, 700] },
    ];

    const WEIGHT_NAMES = {
      100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium',
      600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black',
    };

    const TEXT_PRESETS = {
      heading:    { name: 'Título',    fontFamily: '"Inter Tight", sans-serif', fontSize: 56, fontWeight: 800, lineHeight: 1.08, letterSpacing: -0.03, transform: 'none' },
      subheading: { name: 'Subtítulo', fontFamily: '"Inter", sans-serif',       fontSize: 32, fontWeight: 600, lineHeight: 1.2,  letterSpacing: -0.01, transform: 'none' },
      body:       { name: 'Corpo',     fontFamily: '"Inter", sans-serif',       fontSize: 20, fontWeight: 400, lineHeight: 1.45, letterSpacing: 0,     transform: 'none' },
      quote:      { name: 'Citação',   fontFamily: '"Playfair Display", serif', fontSize: 36, fontWeight: 500, italic: true, lineHeight: 1.25, letterSpacing: 0, transform: 'none' },
      badge:      { name: 'Destaque',  fontFamily: '"JetBrains Mono", monospace', fontSize: 14, fontWeight: 700, lineHeight: 1.2, letterSpacing: 0.08, transform: 'uppercase' },
    };

    // Valores de um nó novo e piso para os nós salvos antes destes campos existirem
    const TEXT_DEFAULTS = {
      fontFamily: '"Inter Tight", sans-serif',
      fontSize: 48,
      fontWeight: 700,
      italic: false,
      underline: false,
      color: '#000000',
      bg: '',
      shadow: false,
      align: 'left',
      lineHeight: 1.15,
      letterSpacing: -0.02,
      transform: 'none',
      opacity: 100,
      rotation: 0,
    };

    /* Compara também pelo primeiro nome da pilha: o estilo lido de um trecho
       vem do getComputedStyle, que reescreve as aspas e a lista de fallback. */
    function fontOf(child) {
      const css = child.fontFamily || TEXT_DEFAULTS.fontFamily;
      const first = css.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
      return FONTS.find(f => f.css === css)
        || FONTS.find(f => f.name.toLowerCase() === first)
        || FONTS[0];
    }

    // Ao trocar de família, o peso atual pode não existir lá: cai no mais próximo
    function nearestWeight(font, weight) {
      return font.weights.reduce((best, w) =>
        Math.abs(w - weight) < Math.abs(best - weight) ? w : best, font.weights[0]);
    }

    const textToolbar = document.getElementById('canvas-text-toolbar');
    const advRow = document.getElementById('canvas-text-advanced');
    const selPreset = document.getElementById('canvas-text-preset');
    const selFont = document.getElementById('canvas-text-font');
    const selWeight = document.getElementById('canvas-text-weight');
    const inputSize = document.getElementById('canvas-text-size');
    const btnSizeUp = document.getElementById('canvas-text-size-up');
    const btnSizeDown = document.getElementById('canvas-text-size-down');
    const inputColor = document.getElementById('canvas-text-color');
    const btnBold = document.getElementById('canvas-text-bold');
    const btnItalic = document.getElementById('canvas-text-italic');
    const btnUnderline = document.getElementById('canvas-text-underline');
    // Prefixo "align" para não colidir com os botões de zoom lá embaixo
    const btnAlignLeft = document.getElementById('canvas-text-align-left');
    const btnAlignCenter = document.getElementById('canvas-text-align-center');
    const btnAlignRight = document.getElementById('canvas-text-align-right');
    const btnMore = document.getElementById('canvas-text-more');
    const inputLh = document.getElementById('canvas-text-lh');
    const inputLs = document.getElementById('canvas-text-ls');
    const inputOpacity = document.getElementById('canvas-text-opacity');
    const inputTextRotation = document.getElementById('canvas-text-rotation');
    const inputBg = document.getElementById('canvas-text-bg');
    const btnBgClear = document.getElementById('canvas-text-bg-clear');
    const btnShadow = document.getElementById('canvas-text-shadow');
    const btnCaseNone = document.getElementById('canvas-text-case-none');
    const btnCaseUpper = document.getElementById('canvas-text-case-upper');
    const btnCaseLower = document.getElementById('canvas-text-case-lower');
    const btnTextDup = document.getElementById('canvas-text-dup');
    const btnTextDel = document.getElementById('canvas-text-del');

    /* O estilo mora no .canvas-text-node__content, não no wrapper: o content
       nasce com font-size/color inline, que ganham de qualquer herança. */
    function paintTextStyle(child, node) {
      const content = node || world.querySelector(`.canvas-text-node[data-id="${child.id}"] .canvas-text-node__content`);
      if (!content) return;
      const s = content.style;
      s.fontFamily = child.fontFamily || TEXT_DEFAULTS.fontFamily;
      s.fontSize = `${child.fontSize || TEXT_DEFAULTS.fontSize}px`;
      s.fontWeight = child.fontWeight || TEXT_DEFAULTS.fontWeight;
      s.fontStyle = child.italic ? 'italic' : 'normal';
      s.textDecoration = child.underline ? 'underline' : 'none';
      s.color = child.color || TEXT_DEFAULTS.color;
      s.textAlign = child.align || TEXT_DEFAULTS.align;
      s.lineHeight = String(child.lineHeight || TEXT_DEFAULTS.lineHeight);
      // em, não px: o espaçamento acompanha o tamanho da fonte sozinho
      s.letterSpacing = `${child.letterSpacing != null ? child.letterSpacing : TEXT_DEFAULTS.letterSpacing}em`;
      s.textTransform = child.transform || TEXT_DEFAULTS.transform;
      s.opacity = String((child.opacity != null ? child.opacity : TEXT_DEFAULTS.opacity) / 100);
      s.backgroundColor = child.bg || 'transparent';
      s.padding = child.bg && child.bg !== 'transparent' ? '4px 12px' : '';
      s.borderRadius = child.bg && child.bg !== 'transparent' ? '8px' : '';
      s.textShadow = child.shadow ? '0 2px 10px rgba(0,0,0,0.55)' : 'none';
    }

    function selectedChild() {
      const frame = frames.find(f => f.id === selectedTextNode.frameId);
      if (!frame) return null;
      return (frame.children || []).find(c => c.id === selectedTextNode.childId) || null;
    }

    function contentOf(child) {
      return world.querySelector(`.canvas-text-node[data-id="${child.id}"] .canvas-text-node__content`);
    }

    /* --------------------------------------------------
       Estilo de trecho (só o pedaço selecionado)
       -------------------------------------------------- */

    // Cada propriedade do modelo e o CSS equivalente num span de trecho
    const INLINE_CSS = {
      fontFamily:    { prop: 'fontFamily',      to: v => v },
      fontSize:      { prop: 'fontSize',        to: v => `${v}px` },
      fontWeight:    { prop: 'fontWeight',      to: v => String(v) },
      italic:        { prop: 'fontStyle',       to: v => (v ? 'italic' : 'normal') },
      underline:     { prop: 'textDecoration',  to: v => (v ? 'underline' : 'none') },
      color:         { prop: 'color',           to: v => v },
      bg:            { prop: 'backgroundColor', to: v => v || 'transparent' },
      shadow:        { prop: 'textShadow',      to: v => (v ? '0 2px 10px rgba(0, 0, 0, 0.55)' : 'none') },
      letterSpacing: { prop: 'letterSpacing',   to: v => `${v}em` },
      transform:     { prop: 'textTransform',   to: v => v },
      opacity:       { prop: 'opacity',         to: v => String(v / 100) },
    };

    // Alinhar ou espaçar linha meio parágrafo não existe: essas seguem do bloco
    const BLOCK_KEYS = ['align', 'lineHeight', 'rotation'];

    let savedRange = null;

    function contentAncestorOf(node) {
      const el = node.nodeType === 1 ? node : node.parentElement;
      return el ? el.closest('.canvas-text-node__content') : null;
    }

    /* Guarda o último trecho marcado. Ao clicar num campo da barra o foco sai
       do texto e o navegador descarta a seleção — por isso ela é lembrada
       aqui, e só é esquecida quando o próprio texto colapsa o cursor. */
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!contentAncestorOf(range.startContainer)) return; // seleção foi pra barra
      savedRange = sel.isCollapsed ? null : range.cloneRange();
    });

    /* O trecho só vale enquanto o foco está no texto ou na própria barra:
       clicar num botão preserva o range (o mousedown faz preventDefault), mas
       clicar fora, no canvas, volta a valer para o nó inteiro. */
    function activeTextRange(content) {
      if (!savedRange || savedRange.collapsed || !content) return null;
      const active = document.activeElement;
      if (active !== content && !(textToolbar && textToolbar.contains(active))) return null;
      if (!content.contains(savedRange.startContainer)) return null;
      if (!content.contains(savedRange.endContainer)) return null;
      return savedRange;
    }

    function rgbToHex(color) {
      const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color || '');
      if (!m) return color && color[0] === '#' ? color : TEXT_DEFAULTS.color;
      return '#' + [1, 2, 3].map(i => Number(m[i]).toString(16).padStart(2, '0')).join('');
    }

    /* Lê o estilo que está valendo no começo do trecho, no formato do modelo.
       É o que faz ⌘B, itálico e ± tamanho partirem do que está na tela e não
       do estilo do bloco. */
    function styleProbe(range, child) {
      const start = range.startContainer;
      const el = start.nodeType === 1 ? start : start.parentElement;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize) || TEXT_DEFAULTS.fontSize;
      const ls = parseFloat(cs.letterSpacing);
      // opacity não é herdada: sem span próprio, o número que vale é o do nó
      const run = el.closest('span[data-run="1"]');
      const runOpacity = run && run.style.opacity ? parseFloat(run.style.opacity) : null;
      const runBg = run && run.style.backgroundColor ? rgbToHex(run.style.backgroundColor) : '';
      const runShadow = run && run.style.textShadow && run.style.textShadow !== 'none';
      return {
        fontFamily: cs.fontFamily,
        fontSize: Math.round(size),
        fontWeight: Number(cs.fontWeight) || TEXT_DEFAULTS.fontWeight,
        italic: cs.fontStyle === 'italic',
        underline: (cs.textDecorationLine || cs.textDecoration || '').includes('underline'),
        color: rgbToHex(cs.color),
        bg: runBg || (child && child.bg) || '',
        shadow: runShadow || (child && !!child.shadow),
        letterSpacing: Number.isNaN(ls) ? 0 : Math.round((ls / size) * 1000) / 1000,
        transform: cs.textTransform,
        opacity: runOpacity !== null
          ? Math.round(runOpacity * 100)
          : (child && child.opacity != null ? child.opacity : TEXT_DEFAULTS.opacity),
      };
    }

    function applyCssTo(el, patch) {
      Object.keys(patch).forEach(k => {
        const rule = INLINE_CSS[k];
        if (rule) el.style[rule.prop] = rule.to(patch[k]);
      });
    }

    /* Quebra os text nodes nas pontas do trecho e envolve o miolo em spans.
       Reusa o span quando ele já é o pai exclusivo daquele texto, senão cada
       clique na barra empilharia uma camada nova. */
    function styleRange(content, range, patch) {
      // O fim primeiro: partir o começo mudaria o nó onde o fim está ancorado
      if (range.endContainer.nodeType === 3 && range.endOffset < range.endContainer.length) {
        range.endContainer.splitText(range.endOffset);
      }
      if (range.startContainer.nodeType === 3 && range.startOffset > 0) {
        range.setStart(range.startContainer.splitText(range.startOffset), 0);
      }

      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      const targets = [];
      while (walker.nextNode()) {
        const n = walker.currentNode;
        if (n.nodeValue && range.intersectsNode(n)) targets.push(n);
      }
      if (!targets.length) return;

      targets.forEach(n => {
        const parent = n.parentElement;
        const reusable = parent !== content
          && parent.dataset.run === '1'
          && parent.childNodes.length === 1;
        if (reusable) {
          applyCssTo(parent, patch);
          return;
        }
        const span = document.createElement('span');
        span.dataset.run = '1';
        parent.insertBefore(span, n);
        span.appendChild(n);
        applyCssTo(span, patch);
      });

      // O trecho tem que sobreviver: o usuário ainda está arrastando o slider
      const last = targets[targets.length - 1];
      const next = document.createRange();
      next.setStart(targets[0], 0);
      next.setEnd(last, last.length);
      savedRange = next;
      if (document.activeElement === content) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(next);
      }
    }

    /* Mexer no nó inteiro tem que vencer os trechos: senão o usuário troca a
       cor e um pedaço fica pra trás sem explicação nenhuma. */
    function clearRunStyles(content, keys) {
      content.querySelectorAll('span[data-run="1"]').forEach(span => {
        keys.forEach(k => {
          const rule = INLINE_CSS[k];
          if (rule) span.style[rule.prop] = '';
        });
        if (span.style.cssText) return;
        // Span sem estilo nenhum só atrapalha: devolve o texto ao pai
        const parent = span.parentNode;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
        parent.normalize();
      });
    }

    // O HTML é a fonte da verdade; o texto puro segue de espelho
    function syncTextHtml(child, content) {
      child.html = content.innerHTML;
      child.text = content.textContent;
    }

    function applyTextToolbarAction(action) {
      if (selectedChildNodes.length === 0) return;
      if (selectedChildNodes.length === 1) {
        const child = selectedChild();
        if (!child || child.type !== 'text') return;
        const content = contentOf(child);
        const range = activeTextRange(content);

        if (range) {
          // Trecho marcado: o estilo vai pro span, não pro nó
          const probe = styleProbe(range, child);
          const before = { ...probe };
          action(probe);
          const patch = {};
          let touchedBlock = false;
          Object.keys(probe).forEach(k => {
            if (probe[k] === before[k]) return;
            if (BLOCK_KEYS.includes(k)) {
              child[k] = probe[k];
              touchedBlock = true;
            } else if (INLINE_CSS[k]) {
              patch[k] = probe[k];
            }
          });
          if (Object.keys(patch).length) styleRange(content, range, patch);
          if (touchedBlock) paintTextStyle(child, content);
          const el = nodeElement(child.id);
          if (el) {
            el.style.transform = child.rotation ? `rotate(${child.rotation}deg)` : '';
            el.style.transformOrigin = 'center center';
          }
          syncTextHtml(child, content);
        } else {
          const before = { ...child };
          action(child);
          paintTextStyle(child, content);
          const el = nodeElement(child.id);
          if (el) {
            el.style.transform = child.rotation ? `rotate(${child.rotation}deg)` : '';
            el.style.transformOrigin = 'center center';
          }
          const changed = Object.keys(child).filter(k => INLINE_CSS[k] && child[k] !== before[k]);
          if (content && changed.length) {
            clearRunStyles(content, changed);
            syncTextHtml(child, content);
          }
        }
      } else {
        selectedChildNodes.forEach(sel => {
          const frame = frames.find(f => f.id === sel.frameId);
          if (!frame) return;
          const child = (frame.children || []).find(c => c.id === sel.childId);
          if (!child || child.type !== 'text') return;
          const content = contentOf(child);
          const before = { ...child };
          action(child);
          paintTextStyle(child, content);
          const el = nodeElement(child.id);
          if (el) {
            el.style.transform = child.rotation ? `rotate(${child.rotation}deg)` : '';
            el.style.transformOrigin = 'center center';
          }
          const changed = Object.keys(child).filter(k => INLINE_CSS[k] && child[k] !== before[k]);
          if (content && changed.length) {
            clearRunStyles(content, changed);
            syncTextHtml(child, content);
          }
        });
      }

      updateTextToolbar(); // a altura muda com a fonte: a barra acompanha
      save();
    }

    // Preenche o seletor de famílias
    function refreshFontSelect() {
      if (!selFont) return;
      const currentVal = selFont.value;
      selFont.innerHTML = '';
      FONTS.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.css;
        opt.textContent = f.name;
        opt.style.fontFamily = f.css;
        selFont.appendChild(opt);
      });
      if (currentVal) selFont.value = currentVal;
    }

    if (selFont) {
      refreshFontSelect();
      selFont.addEventListener('change', (e) => applyTextToolbarAction(c => {
        c.fontFamily = e.target.value;
        c.fontWeight = nearestWeight(fontOf(c), c.fontWeight || TEXT_DEFAULTS.fontWeight);
      }));
    }

    if (selWeight) {
      selWeight.addEventListener('change', (e) =>
        applyTextToolbarAction(c => c.fontWeight = Number(e.target.value)));
    }

    // Repovoa os pesos conforme a família escolhida
    function fillWeightOptions(child) {
      if (!selWeight) return;
      const font = fontOf(child);
      const current = String(child.fontWeight || TEXT_DEFAULTS.fontWeight);
      const same = Array.from(selWeight.options).map(o => o.value).join(',') === font.weights.join(',');
      if (!same) {
        selWeight.innerHTML = '';
        font.weights.forEach(w => {
          const opt = document.createElement('option');
          opt.value = String(w);
          opt.textContent = WEIGHT_NAMES[w] || String(w);
          selWeight.appendChild(opt);
        });
      }
      selWeight.value = current;
      selWeight.disabled = font.weights.length < 2;
    }

    if (selPreset) {
      selPreset.addEventListener('change', (e) => {
        const key = e.target.value;
        if (!key || !TEXT_PRESETS[key]) return;
        const p = TEXT_PRESETS[key];
        applyTextToolbarAction(c => {
          Object.assign(c, p);
        });
        selPreset.value = '';
      });
    }

    /* Campo vazio ou zerado não some com o texto: ignora até virar número.
       Sem mínimo aqui de propósito — digitar "1" antes do "2" precisa passar. */
    if (inputSize) inputSize.addEventListener('input', (e) => {
      const size = Number(e.target.value);
      if (!size || size < 0) return;
      applyTextToolbarAction(c => c.fontSize = Math.min(400, size));
    });

    function stepSize(delta) {
      applyTextToolbarAction(c => {
        c.fontSize = Math.min(400, Math.max(8, (c.fontSize || TEXT_DEFAULTS.fontSize) + delta));
      });
    }
    if (btnSizeUp) btnSizeUp.addEventListener('click', () => stepSize(4));
    if (btnSizeDown) btnSizeDown.addEventListener('click', () => stepSize(-4));

    if (inputColor) inputColor.addEventListener('input', (e) => applyTextToolbarAction(c => c.color = e.target.value));

    /* B alterna entre o peso mais leve e o mais pesado que a família oferece:
       em Bebas Neue, que só tem 400, o botão fica sem efeito e desativado. */
    function toggleBold() {
      applyTextToolbarAction(c => {
        const font = fontOf(c);
        if (font.weights.length < 2) return;
        const bold = font.weights[font.weights.length - 1];
        const regular = font.weights.includes(400) ? 400 : font.weights[0];
        c.fontWeight = (c.fontWeight || TEXT_DEFAULTS.fontWeight) >= bold ? regular : bold;
      });
    }
    if (btnBold) btnBold.addEventListener('click', toggleBold);
    if (btnItalic) btnItalic.addEventListener('click', () => applyTextToolbarAction(c => c.italic = !c.italic));
    if (btnUnderline) btnUnderline.addEventListener('click', () => applyTextToolbarAction(c => c.underline = !c.underline));

    if (btnAlignLeft) btnAlignLeft.addEventListener('click', () => applyTextToolbarAction(c => c.align = 'left'));
    if (btnAlignCenter) btnAlignCenter.addEventListener('click', () => applyTextToolbarAction(c => c.align = 'center'));
    if (btnAlignRight) btnAlignRight.addEventListener('click', () => applyTextToolbarAction(c => c.align = 'right'));

    const btnTextPosCenterH = document.getElementById('canvas-text-pos-center-h');
    const btnTextPosCenterV = document.getElementById('canvas-text-pos-center-v');
    const btnTextPosCenterBoth = document.getElementById('canvas-text-pos-center-both');
    if (btnTextPosCenterH) btnTextPosCenterH.addEventListener('click', () => alignSelectedNodes('center-h'));
    if (btnTextPosCenterV) btnTextPosCenterV.addEventListener('click', () => alignSelectedNodes('center-v'));
    if (btnTextPosCenterBoth) btnTextPosCenterBoth.addEventListener('click', () => alignSelectedNodes('center-both'));

    if (inputLh) inputLh.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      if (!v) return;
      applyTextToolbarAction(c => c.lineHeight = Math.min(4, Math.max(0.5, v)));
    });
    if (inputLs) inputLs.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      if (Number.isNaN(v)) return;
      applyTextToolbarAction(c => c.letterSpacing = Math.min(1, Math.max(-0.2, v)));
    });
    if (inputOpacity) inputOpacity.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      if (Number.isNaN(v)) return;
      applyTextToolbarAction(c => c.opacity = Math.min(100, Math.max(0, v)));
    });
    if (inputTextRotation) inputTextRotation.addEventListener('input', (e) => {
      let v = Number(e.target.value) || 0;
      v = ((Math.round(v) % 360) + 360) % 360;
      applyTextToolbarAction(c => c.rotation = v);
    });

    if (inputBg) inputBg.addEventListener('input', (e) => applyTextToolbarAction(c => c.bg = e.target.value));
    if (btnBgClear) btnBgClear.addEventListener('click', () => applyTextToolbarAction(c => c.bg = ''));
    if (btnShadow) btnShadow.addEventListener('click', () => applyTextToolbarAction(c => c.shadow = !c.shadow));

    if (btnCaseNone) btnCaseNone.addEventListener('click', () => applyTextToolbarAction(c => c.transform = 'none'));
    if (btnCaseUpper) btnCaseUpper.addEventListener('click', () => applyTextToolbarAction(c => c.transform = 'uppercase'));
    if (btnCaseLower) btnCaseLower.addEventListener('click', () => applyTextToolbarAction(c => c.transform = 'lowercase'));

    if (btnMore && advRow) btnMore.addEventListener('click', () => {
      const open = advRow.classList.toggle('is-open');
      btnMore.classList.toggle('is-active', open);
      updateTextToolbar();
    });

    /* Clicar num botão da toolbar tirava o foco do texto (e a seleção junto).
       Inputs e selects seguem recebendo foco: sem isso os campos param. */
    if (textToolbar) textToolbar.addEventListener('mousedown', (e) => {
      if (!e.target.closest('input, select')) e.preventDefault();
    });
    if (btnTextBind) btnTextBind.addEventListener('click', () => toggleBind());
    if (btnImageBind) btnImageBind.addEventListener('click', () => toggleBind());

    if (btnTextDup) btnTextDup.addEventListener('click', () => duplicateTextNode());
    if (btnTextDel) btnTextDel.addEventListener('click', () => deleteTextNode());

    const btnTextSendBack = document.getElementById('canvas-text-send-back');
    const btnTextBackward = document.getElementById('canvas-text-backward');
    const btnTextForward = document.getElementById('canvas-text-forward');
    const btnTextBringFront = document.getElementById('canvas-text-bring-front');

    if (btnTextSendBack) btnTextSendBack.addEventListener('click', () => sendChildToBack());
    if (btnTextBackward) btnTextBackward.addEventListener('click', () => sendChildBackward());
    if (btnTextForward) btnTextForward.addEventListener('click', () => bringChildForward());
    if (btnTextBringFront) btnTextBringFront.addEventListener('click', () => bringChildToFront());

    const imageToolbar = document.getElementById('canvas-image-toolbar');
    const btnImageCrop = document.getElementById('canvas-image-crop');
    const inputRadius = document.getElementById('canvas-image-radius');
    const inputBorderWidth = document.getElementById('canvas-image-border-width');
    const inputBorderColor = document.getElementById('canvas-image-border-color');
    const inputImageOpacity = document.getElementById('canvas-image-opacity');
    const inputImageRotation = document.getElementById('canvas-image-rotation');
    const inputBlur = document.getElementById('canvas-image-blur');
    const inputShadow = document.getElementById('canvas-image-shadow');
    const btnImageMore = document.getElementById('canvas-image-more');
    const imageAdvRow = document.getElementById('canvas-image-advanced');
    const btnImageDup = document.getElementById('canvas-image-dup');
    const btnImageDel = document.getElementById('canvas-image-del');

    const cropToolbar = document.getElementById('canvas-crop-toolbar');
    const btnCropZoomOut = document.getElementById('canvas-crop-zoom-out');
    const btnCropZoomIn = document.getElementById('canvas-crop-zoom-in');
    const inputCropZoomVal = document.getElementById('canvas-crop-zoom-val');
    const btnCropReset = document.getElementById('canvas-crop-reset');
    const btnCropDone = document.getElementById('canvas-crop-done');

    function ensureImageProps(child) {
      if (!child || child.type !== 'image') return;
      if (!child.origW || !child.origH) {
        child.origW = child.w || 400;
        child.origH = child.h || 300;
      }
      if (child.imgW === undefined || child.imgH === undefined) {
        child.imgW = child.w;
        child.imgH = child.h;
        child.imgX = 0;
        child.imgY = 0;
        child.zoom = 1.0;
      }
      if (child.zoom === undefined) child.zoom = 1.0;
      if (child.imgX === undefined) child.imgX = 0;
      if (child.imgY === undefined) child.imgY = 0;
      if (child.rotation === undefined) child.rotation = 0;
    }

    function updateImageNodeDOM(child, el) {
      ensureImageProps(child);
      el.style.left = `${child.x}px`;
      el.style.top = `${child.y}px`;
      el.style.width = `${child.w}px`;
      el.style.height = `${child.h}px`;
      el.style.transform = child.rotation ? `rotate(${child.rotation}deg)` : '';
      el.style.transformOrigin = 'center center';
      el.style.borderRadius = `${child.borderRadius || 0}px`;

      const clip = el.querySelector('.canvas-image-node__clip');
      if (clip) {
        clip.style.borderRadius = `${child.borderRadius || 0}px`;
        clip.style.borderWidth = `${child.borderWidth || 0}px`;
        clip.style.borderColor = child.borderColor || 'transparent';
        clip.style.borderStyle = child.borderWidth ? 'solid' : 'none';
        clip.style.boxSizing = 'border-box';
        clip.style.overflow = 'hidden';
      }

      const img = el.querySelector('.canvas-image-node__img');
      if (img) {
        img.style.left = `${child.imgX}px`;
        img.style.top = `${child.imgY}px`;
        img.style.width = `${child.imgW}px`;
        img.style.height = `${child.imgH}px`;
        img.style.border = 'none';
        img.style.borderRadius = '0';
        img.style.opacity = (child.opacity !== undefined ? child.opacity : 100) / 100;
        let filters = [];
        if (child.blur) filters.push(`blur(${child.blur}px)`);
        if (child.shadow) filters.push(`drop-shadow(0px ${child.shadow}px ${child.shadow * 1.5}px rgba(0,0,0,0.3))`);
        img.style.filter = filters.length > 0 ? filters.join(' ') : 'none';
      }

      const ghostImg = el.querySelector('.canvas-image-node__ghost-img');
      if (ghostImg) {
        ghostImg.style.left = `${child.imgX}px`;
        ghostImg.style.top = `${child.imgY}px`;
        ghostImg.style.width = `${child.imgW}px`;
        ghostImg.style.height = `${child.imgH}px`;
      }

      // Mantém o chrome de seleção colado na imagem
      const chrome = world.querySelector(`.canvas-image-chrome[data-id="${child.id}"]`);
      if (chrome) positionImageChrome(chrome, child);

    }


    function enterCropMode(frameId, childId) {
      const frame = frames.find(f => f.id === frameId);
      if (!frame) return;
      const child = (frame.children || []).find(c => c.id === childId);
      if (!child || child.type !== 'image') return;
      ensureImageProps(child);

      croppingImage = { frameId, childId };
      selectTextNode(frameId, childId);

      const el = world.querySelector(`.canvas-image-node[data-id="${childId}"]`);
      if (el) {
        el.classList.add('is-cropping');
        updateImageNodeDOM(child, el);
        updateCropToolbar();
      }
      if (window.lucide) lucide.createIcons();
    }

    function exitCropMode() {
      if (!croppingImage) return;
      const { childId } = croppingImage;
      const el = world.querySelector(`.canvas-image-node[data-id="${childId}"]`);
      if (el) el.classList.remove('is-cropping');
      
      croppingImage = null;
      if (cropToolbar) cropToolbar.classList.remove('is-visible');
      save();
      updateTextToolbar();
    }

    function setCropZoom(newZoom) {
      if (!croppingImage) return;
      const frame = frames.find(f => f.id === croppingImage.frameId);
      if (!frame) return;
      const child = (frame.children || []).find(c => c.id === croppingImage.childId);
      if (!child) return;
      ensureImageProps(child);

      const clampedZoom = Math.min(5, Math.max(1, newZoom));
      const oldZoom = child.zoom || 1.0;
      if (Math.abs(clampedZoom - oldZoom) < 0.001) return;

      const ratio = clampedZoom / oldZoom;
      
      // Zoom centrado no ponto médio da máscara
      const centerX = child.w / 2;
      const centerY = child.h / 2;
      const relX = child.imgX - centerX;
      const relY = child.imgY - centerY;

      child.imgW = Math.round(child.imgW * ratio);
      child.imgH = Math.round(child.imgH * ratio);
      child.imgX = Math.round(centerX + relX * ratio);
      child.imgY = Math.round(centerY + relY * ratio);
      child.zoom = Math.round(clampedZoom * 100) / 100;

      const el = world.querySelector(`.canvas-image-node[data-id="${child.id}"]`);
      if (el) updateImageNodeDOM(child, el);
      if (inputCropZoomVal && document.activeElement !== inputCropZoomVal) {
        inputCropZoomVal.value = Math.round(child.zoom * 100);
      }
      save();
    }

    function resetCrop(child, el) {
      ensureImageProps(child);
      const aspect = (child.origW && child.origH) ? (child.origW / child.origH) : (child.w / child.h);
      let targetW = child.w;
      let targetH = Math.round(targetW / aspect);
      if (targetH < child.h) {
        targetH = child.h;
        targetW = Math.round(targetH * aspect);
      }
      child.imgW = targetW;
      child.imgH = targetH;
      child.imgX = Math.round((child.w - targetW) / 2);
      child.imgY = Math.round((child.h - targetH) / 2);
      child.zoom = 1.0;
      if (el) updateImageNodeDOM(child, el);
      if (inputCropZoomVal) inputCropZoomVal.value = 100;
      save();
    }

    function updateCropToolbar() {
      if (!cropToolbar) return;
      if (!croppingImage) {
        cropToolbar.classList.remove('is-visible');
        return;
      }
      const frame = frames.find(f => f.id === croppingImage.frameId);
      if (!frame) return;
      const child = (frame.children || []).find(c => c.id === croppingImage.childId);
      if (!child) return;

      if (inputCropZoomVal && document.activeElement !== inputCropZoomVal) {
        inputCropZoomVal.value = Math.round((child.zoom || 1.0) * 100);
      }

      const el = world.querySelector(`.canvas-image-node[data-id="${child.id}"]`);
      if (el) {
        const rect = el.getBoundingClientRect();
        const barH = cropToolbar.offsetHeight || 44;
        const half = (cropToolbar.offsetWidth || 280) / 2;
        const top = rect.top - barH - 16;
        cropToolbar.style.top = `${top < 76 ? Math.min(innerHeight - barH - 16, rect.bottom + 16) : top}px`;
        cropToolbar.style.left = `${Math.min(innerWidth - half - 16, Math.max(half + 16, rect.left + rect.width / 2))}px`;
        cropToolbar.classList.add('is-visible');
      }
    }

    function applyImageToolbarAction(action) {
      if (selectedChildNodes.length === 0) return;
      selectedChildNodes.forEach(sel => {
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame) return;
        const child = (frame.children || []).find(c => c.id === sel.childId);
        if (!child || child.type !== 'image') return;
        action(child);
        const el = world.querySelector(`.canvas-image-node[data-id="${child.id}"]`);
        if (el) updateImageNodeDOM(child, el);
      });
      save();
    }
    
    if (btnImageCrop) {
      btnImageCrop.addEventListener('click', () => {
        const child = selectedChild();
        if (child && child.type === 'image') {
          enterCropMode(selectedTextNode.frameId, child.id);
        }
      });
    }

    if (btnCropZoomIn) {
      btnCropZoomIn.addEventListener('click', () => {
        if (!croppingImage) return;
        const child = selectedChild();
        if (!child || child.type !== 'image') return;
        ensureImageProps(child);
        setCropZoom((child.zoom || 1.0) + 0.15);
      });
    }

    if (btnCropZoomOut) {
      btnCropZoomOut.addEventListener('click', () => {
        if (!croppingImage) return;
        const child = selectedChild();
        if (!child || child.type !== 'image') return;
        ensureImageProps(child);
        setCropZoom((child.zoom || 1.0) - 0.15);
      });
    }

    if (inputCropZoomVal) {
      inputCropZoomVal.addEventListener('input', (e) => {
        if (!croppingImage) return;
        const child = selectedChild();
        if (!child || child.type !== 'image') return;
        ensureImageProps(child);
        const pct = Number(e.target.value) || 100;
        setCropZoom(pct / 100);
      });
    }

    if (btnCropReset) {
      btnCropReset.addEventListener('click', () => {
        if (!croppingImage) return;
        const child = selectedChild();
        if (!child || child.type !== 'image') return;
        const el = world.querySelector(`.canvas-image-node[data-id="${child.id}"]`);
        resetCrop(child, el);
      });
    }

    if (btnCropDone) {
      btnCropDone.addEventListener('click', () => exitCropMode());
    }

    if (cropToolbar) {
      cropToolbar.addEventListener('mousedown', (e) => {
        if (!e.target.closest('input')) e.preventDefault();
      });
    }

    /* --------------------------------------------------
       MODO DE REPOSICIONAMENTO DA FOTO DE FUNDO (CANVA/FIGMA STYLE)
       -------------------------------------------------- */
    let repositioningFrameId = null;
    let isPanningBg = false;

    function enterFrameBgRepositionMode(frameId) {
      const frame = frames.find(f => f.id === frameId);
      if (!frame || !hasFrameBg(frame)) return;

      if (croppingImage) exitCropMode();

      repositioningFrameId = frame.id;
      selectFrame(frame.id);

      world.querySelectorAll('.canvas-frame').forEach(fEl => {
        fEl.classList.toggle('is-repositioning-bg', Number(fEl.dataset.id) === frame.id);
      });

      updateTextToolbar();
      if (window.lucide) lucide.createIcons();
      toast.info('Arraste com o mouse para mover a foto de fundo (Enter/Esc para concluir)');
    }

    function exitFrameBgRepositionMode() {
      if (!repositioningFrameId) return;
      repositioningFrameId = null;
      world.querySelectorAll('.canvas-frame').forEach(fEl => {
        fEl.classList.remove('is-repositioning-bg', 'is-panning-bg');
      });
      const bgRepositionToolbar = document.getElementById('canvas-bg-reposition-toolbar');
      if (bgRepositionToolbar) bgRepositionToolbar.classList.remove('is-visible');
      save();
      updateTextToolbar();
    }

    function setFrameBgZoom(newZoom) {
      if (!repositioningFrameId) return;
      const frame = frames.find(f => f.id === repositioningFrameId);
      if (!frame || !hasFrameBg(frame)) return;

      frame.bgZoom = Math.min(300, Math.max(100, Math.round(newZoom)));
      applyFrameBackground(frame);

      const inputZoom = document.getElementById('canvas-bg-reposition-zoom');
      const inputFrameZoom = document.getElementById('canvas-frame-zoom');
      if (inputZoom && document.activeElement !== inputZoom) inputZoom.value = frame.bgZoom;
      if (inputFrameZoom && document.activeElement !== inputFrameZoom) inputFrameZoom.value = frame.bgZoom;

      save();
    }

    function startFrameBgPan(e, frame, el) {
      e.stopPropagation();
      e.preventDefault();

      let startX = e.clientX;
      let startY = e.clientY;
      let initPosX = frame.bgPosX != null ? frame.bgPosX : 50;
      let initPosY = frame.bgPosY != null ? frame.bgPosY : 50;
      let zoom = (frame.bgZoom || 100) / 100;

      isPanningBg = true;
      if (el) el.classList.add('is-panning-bg');

      const onMove = (ev) => {
        const deltaScreenX = ev.clientX - startX;
        const deltaScreenY = ev.clientY - startY;

        const deltaWorldX = deltaScreenX / cam.scale;
        const deltaWorldY = deltaScreenY / cam.scale;

        // Sensibilidade de arrasto proporcional ao tamanho do post e zoom
        const sensX = 100 / Math.max(150, frame.w * (zoom > 1 ? zoom : 0.85));
        const sensY = 100 / Math.max(150, frame.h * (zoom > 1 ? zoom : 0.85));

        // Arrastar para BAIXO mostra mais o topo (bgPosY diminui); arrastar para CIMA mostra a base (bgPosY aumenta)
        const newPosY = Math.max(0, Math.min(100, Math.round(initPosY - (deltaWorldY * sensY))));
        const newPosX = Math.max(0, Math.min(100, Math.round(initPosX - (deltaWorldX * sensX))));

        frame.bgPosX = newPosX;
        frame.bgPosY = newPosY;

        applyFrameBackground(frame, el);

        const inputY = document.getElementById('canvas-bg-reposition-pos-y');
        const inputX = document.getElementById('canvas-bg-reposition-pos-x');
        const inputFramePosY = document.getElementById('canvas-frame-pos-y');
        const inputFramePosX = document.getElementById('canvas-frame-pos-x');
        if (inputY && document.activeElement !== inputY) inputY.value = newPosY;
        if (inputX && document.activeElement !== inputX) inputX.value = newPosX;
        if (inputFramePosY && document.activeElement !== inputFramePosY) inputFramePosY.value = newPosY;
        if (inputFramePosX && document.activeElement !== inputFramePosX) inputFramePosX.value = newPosX;
      };

      const onUp = () => {
        isPanningBg = false;
        if (el) el.classList.remove('is-panning-bg');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        save();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    function updateBgRepositionToolbar() {
      const bgRepositionToolbar = document.getElementById('canvas-bg-reposition-toolbar');
      if (!bgRepositionToolbar) return;
      if (!repositioningFrameId) {
        bgRepositionToolbar.classList.remove('is-visible');
        return;
      }

      const frame = frames.find(f => f.id === repositioningFrameId);
      if (!frame || !hasFrameBg(frame)) {
        exitFrameBgRepositionMode();
        return;
      }

      const frameEl = frameElOf(frame);
      if (!frameEl) return;

      const r = frameEl.getBoundingClientRect();
      const barH = bgRepositionToolbar.offsetHeight || 48;
      const half = (bgRepositionToolbar.offsetWidth || 380) / 2;
      const boxCenterX = (r.left + r.right) / 2;
      const top = r.top - barH - 12;

      bgRepositionToolbar.style.top = `${top < 76 ? Math.min(innerHeight - barH - 16, r.bottom + 12) : top}px`;
      bgRepositionToolbar.style.left = `${Math.min(innerWidth - half - 12, Math.max(half + 12, boxCenterX))}px`;

      const inputY = document.getElementById('canvas-bg-reposition-pos-y');
      const inputX = document.getElementById('canvas-bg-reposition-pos-x');
      const inputZoom = document.getElementById('canvas-bg-reposition-zoom');

      if (inputY && document.activeElement !== inputY) inputY.value = frame.bgPosY != null ? frame.bgPosY : 50;
      if (inputX && document.activeElement !== inputX) inputX.value = frame.bgPosX != null ? frame.bgPosX : 50;
      if (inputZoom && document.activeElement !== inputZoom) inputZoom.value = frame.bgZoom || 100;

      bgRepositionToolbar.classList.add('is-visible');
    }

    // Botões e inputs da barra de reposicionamento de foto de fundo
    const btnBgRepositionDone = document.getElementById('canvas-bg-reposition-done');
    const btnBgRepositionReset = document.getElementById('canvas-bg-reposition-reset');
    const btnBgZoomIn = document.getElementById('canvas-bg-zoom-in');
    const btnBgZoomOut = document.getElementById('canvas-bg-zoom-out');
    const inputBgPosY = document.getElementById('canvas-bg-reposition-pos-y');
    const inputBgPosX = document.getElementById('canvas-bg-reposition-pos-x');
    const inputBgZoom = document.getElementById('canvas-bg-reposition-zoom');

    if (btnBgRepositionDone) {
      btnBgRepositionDone.addEventListener('click', () => exitFrameBgRepositionMode());
    }

    if (btnBgRepositionReset) {
      btnBgRepositionReset.addEventListener('click', () => {
        if (!repositioningFrameId) return;
        const frame = frames.find(f => f.id === repositioningFrameId);
        if (!frame) return;
        frame.bgPosX = 50;
        frame.bgPosY = 50;
        frame.bgZoom = 100;
        applyFrameBackground(frame);
        updateBgRepositionToolbar();
        save();
      });
    }

    if (btnBgZoomIn) {
      btnBgZoomIn.addEventListener('click', () => {
        if (!repositioningFrameId) return;
        const frame = frames.find(f => f.id === repositioningFrameId);
        if (!frame) return;
        setFrameBgZoom((frame.bgZoom || 100) + 10);
      });
    }

    if (btnBgZoomOut) {
      btnBgZoomOut.addEventListener('click', () => {
        if (!repositioningFrameId) return;
        const frame = frames.find(f => f.id === repositioningFrameId);
        if (!frame) return;
        setFrameBgZoom((frame.bgZoom || 100) - 10);
      });
    }

    if (inputBgPosY) {
      inputBgPosY.addEventListener('input', (e) => {
        if (!repositioningFrameId) return;
        const frame = frames.find(f => f.id === repositioningFrameId);
        if (!frame) return;
        frame.bgPosY = Number(e.target.value);
        applyFrameBackground(frame);
        save();
      });
    }

    if (inputBgPosX) {
      inputBgPosX.addEventListener('input', (e) => {
        if (!repositioningFrameId) return;
        const frame = frames.find(f => f.id === repositioningFrameId);
        if (!frame) return;
        frame.bgPosX = Number(e.target.value);
        applyFrameBackground(frame);
        save();
      });
    }

    if (inputBgZoom) {
      inputBgZoom.addEventListener('input', (e) => {
        if (!repositioningFrameId) return;
        setFrameBgZoom(Number(e.target.value));
      });
    }

    if (inputRadius) inputRadius.addEventListener('input', (e) => applyImageToolbarAction(c => c.borderRadius = Number(e.target.value) || 0));
    if (inputBorderWidth) inputBorderWidth.addEventListener('input', (e) => applyImageToolbarAction(c => c.borderWidth = Number(e.target.value) || 0));
    if (inputBorderColor) inputBorderColor.addEventListener('input', (e) => applyImageToolbarAction(c => c.borderColor = e.target.value));
    if (inputImageOpacity) inputImageOpacity.addEventListener('input', (e) => applyImageToolbarAction(c => c.opacity = Math.min(100, Math.max(0, Number(e.target.value) || 0))));
    if (inputImageRotation) inputImageRotation.addEventListener('input', (e) => {
      let v = Number(e.target.value) || 0;
      v = ((Math.round(v) % 360) + 360) % 360;
      applyImageToolbarAction(c => c.rotation = v);
    });
    if (inputBlur) inputBlur.addEventListener('input', (e) => applyImageToolbarAction(c => c.blur = Number(e.target.value) || 0));
    if (inputShadow) inputShadow.addEventListener('input', (e) => applyImageToolbarAction(c => c.shadow = Number(e.target.value) || 0));
    // Abrir a segunda linha muda a altura da barra: ela tem que se reancorar
    if (btnImageMore && imageAdvRow) btnImageMore.addEventListener('click', () => {
      const open = imageAdvRow.classList.toggle('is-open');
      btnImageMore.classList.toggle('is-active', open);
      updateTextToolbar();
    });

    if (btnImageDup) btnImageDup.addEventListener('click', () => duplicateTextNode());
    if (btnImageDel) btnImageDel.addEventListener('click', () => { deleteTextNode(); updateTextToolbar(); });
    
    const btnImageSendBack = document.getElementById('canvas-image-send-back');
    const btnImageBackward = document.getElementById('canvas-image-backward');
    const btnImageForward = document.getElementById('canvas-image-forward');
    const btnImageBringFront = document.getElementById('canvas-image-bring-front');

    if (btnImageSendBack) btnImageSendBack.addEventListener('click', () => sendChildToBack());
    if (btnImageBackward) btnImageBackward.addEventListener('click', () => sendChildBackward());
    if (btnImageForward) btnImageForward.addEventListener('click', () => bringChildForward());
    if (btnImageBringFront) btnImageBringFront.addEventListener('click', () => bringChildToFront());

    const btnImagePosCenterH = document.getElementById('canvas-image-pos-center-h');
    const btnImagePosCenterV = document.getElementById('canvas-image-pos-center-v');
    const btnImagePosCenterBoth = document.getElementById('canvas-image-pos-center-both');
    if (btnImagePosCenterH) btnImagePosCenterH.addEventListener('click', () => alignSelectedNodes('center-h'));
    if (btnImagePosCenterV) btnImagePosCenterV.addEventListener('click', () => alignSelectedNodes('center-v'));
    if (btnImagePosCenterBoth) btnImagePosCenterBoth.addEventListener('click', () => alignSelectedNodes('center-both'));

    if (imageToolbar) imageToolbar.addEventListener('mousedown', (e) => {
      if (!e.target.closest('input')) e.preventDefault();
    });

    /* --------------------------------------------------
       Controle Universal de Scrub (Arrastar p/ Esquerda e Direita em Campos Numéricos)
       -------------------------------------------------- */
    const SCRUB_PX_PER_STEP = 3;

    function initUniversalScrubController() {
      // Procura todos os campos com inputs numéricos dentro das barras de ferramentas do editor
      const fields = document.querySelectorAll('.canvas-text-toolbar__field, .canvas-crop-field');

      fields.forEach(field => {
        const input = field.querySelector('.canvas-text-toolbar__input') || (field.matches('.canvas-text-toolbar__input') ? field : null);
        if (!input || input.type !== 'number') return;

        // Evita anexar múltiplos listeners se a função for chamada novamente
        if (field.dataset.scrubInitialized === 'true') return;
        field.dataset.scrubInitialized = 'true';

        field.style.cursor = 'ew-resize';
        const icon = field.querySelector('i, svg');
        if (icon) icon.style.cursor = 'ew-resize';

        field.addEventListener('mousedown', (e) => {
          // Apenas botão esquerdo
          if (e.button !== 0) return;
          // Não interceptar se clicar em botão, select ou color picker interno
          if (e.target.closest('button, select, input[type="color"]')) return;

          const isClickOnInput = e.target === input;
          const startX = e.clientX;
          const startY = e.clientY;
          const startVal = parseFloat(input.value) || 0;
          const step = parseFloat(input.step) || 1;
          const decimals = (String(step).split('.')[1] || '').length;
          const min = input.min === '' ? -Infinity : parseFloat(input.min);
          const max = input.max === '' ? Infinity : parseFloat(input.max);

          let isDragging = false;

          const onMouseMove = (ev) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;

            if (!isDragging) {
              // Limiar para diferenciar clique de arrasto
              if (Math.hypot(dx, dy) < 3) return;
              isDragging = true;
              document.body.style.cursor = 'ew-resize';
              document.body.style.userSelect = 'none';
            }

            const mult = ev.shiftKey ? 5 : (ev.altKey ? 0.2 : 1);
            const deltaSteps = Math.round(dx / SCRUB_PX_PER_STEP) * step * mult;
            const nextVal = Math.min(max, Math.max(min, startVal + deltaSteps));
            
            input.value = decimals > 0 ? nextVal.toFixed(decimals) : String(Math.round(nextVal));

            // Dispara evento 'input' para atualizar imediatamente no Canvas
            quietSaveDepth++;
            try {
              input.dispatchEvent(new Event('input', { bubbles: true }));
            } finally {
              quietSaveDepth--;
            }
          };

          const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            if (!isDragging && isClickOnInput) {
              // Clique direto no campo sem arrastar: foca e seleciona tudo para digitar
              input.focus();
              input.select();
            } else if (isDragging) {
              // Dispara 'change' para persistir e consolidar histórico
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }
          };

          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);
        });
      });
    }

    initUniversalScrubController();

    function updateTextToolbar() {
      const imageToolbar = document.getElementById('canvas-image-toolbar');
      const cropToolbar = document.getElementById('canvas-crop-toolbar');
      const bgRepositionToolbar = document.getElementById('canvas-bg-reposition-toolbar');
      const frameToolbar = document.getElementById('canvas-frame-toolbar');

      if (isMeasureKeyActive) {
        if (textToolbar) textToolbar.classList.remove('is-visible');
        if (imageToolbar) imageToolbar.classList.remove('is-visible');
        if (cropToolbar) cropToolbar.classList.remove('is-visible');
        if (bgRepositionToolbar) bgRepositionToolbar.classList.remove('is-visible');
        if (frameToolbar) frameToolbar.classList.remove('is-visible');
        return;
      }
      if (repositioningFrameId) {
        if (textToolbar) textToolbar.classList.remove('is-visible');
        if (imageToolbar) imageToolbar.classList.remove('is-visible');
        if (cropToolbar) cropToolbar.classList.remove('is-visible');
        if (frameToolbar) frameToolbar.classList.remove('is-visible');
        updateBgRepositionToolbar();
        return;
      }
      if (croppingImage) {
        if (textToolbar) textToolbar.classList.remove('is-visible');
        if (imageToolbar) imageToolbar.classList.remove('is-visible');
        if (bgRepositionToolbar) bgRepositionToolbar.classList.remove('is-visible');
        if (frameToolbar) frameToolbar.classList.remove('is-visible');
        updateCropToolbar();
        return;
      }
      if (bgRepositionToolbar) bgRepositionToolbar.classList.remove('is-visible');
      if (cropToolbar) cropToolbar.classList.remove('is-visible');
      if (textToolbar) textToolbar.classList.remove('is-visible');
      if (imageToolbar) imageToolbar.classList.remove('is-visible');
      if (frameToolbar) frameToolbar.classList.remove('is-visible');
      
      const child = (selectedChildNodes.length > 0 && selectedTextNode.frameId) ? selectedChild() : null;
      if (!child) {
        const selFrame = selectedFrame();
        if (selFrame && frameToolbar) {
          const frameEl = frameElOf(selFrame);
          if (frameEl) {
            const r = frameEl.getBoundingClientRect();
            const barH = frameToolbar.offsetHeight || 48;
            const half = (frameToolbar.offsetWidth || 340) / 2;
            const boxCenterX = (r.left + r.right) / 2;
            const top = r.top - barH - 12;
            frameToolbar.style.top = `${top < 76 ? Math.min(innerHeight - barH - 16, r.bottom + 12) : top}px`;
            frameToolbar.style.left = `${Math.min(innerWidth - half - 12, Math.max(half + 12, boxCenterX))}px`;

            const btnModeSolid = document.getElementById('canvas-frame-mode-solid');
            const btnModeGrad = document.getElementById('canvas-frame-mode-gradient');
            const groupSolid = document.getElementById('canvas-frame-solid-group');
            const groupGrad = document.getElementById('canvas-frame-grad-group');
            const inputBgColor = document.getElementById('canvas-frame-bg-color');
            const inputGradC1 = document.getElementById('canvas-frame-grad-c1');
            const inputGradC2 = document.getElementById('canvas-frame-grad-c2');
            const selectGradDir = document.getElementById('canvas-frame-grad-dir');
            const selectGrad = document.getElementById('canvas-frame-gradient-select');
            const inputOverlay = document.getElementById('canvas-frame-overlay');
            const inputBlur = document.getElementById('canvas-frame-blur');
            const btnDelImg = document.getElementById('canvas-frame-del-img');

            const hasBg = hasFrameBg(selFrame);
            const btnReposition = document.getElementById('canvas-frame-reposition-btn');
            const wrapPosY = document.getElementById('canvas-frame-pos-y-wrap');
            const wrapPosX = document.getElementById('canvas-frame-pos-x-wrap');
            const wrapZoom = document.getElementById('canvas-frame-zoom-wrap');
            const inputFramePosY = document.getElementById('canvas-frame-pos-y');
            const inputFramePosX = document.getElementById('canvas-frame-pos-x');
            const inputFrameZoom = document.getElementById('canvas-frame-zoom');

            if (btnReposition) btnReposition.style.display = hasBg ? 'inline-flex' : 'none';
            if (wrapPosY) wrapPosY.style.display = hasBg ? 'inline-flex' : 'none';
            if (wrapPosX) wrapPosX.style.display = hasBg ? 'inline-flex' : 'none';
            if (wrapZoom) wrapZoom.style.display = hasBg ? 'inline-flex' : 'none';

            if (inputFramePosY && document.activeElement !== inputFramePosY) {
              inputFramePosY.value = selFrame.bgPosY != null ? selFrame.bgPosY : 50;
            }
            if (inputFramePosX && document.activeElement !== inputFramePosX) {
              inputFramePosX.value = selFrame.bgPosX != null ? selFrame.bgPosX : 50;
            }
            if (inputFrameZoom && document.activeElement !== inputFrameZoom) {
              inputFrameZoom.value = selFrame.bgZoom || 100;
            }

            const isGrad = !!(selFrame.bg && selFrame.bg.includes('gradient'));

            if (btnModeSolid && btnModeGrad && groupSolid && groupGrad) {
              btnModeSolid.classList.toggle('is-active', !isGrad);
              btnModeGrad.classList.toggle('is-active', isGrad);
              groupSolid.style.display = !isGrad ? 'inline-flex' : 'none';
              groupGrad.style.display = isGrad ? 'inline-flex' : 'none';
            }

            if (isGrad) {
              const hexes = selFrame.bg.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/g);
              if (hexes && hexes.length >= 2) {
                if (inputGradC1) inputGradC1.value = hexes[0];
                if (inputGradC2) inputGradC2.value = hexes[1];
              }
              if (selectGradDir) {
                if (selFrame.bg.includes('radial')) selectGradDir.value = 'radial';
                else if (selFrame.bg.includes('135deg')) selectGradDir.value = '135deg';
                else if (selFrame.bg.includes('90deg')) selectGradDir.value = '90deg';
                else if (selFrame.bg.includes('0deg')) selectGradDir.value = '0deg';
                else selectGradDir.value = '180deg';
              }
            } else {
              if (inputBgColor) {
                inputBgColor.value = selFrame.bg && selFrame.bg.startsWith('#') ? selFrame.bg : '#ffffff';
              }
            }

            if (selectGrad) selectGrad.value = '';
            if (inputOverlay) inputOverlay.value = selFrame.bgOverlay != null ? selFrame.bgOverlay : (selFrame.bgRecipe ? 0 : (hasFrameBg(selFrame) ? 35 : 0));
            if (inputBlur) inputBlur.value = selFrame.bgBlur || 0;
            if (btnDelImg) btnDelImg.style.display = hasBg ? 'inline-flex' : 'none';

            const btnBgBind = document.getElementById('canvas-frame-bg-bind');
            if (btnBgBind) {
              btnBgBind.classList.toggle('is-active', !!selFrame.bgBind);
              btnBgBind.title = selFrame.bgBind
                ? `Variável de Fundo: {{${selFrame.bgBind}}} (Clique para editar ou remover)`
                : 'Virar variável de Fundo do Batch Create ({})';
            }

            frameToolbar.classList.add('is-visible');
          }
        }
        return;
      }

      // Aceso = este nó já é um slot do lote; o tooltip mostra de qual coluna
      [btnTextBind, btnImageBind].forEach(btn => {
        if (!btn) return;
        btn.classList.toggle('is-active', !!child.bind);
        btn.title = child.bind
          ? `Variável {{${child.bind}}} — clique para desfazer`
          : 'Virar variável do Batch Create';
      });

      // Calcula caixa delimitadora de todos os nós selecionados na tela
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      selectedChildNodes.forEach(sel => {
        const el = nodeElement(sel.childId);
        if (el) {
          const r = el.getBoundingClientRect();
          minX = Math.min(minX, r.left);
          minY = Math.min(minY, r.top);
          maxX = Math.max(maxX, r.right);
          maxY = Math.max(maxY, r.bottom);
        }
      });
      const boxCenterX = isFinite(minX) ? (minX + maxX) / 2 : innerWidth / 2;
      const boxTop = isFinite(minY) ? minY : 100;
      const boxBottom = isFinite(maxY) ? maxY : 200;

      if (child.type === 'image') {
        if (!imageToolbar) return;
        const idle = (el) => el && document.activeElement !== el;
        const inputRadius = document.getElementById('canvas-image-radius');
        const inputBorderWidth = document.getElementById('canvas-image-border-width');
        const inputBorderColor = document.getElementById('canvas-image-border-color');
        const inputImageOpacity = document.getElementById('canvas-image-opacity');
        const inputImageRotation = document.getElementById('canvas-image-rotation');
        const inputBlur = document.getElementById('canvas-image-blur');
        const inputShadow = document.getElementById('canvas-image-shadow');
        
        if (idle(inputRadius)) inputRadius.value = child.borderRadius || 0;
        if (idle(inputBorderWidth)) inputBorderWidth.value = child.borderWidth || 0;
        if (idle(inputBorderColor)) inputBorderColor.value = child.borderColor || '#000000';
        if (idle(inputImageOpacity)) inputImageOpacity.value = child.opacity !== undefined ? child.opacity : 100;
        if (idle(inputImageRotation)) inputImageRotation.value = child.rotation || 0;
        if (idle(inputBlur)) inputBlur.value = child.blur || 0;
        if (idle(inputShadow)) inputShadow.value = child.shadow || 0;
        
        const barH = imageToolbar.offsetHeight || 48;
        const half = (imageToolbar.offsetWidth || 300) / 2;
        const top = boxTop - barH - 12;
        imageToolbar.style.top = `${top < 76 ? Math.min(innerHeight - barH - 16, boxBottom + 12) : top}px`;
        imageToolbar.style.left = `${Math.min(innerWidth - half - 12, Math.max(half + 12, boxCenterX))}px`;
        imageToolbar.classList.add('is-visible');
        return;
      }

      if (child.type !== 'text') return;

      /* Com um trecho marcado a barra tem que mostrar o estilo DELE, senão o
         usuário mexe num número que não é o que está na tela. Alinhamento e
         entrelinha continuam vindo do nó: são do bloco. */
      const range = activeTextRange(contentOf(child));
      const shown = range ? { ...child, ...styleProbe(range, child) } : child;

      const font = fontOf(shown);
      // Não reescreve o campo que está sendo digitado: o cursor pularia a cada tecla
      const idle = (el) => el && document.activeElement !== el;
      if (idle(selFont)) selFont.value = font.css;
      fillWeightOptions(shown);
      if (idle(inputSize)) inputSize.value = shown.fontSize || TEXT_DEFAULTS.fontSize;
      if (idle(inputColor)) inputColor.value = shown.color || TEXT_DEFAULTS.color;
      if (idle(inputLh)) inputLh.value = child.lineHeight != null ? child.lineHeight : TEXT_DEFAULTS.lineHeight;
      if (idle(inputLs)) inputLs.value = shown.letterSpacing != null ? shown.letterSpacing : TEXT_DEFAULTS.letterSpacing;
      if (idle(inputOpacity)) inputOpacity.value = shown.opacity != null ? shown.opacity : TEXT_DEFAULTS.opacity;
      if (idle(inputTextRotation)) inputTextRotation.value = shown.rotation != null ? shown.rotation : TEXT_DEFAULTS.rotation;
      if (idle(inputBg)) inputBg.value = shown.bg || '#000000';
      if (btnShadow) btnShadow.classList.toggle('is-active', !!shown.shadow);

      const weight = shown.fontWeight || TEXT_DEFAULTS.fontWeight;
      if (btnBold) {
        btnBold.classList.toggle('is-active', weight >= font.weights[font.weights.length - 1] && font.weights.length > 1);
        btnBold.disabled = font.weights.length < 2;
      }
      if (btnItalic) btnItalic.classList.toggle('is-active', !!shown.italic);
      if (btnUnderline) btnUnderline.classList.toggle('is-active', !!shown.underline);

      const align = child.align || TEXT_DEFAULTS.align;
      if (btnAlignLeft) btnAlignLeft.classList.toggle('is-active', align === 'left');
      if (btnAlignCenter) btnAlignCenter.classList.toggle('is-active', align === 'center');
      if (btnAlignRight) btnAlignRight.classList.toggle('is-active', align === 'right');

      const transform = shown.transform || TEXT_DEFAULTS.transform;
      if (btnCaseNone) btnCaseNone.classList.toggle('is-active', transform === 'none');
      if (btnCaseUpper) btnCaseUpper.classList.toggle('is-active', transform === 'uppercase');
      if (btnCaseLower) btnCaseLower.classList.toggle('is-active', transform === 'lowercase');

      // Ancora a barra acima do nó, sem deixá-la sair pela borda da janela
      const barH = textToolbar.offsetHeight || 48;
      const half = (textToolbar.offsetWidth || 560) / 2;
      const top = boxTop - barH - 12;
      textToolbar.style.top = `${top < 76 ? Math.min(innerHeight - barH - 16, boxBottom + 12) : top}px`;
      textToolbar.style.left = `${Math.min(innerWidth - half - 12, Math.max(half + 12, boxCenterX))}px`;
      textToolbar.classList.add('is-visible');
    }

    /* --------------------------------------------------
       Histórico (Undo / Redo) e Camadas (Z-Index)
       -------------------------------------------------- */
    const undoStack = [];
    const redoStack = [];
    const MAX_HISTORY = 50;
    let isRestoringHistory = false;

    function getCanvasSnapshot() {
      return JSON.stringify({
        frames,
        links,
        selectedFrameIds: Array.from(selectedFrameIds),
        selectedChildNodes: [...selectedChildNodes],
        selectedLinkId
      });
    }

    function pushHistory() {
      if (isRestoringHistory) return;
      const snap = getCanvasSnapshot();
      if (undoStack.length > 0 && undoStack[undoStack.length - 1] === snap) return;
      undoStack.push(snap);
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack.length = 0;
      updateUndoRedoButtons();
    }

    let quotaAvisado = false;

    /* --------------------------------------------------
       Indicador de salvamento na barra do topo.
       Só espelha o save() abaixo: não salva nada por conta própria e não
       mexe na frequência do save.

       O "Salvando…" é caro visualmente, então só aparece em ação nomeada
       (gerar lote, aplicar template, colar imagem, trocar fonte…). Arrastar,
       redimensionar, digitar e dar zoom salvam igual, mas por saveQuiet():
       o rótulo continua "Salvo ✓" e só o contador volta para "há 0s".
       Sem isso o spinner reiniciava a cada mouseup e o save parecia nervoso.
       -------------------------------------------------- */
    const saveStatusEl = document.getElementById('canvas-save-status');
    let quietSaveDepth = 0; // > 0 enquanto uma micro-interação está salvando
    const SAVE_SETTLE_MS = 420; // o save é síncrono; o spinner existe para ser lido
    let lastSavedAt = null;
    let saveSettleTimer = null;
    let saveTickTimer = null;

    function savedAgoLabel() {
      if (lastSavedAt == null) return '';
      const secs = Math.max(0, Math.round((Date.now() - lastSavedAt) / 1000));
      if (secs < 60) return `há ${secs}s`;
      const mins = Math.floor(secs / 60);
      if (mins < 60) return `há ${mins}min`;
      return `há ${Math.floor(mins / 60)}h`;
    }

    function paintSaveStatus(state) {
      if (!saveStatusEl) return;
      if (state === 'saving') {
        saveStatusEl.className = 'canvas-topbar__save is-saving';
        saveStatusEl.innerHTML = '<span class="canvas-topbar__save-spin"></span><span>Salvando…</span>';
      } else if (state === 'error') {
        saveStatusEl.className = 'canvas-topbar__save is-error';
        saveStatusEl.innerHTML = '<span>⚠ Não salvo</span>';
      } else {
        saveStatusEl.className = 'canvas-topbar__save is-saved';
        saveStatusEl.innerHTML = '<span>Salvo ✓ · ' + savedAgoLabel() + '</span>';
      }
    }

    function markSaving() {
      if (!saveStatusEl) return;
      /* Repintar a cada save reiniciaria o spinner e ele pareceria travado */
      if (!saveStatusEl.classList.contains('is-saving')) paintSaveStatus('saving');
      clearTimeout(saveSettleTimer);
      saveSettleTimer = setTimeout(markSaved, SAVE_SETTLE_MS);
    }

    function markSaved() {
      if (!saveStatusEl) return;
      lastSavedAt = Date.now();
      paintSaveStatus('saved');
      if (saveTickTimer) return;
      // Um único contador para a vida toda da página
      saveTickTimer = setInterval(() => {
        if (saveStatusEl.classList.contains('is-saved')) paintSaveStatus('saved');
      }, 1000);
    }

    /* Save silencioso: não troca de estado nem acende spinner. Se um
       "Salvando…" de ação nomeada estiver no ar, deixa ele terminar sozinho
       — só adianta o relógio para o settle repintar já com "há 0s". */
    function markSavedQuiet() {
      if (!saveStatusEl) return;
      if (saveStatusEl.classList.contains('is-saving')) {
        lastSavedAt = Date.now();
        return;
      }
      markSaved();
    }

    function markSaveError() {
      clearTimeout(saveSettleTimer);
      paintSaveStatus('error');
    }

    /* Mesmo save, mesmo momento, mesma frequência — muda só o feedback.
       Usado pelos handlers de drag / digitação / zoom. */
    function saveQuiet(recordHistory = true) {
      quietSaveDepth++;
      try {
        save(recordHistory);
      } finally {
        quietSaveDepth--;
      }
    }

    function save(recordHistory = true) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ cam, frames, links }));
        /* Voltou a salvar depois de uma falha: o aviso na barra do topo precisa
           sair junto, senão o label fica laranja e mentindo o resto da sessão.
           A cor sai como inline vazia para o label voltar a herdar o tema. */
        if (quotaAvisado) {
          quotaAvisado = false;
          const label = document.getElementById('canvas-topbar-label');
          if (label) label.style.color = '';
          updateTopbar();
        }
        if (quietSaveDepth > 0) markSavedQuiet();
        else markSaving();
      } catch (e) {
        /* Falhar em silêncio aqui custa o trabalho inteiro do usuário no
           próximo reload — ele precisa saber na hora. */
        console.error('[canvas] não foi possível salvar o estado:', e);
        markSaveError();
        if (!quotaAvisado) {
          quotaAvisado = true;
          toast.error('O armazenamento do navegador encheu: o canvas não está sendo salvo. Exporte o que precisa antes de recarregar a página.');
          const label = document.getElementById('canvas-topbar-label');
          if (label) {
            label.textContent = '⚠ Armazenamento cheio — o canvas NÃO está sendo salvo';
            label.style.color = '#B45309';
          }
        }
      }
      if (recordHistory) {
        pushHistory();
      }
    }

    function undo() {
      if (undoStack.length <= 1) return;
      if (croppingImage) exitCropMode();
      isRestoringHistory = true;
      const current = undoStack.pop();
      redoStack.push(current);
      const prev = undoStack[undoStack.length - 1];
      restoreSnapshot(prev);
      isRestoringHistory = false;
      updateUndoRedoButtons();
    }

    function redo() {
      if (redoStack.length === 0) return;
      if (croppingImage) exitCropMode();
      isRestoringHistory = true;
      const next = redoStack.pop();
      undoStack.push(next);
      restoreSnapshot(next);
      isRestoringHistory = false;
      updateUndoRedoButtons();
    }

    function restoreSnapshot(jsonStr) {
      if (!jsonStr) return;
      try {
        const data = JSON.parse(jsonStr);
        if (Array.isArray(data.frames)) {
          frames = data.frames;
          frameSeq = frames.reduce((max, f) => Math.max(max, f.id + 1), 1);
          childSeq = frames.reduce((max, f) => {
            const childMax = (f.children || []).reduce((cmax, c) => Math.max(cmax, c.id + 1), 1);
            return Math.max(max, childMax);
          }, 1);
        }
        if (Array.isArray(data.links)) {
          links = data.links;
          linkSeq = links.reduce((max, l) => Math.max(max, l.id + 1), 1);
          pruneMixedLinks();
        }
        renderAll();
        if (Array.isArray(data.selectedChildNodes) && data.selectedChildNodes.length > 0) {
          selectedFrameIds.clear();
          selectedId = null;
          selectedChildNodes = data.selectedChildNodes;
          selectedTextNode = selectedChildNodes[0];
          world.querySelectorAll('.canvas-text-node, .canvas-image-node').forEach(el => {
            const cId = Number(el.dataset.id);
            el.classList.toggle('is-selected', selectedChildNodes.some(n => n.childId === cId));
          });
          updateTextToolbar();
        } else if (Array.isArray(data.selectedFrameIds) && data.selectedFrameIds.length > 0) {
          selectedChildNodes = [];
          selectedTextNode = { frameId: null, childId: null };
          selectedFrameIds = new Set(data.selectedFrameIds);
          selectedId = [...selectedFrameIds][0];
          world.querySelectorAll('.canvas-frame').forEach((el) => {
            el.classList.toggle('is-selected', selectedFrameIds.has(Number(el.dataset.id)));
          });
          updateTopbar();
        } else if (data.selectedChildId !== undefined && data.selectedChildId !== null) {
          selectTextNode(data.selectedFrameId, data.selectedChildId);
        } else if (data.selectedId !== undefined && data.selectedId !== null) {
          selectFrame(data.selectedId);
        } else if (data.selectedLinkId !== undefined && data.selectedLinkId !== null) {
          selectLink(data.selectedLinkId);
        } else {
          selectFrame(null);
          selectTextNode(null, null);
          selectLink(null);
        }
        save(false);
      } catch (e) {
        console.error('Erro ao restaurar histórico:', e);
      }
    }

    function updateUndoRedoButtons() {
      const btnUndo = document.getElementById('canvas-undo');
      const btnRedo = document.getElementById('canvas-redo');
      const canUndo = undoStack.length > 1;
      const canRedo = redoStack.length > 0;

      if (btnUndo) {
        btnUndo.classList.toggle('is-disabled', !canUndo);
        btnUndo.style.opacity = canUndo ? '1' : '0.38';
        btnUndo.title = canUndo ? 'Desfazer (⌘Z)' : 'Nada para desfazer no histórico';
      }
      if (btnRedo) {
        btnRedo.classList.toggle('is-disabled', !canRedo);
        btnRedo.style.opacity = canRedo ? '1' : '0.38';
        btnRedo.title = canRedo ? 'Refazer (⌘⇧Z)' : 'Nada para refazer no histórico';
      }
    }

    function reorderChildDOM(frame) {
      const frameEl = frameElOf(frame);
      if (!frameEl || !frame.children) return;
      const contentMask = frameEl.querySelector('.canvas-frame__content');
      if (!contentMask) return;
      frame.children.forEach(child => {
        const childEl = contentMask.querySelector(`[data-id="${child.id}"]`);
        if (childEl) contentMask.appendChild(childEl);
      });
    }

    function bringChildToFront() {
      if (selectedChildNodes.length === 0) return;
      selectedChildNodes.forEach(sel => {
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame || !frame.children) return;
        const idx = frame.children.findIndex(c => c.id === sel.childId);
        if (idx === -1 || idx === frame.children.length - 1) return;
        const [child] = frame.children.splice(idx, 1);
        frame.children.push(child);
        reorderChildDOM(frame);
      });
      save();
    }

    function bringChildForward() {
      if (selectedChildNodes.length === 0) return;
      selectedChildNodes.forEach(sel => {
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame || !frame.children) return;
        const idx = frame.children.findIndex(c => c.id === sel.childId);
        if (idx === -1 || idx === frame.children.length - 1) return;
        const temp = frame.children[idx];
        frame.children[idx] = frame.children[idx + 1];
        frame.children[idx + 1] = temp;
        reorderChildDOM(frame);
      });
      save();
    }

    function sendChildBackward() {
      if (selectedChildNodes.length === 0) return;
      selectedChildNodes.forEach(sel => {
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame || !frame.children) return;
        const idx = frame.children.findIndex(c => c.id === sel.childId);
        if (idx <= 0) return;
        const temp = frame.children[idx];
        frame.children[idx] = frame.children[idx - 1];
        frame.children[idx - 1] = temp;
        reorderChildDOM(frame);
      });
      save();
    }

    function sendChildToBack() {
      if (selectedChildNodes.length === 0) return;
      selectedChildNodes.forEach(sel => {
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame || !frame.children) return;
        const idx = frame.children.findIndex(c => c.id === sel.childId);
        if (idx <= 0) return;
        const [child] = frame.children.splice(idx, 1);
        frame.children.unshift(child);
        reorderChildDOM(frame);
      });
      save();
    }

    function alignSelectedNodes(alignment) {
      let nodes = selectedChildNodes;
      if ((!nodes || nodes.length === 0) && selectedTextNode && selectedTextNode.childId) {
        nodes = [{ frameId: selectedTextNode.frameId, childId: selectedTextNode.childId }];
      }
      if (!nodes || nodes.length === 0) return;

      let panoLabel = null;

      nodes.forEach(sel => {
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame) return;
        const child = (frame.children || []).find(c => c.id === sel.childId);
        if (!child) return;
        const frameEl = frameElOf(frame);
        const el = frameEl 
          ? frameEl.querySelector(`.canvas-text-node[data-id="${child.id}"], .canvas-image-node[data-id="${child.id}"]`)
          : world.querySelector(`.canvas-text-node[data-id="${child.id}"], .canvas-image-node[data-id="${child.id}"]`);
        
        if (!el) return;

        const w = child.w || el.offsetWidth || 100;
        const h = child.h || el.offsetHeight || 50;

        // A referência horizontal é a fatia (o post) onde o elemento está
        const slice = sliceBoundsFor(frame, (child.x || 0) + w / 2);
        if (slice.total > 1) panoLabel = `${slice.index + 1}/${slice.total}`;
        const sliceCenterX = Math.round(slice.left + (slice.width - w) / 2);

        if (alignment === 'center-h') {
          child.x = sliceCenterX;
        } else if (alignment === 'center-v') {
          child.y = Math.round((frame.h - h) / 2);
        } else if (alignment === 'center-both') {
          child.x = sliceCenterX;
          child.y = Math.round((frame.h - h) / 2);
        } else if (alignment === 'left') {
          child.x = Math.round(slice.left) + 40;
        } else if (alignment === 'right') {
          child.x = Math.round(slice.left + slice.width) - w - 40;
        } else if (alignment === 'top') {
          child.y = 40;
        } else if (alignment === 'bottom') {
          child.y = frame.h - h - 40;
        }

        el.style.left = `${child.x}px`;
        el.style.top = `${child.y}px`;
      });
      updateTextToolbar();
      save();
      const labels = {
        'center-h': 'Centralizado horizontalmente no post!',
        'center-v': 'Centralizado verticalmente no post!',
        'center-both': 'Centralizado no centro do post!',
        'left': 'Alinhado à esquerda!',
        'right': 'Alinhado à direita!',
        'top': 'Alinhado ao topo!',
        'bottom': 'Alinhado à base!'
      };
      if (labels[alignment]) {
        // Na faixa, dizer em qual post caiu evita a dúvida de "centralizou onde?"
        const sufixo = (panoLabel && nodes.length === 1) ? ` (post ${panoLabel})` : '';
        toast.success(labels[alignment].replace(/!$/, '') + sufixo + '!');
      }
    }

    function rotateSelectedNodes(val) {
      let nodes = selectedChildNodes;
      if ((!nodes || nodes.length === 0) && selectedTextNode && selectedTextNode.childId) {
        nodes = [{ frameId: selectedTextNode.frameId, childId: selectedTextNode.childId }];
      }
      if (!nodes || nodes.length === 0) return;

      nodes.forEach(sel => {
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame) return;
        const child = (frame.children || []).find(c => c.id === sel.childId);
        if (!child) return;
        if (val === 'reset') {
          child.rotation = 0;
        } else {
          const cur = child.rotation || 0;
          child.rotation = ((cur + val) % 360 + 360) % 360;
        }
        const el = nodeElement(child.id);
        if (el) {
          el.style.transform = child.rotation ? `rotate(${child.rotation}deg)` : '';
          el.style.transformOrigin = 'center center';
        }
      });
      updateTextToolbar();
      save();
      if (val === 'reset') toast.success('Rotação resetada para 0°');
      else toast.success(`Rotacionado para ${(selectedChild() && selectedChild().rotation) || 0}°`);
    }

    function load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          undoStack.push(getCanvasSnapshot());
          updateUndoRedoButtons();
          initCustomFonts();
          return;
        }
        const data = JSON.parse(raw);
        if (data.cam) cam = data.cam;
        if (Array.isArray(data.frames)) {
          frames = data.frames;
          frameSeq = frames.reduce((max, f) => Math.max(max, f.id + 1), 1);
          childSeq = frames.reduce((max, f) => {
            const childMax = (f.children || []).reduce((cmax, c) => Math.max(cmax, c.id + 1), 1);
            return Math.max(max, childMax);
          }, 1);
        }
        if (Array.isArray(data.links)) {
          links = data.links;
          linkSeq = links.reduce((max, l) => Math.max(max, l.id + 1), 1);
          pruneMixedLinks();
        }
        undoStack.push(getCanvasSnapshot());
        updateUndoRedoButtons();
        migrateInlineBackgrounds();
        initCustomFonts();
      } catch (e) {
        undoStack.push(getCanvasSnapshot());
        updateUndoRedoButtons();
        initCustomFonts();
      }
    }

    /* Fundo salvo inline come megabytes da cota do localStorage (um único JPEG
       de fundo já passa de 1 MB), e a cota é o teto de todo o canvas. Move os
       legados para o IndexedDB uma vez, deixando só o id no frame. */
    async function migrateInlineBackgrounds() {
      const pendentes = frames.filter(f => f.bgImage && String(f.bgImage).startsWith('data:'));
      if (pendentes.length === 0) return;
      const porDataUrl = new Map();
      for (const f of pendentes) {
        let id = porDataUrl.get(f.bgImage);
        if (!id) {
          id = 'asset_bg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
          assetCache.set(id, f.bgImage);
          await saveAsset(id, f.bgImage);
          porDataUrl.set(f.bgImage, id);
        }
        f.bgAssetId = id;
        f.bgImage = null;
      }
      save(false);
    }

    // Converte um ponto da tela para o espaço infinito
    function screenToWorld(sx, sy) {
      return { x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale };
    }

    function applyCamera() {
      world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`;
      // Inverso da escala: contorno e rótulo dos frames usam isso para manter
      // espessura constante na tela em qualquer zoom, como no Figma
      world.style.setProperty('--inv', 1 / cam.scale);
      /* Os rótulos da safe zone têm tamanho fixo na tela, então quanto mais longe
         a câmera, maiores eles ficam em relação ao frame — até o texto ficar maior
         que a faixa que ele descreve. Passado esse ponto quem fala é só a hachura. */
      if (view) view.classList.toggle('is-zoomed-out', cam.scale < BADGE_MIN_SCALE);
      /* Grid adaptativo: o passo dobra ou divide até cair numa faixa confortável
         de pixels na tela. Sem isso, com zoom baixo os pontos se amontoam e
         viram moiré; com zoom alto somem. É o mesmo truque do Figma. */
      let step = DOT_GRID * cam.scale;
      while (step < GRID_MIN_PX) step *= 2;
      while (step > GRID_MAX_PX) step /= 2;
      dots.style.backgroundSize = `${step}px ${step}px`;
      dots.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
      const label = document.getElementById('canvas-zoom-label');
      if (label) label.textContent = `${Math.round((cam.scale / BASE_SCALE) * 100)}%`;
      
      updateTextToolbar(); // Reposiciona ao mover a câmera
    }

    /* Zoom re-rasteriza tudo que está na tela. Um fundo de foto com desfoque é
       de longe o item mais caro dessa conta — durante a rajada de zoom ele sai
       do ar e volta sozinho quando a roda para. */
    let zoomSettleTimer = null;
    function markZooming() {
      if (!view) return;
      view.classList.add('is-zooming');
      clearTimeout(zoomSettleTimer);
      zoomSettleTimer = setTimeout(() => view.classList.remove('is-zooming'), 180);
    }

    function zoomAt(sx, sy, factor) {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cam.scale * factor));
      if (next === cam.scale) return;
      markZooming();
      // Mantém sob o cursor o mesmo ponto do mundo antes e depois do zoom
      const before = screenToWorld(sx, sy);
      cam.scale = next;
      cam.x = sx - before.x * cam.scale;
      cam.y = sy - before.y * cam.scale;
      applyCamera();
      saveQuiet(); // zoom de scroll dispara em rajada: só reinicia o contador
    }

    // Põe o cursor no fim do texto: focar sozinho não cria caret em contentEditable vazio
    function focusTextEnd(text) {
      text.focus();
      const range = document.createRange();
      range.selectNodeContents(text);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    /* Caret no ponto exato do clique.
       O padrão é caretPositionFromPoint; o WebKit ainda só tem
       caretRangeFromPoint. Ambos usam coordenadas de tela, então o zoom e o
       transform do mundo já entram na conta. */
    function caretRangeAt(x, y) {
      if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(x, y);
        if (!pos) return null;
        const range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
        return range;
      }
      if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
      return null;
    }

    // Entra em edição com o cursor onde o mouse estava, não no fim do texto
    function focusTextAtPoint(content, x, y) {
      content.focus();
      const range = caretRangeAt(x, y);
      if (!range || !content.contains(range.startContainer)) {
        focusTextEnd(content);
        return;
      }
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    /* Duas marchas, como no Figma: um clique seleciona o bloco (e o arrasto o
       move), o duplo clique é que abre o texto para digitar. Fora da edição o
       contenteditable fica desligado — é o que dá o cursor de mover e impede o
       navegador de roubar o foco já no primeiro clique. */
    function enterTextEditing(content, x, y) {
      const node = content.closest('.canvas-text-node');
      if (node) node.classList.add('is-editing');
      content.contentEditable = 'true';
      if (x === undefined) focusTextEnd(content);
      else focusTextAtPoint(content, x, y);
    }

    function exitTextEditing(content) {
      const node = content.closest('.canvas-text-node');
      if (node) node.classList.remove('is-editing');
      content.blur();
      content.contentEditable = 'false';
    }

    /* --------------------------------------------------
       Frames (pranchetas de post)
       O CRUD aqui é o molde que os outros elementos do editor
       (texto, imagem) vão seguir: o dado é só JSON, o DOM é derivado.
       -------------------------------------------------- */

    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function sanitizeFilename(str) {
      if (!str) return '';
      return String(str).trim()
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, '_');
    }

    // `children` já nasce no modelo para receber os textos e imagens depois
    function makeFrame(formatKey = 'ig-feed', x = 0, y = 0) {
      const key = (formatKey && FORMATS[formatKey]) ? formatKey : 'ig-feed';
      const fmt = FORMATS[key];
      const defaultName = `Post ${frames.length + 1}`;
      return { id: frameSeq++, name: defaultName, format: key, x, y, w: fmt.w, h: fmt.h, bg: '#FFFFFF', children: [] };
    }

    /* Texto criado e abandonado sem digitar nada não deixa rastro: some junto
       com a seleção, como no Figma. Sem isso o frame acumula nós invisíveis. */
    function dropEmptyTextNode() {
      const { frameId, childId } = selectedTextNode;
      if (childId === null) return;
      const frame = frames.find(f => f.id === frameId);
      if (!frame) return;
      const child = (frame.children || []).find(c => c.id === childId);
      // Só texto some por estar vazio: imagem não tem `text` e seria apagada junto
      if (!child || child.type !== 'text') return;
      if ((child.text || '').trim() !== '') return;
      const el = world.querySelector(`.canvas-text-node[data-id="${childId}"]`);
      if (el) el.remove();
      frame.children = frame.children.filter(c => c.id !== childId);
      save();
    }

    /* Chrome de imagem (estilo Figma): contorno + 8 alças de resize + botão de
       rotação, todos FORA da máscara do frame pra nunca serem cortados. */
    function imageChromeOf(child) {
      if (!child || child.type !== 'image') return null;
      return world.querySelector(`.canvas-image-chrome[data-id="${child.id}"]`);
    }

    function getChromeLayer(frame) {
      const frameEl = frameElOf(frame);
      if (!frameEl) return null;
      let layer = frameEl.querySelector(':scope > .canvas-frame__chrome');
      if (!layer) {
        layer = document.createElement('div');
        layer.className = 'canvas-frame__chrome';
        frameEl.appendChild(layer);
      }
      return layer;
    }

    function removeImageChrome(childId) {
      const chrome = world.querySelector(`.canvas-image-chrome[data-id="${childId}"]`);
      if (chrome) chrome.remove();
    }

    function syncImageChrome() {
      // Limpa chromes de quem não está mais selecionado
      world.querySelectorAll('.canvas-image-chrome').forEach(chrome => {
        const cId = Number(chrome.dataset.id);
        if (!selectedChildNodes.some(n => n.childId === cId)) chrome.remove();
      });
      if (selectedChildNodes.length !== 1) return;

      const sel = selectedChildNodes[0];
      const frame = frames.find(f => f.id === sel.frameId);
      if (!frame) return;
      const child = (frame.children || []).find(c => c.id === sel.childId);
      if (!child || child.type !== 'image' || (croppingImage && croppingImage.childId === child.id)) return;

      // Reaproveita o chrome existente
      let chrome = imageChromeOf(child);
      if (!chrome) {
        chrome = document.createElement('div');
        chrome.className = 'canvas-image-chrome';
        chrome.dataset.id = child.id;

        const dirs = ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'];
        dirs.forEach(dir => {
          const h = document.createElement('div');
          h.className = `canvas-chrome-handle canvas-chrome-handle--${dir}`;
          h.dataset.chromeHandle = dir;
          chrome.appendChild(h);
        });

        const rotBtn = document.createElement('div');
        rotBtn.className = 'canvas-node__rotate-handle';
        rotBtn.title = 'Girar imagem (Shift trava a cada 15°)';
        rotBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
            <path d="M21 3v5h-5"/>
          </svg>
        `;
        chrome.appendChild(rotBtn);

        chrome.addEventListener('mousedown', (e) => {
          if (e.target.closest('.canvas-node__rotate-handle')) {
            startRotateNode(e, child, frame, nodeElement(child.id));
            return;
          }
          const handle = e.target.closest('[data-chrome-handle]');
          if (!handle) return;
          e.stopPropagation();
          e.preventDefault();
          startChromeResize(e, child, frame, handle.dataset.chromeHandle, chrome);
        });

        const layer = getChromeLayer(frame);
        if (layer) layer.appendChild(chrome);
      }

      positionImageChrome(chrome, child);
    }

    function positionImageChrome(chrome, child) {
      chrome.style.left = `${child.x}px`;
      chrome.style.top = `${child.y}px`;
      chrome.style.width = `${child.w}px`;
      chrome.style.height = `${child.h}px`;
      chrome.style.borderRadius = `${child.borderRadius || 0}px`;
      if (child.rotation) {
        chrome.style.transform = `rotate(${child.rotation}deg)`;
      } else {
        chrome.style.transform = '';
      }
    }

    /* Resize por qualquer borda: mantém proporção da imagem e cresce a foto
       junto (imgW/imgH/imgX/imgY escalam proporcionalmente). */
    function startChromeResize(e, child, frame, dir, chrome) {
      const startX = e.clientX;
      const startY = e.clientY;
      const o = { x: child.x, y: child.y, w: child.w, h: child.h, imgW: child.imgW, imgH: child.imgH, imgX: child.imgX, imgY: child.imgY };
      const ratio = o.w / o.h;
      const el = nodeElement(child.id);

      const onMove = ev => {
        const dx = (ev.clientX - startX) / cam.scale;
        const dy = (ev.clientY - startY) / cam.scale;
        let x = o.x, y = o.y, w = o.w, h = o.h;

        if (dir === 'se') { w = o.w + dx; h = w / ratio; }
        else if (dir === 'nw') { w = o.w - dx; h = w / ratio; x = o.x + (o.w - w); y = o.y + (o.h - h); }
        else if (dir === 'ne') { w = o.w + dx; h = w / ratio; y = o.y + (o.h - h); }
        else if (dir === 'sw') { w = o.w - dx; h = w / ratio; x = o.x + (o.w - w); }
        else if (dir === 'n') { h = Math.max(20, o.h - dy); y = o.y + (o.h - h); }
        else if (dir === 's') { h = Math.max(20, o.h + dy); }
        else if (dir === 'e') { w = Math.max(20, o.w + dx); }
        else if (dir === 'w') { w = Math.max(20, o.w - dx); x = o.x + (o.w - w); }

        /* Cantos: trava a proporção e refaz a âncora com o tamanho JÁ limitado.
           Sem isso, ao bater no mínimo a imagem escorregava para o lado. */
        if (dir.length === 2) {
          w = Math.max(20, w);
          h = w / ratio;
          x = dir.includes('w') ? o.x + (o.w - w) : o.x;
          y = dir.includes('n') ? o.y + (o.h - h) : o.y;
        }

        const scale = dir.length === 2 ? w / o.w : 1;
        child.x = Math.round(x);
        child.y = Math.round(y);
        child.w = Math.round(w);
        child.h = Math.round(h);
        if (dir.length === 2) {
          /* imgX/imgY são medidos dentro do próprio nó (não no frame), então
             escalam junto com ele — misturar com x/y do nó desalinhava o
             recorte a cada arrasto. */
          child.imgW = Math.round(o.imgW * scale);
          child.imgH = Math.round(o.imgH * scale);
          child.imgX = Math.round(o.imgX * scale);
          child.imgY = Math.round(o.imgY * scale);
        }
        updateImageNodeDOM(child, el);
        positionImageChrome(chrome, child);
        updateTextToolbar();
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveQuiet();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    function selectTextNode(frameId, childId, isMulti = false) {
      if (croppingImage && (croppingImage.childId !== childId || isMulti)) {
        exitCropMode();
      }

      /* Sair de um texto tem que tirar o foco dele */
      const editing = document.activeElement;
      if (editing && editing.classList && editing.classList.contains('canvas-text-node__content')) {
        const owner = editing.closest('.canvas-text-node');
        if (!owner || owner.dataset.id !== String(childId)) exitTextEditing(editing);
      }

      if (childId === null) {
        if (selectedChildNodes.length > 0) dropEmptyTextNode();
        selectedChildNodes = [];
        selectedTextNode = { frameId: null, childId: null };
      } else if (isMulti) {
        selectedFrameIds.clear();
        selectedId = null;

        const existingIdx = selectedChildNodes.findIndex(n => n.frameId === frameId && n.childId === childId);
        if (existingIdx !== -1) {
          selectedChildNodes.splice(existingIdx, 1);
        } else {
          selectedChildNodes.push({ frameId, childId });
        }
        selectedTextNode = selectedChildNodes.length > 0 ? selectedChildNodes[0] : { frameId: null, childId: null };
      } else {
        selectedFrameIds.clear();
        selectedId = null;

        if (selectedChildNodes.length > 0 && selectedChildNodes[0].childId !== childId) {
          dropEmptyTextNode();
        }
        selectedChildNodes = [{ frameId, childId }];
        selectedTextNode = { frameId, childId };
      }

      world.querySelectorAll('.canvas-text-node, .canvas-image-node').forEach(el => {
        const cId = Number(el.dataset.id);
        const isSel = selectedChildNodes.some(n => n.childId === cId);
        el.classList.toggle('is-selected', isSel);
      });

      syncImageChrome();

      world.querySelectorAll('.canvas-frame').forEach(el => {
        const fId = Number(el.dataset.id);
        el.classList.toggle('is-selected', selectedChildNodes.length === 0 && selectedFrameIds.has(fId));
      });

      if (document.activeElement && document.activeElement !== document.body && !document.activeElement.isContentEditable) {
        document.activeElement.blur();
      }
      updateTextToolbar();
      updateTopbar();
      if (isMeasureKeyActive) updateMeasureGuides(lastMouseClientPos);
    }

    /* --------------------------------------------------
       Smart Measurement Tool (Figma Option / Alt Pixel Distances)
       Medição pixel-perfect de distâncias relativas às bordas do frame
       e entre elementos com a tecla Alt (Option) ou Control (Ctrl).
       -------------------------------------------------- */
    let isMeasureKeyActive = false;
    let measureLayer = null;
    let lastMouseClientPos = null;

    function ensureMeasureLayer() {
      if (!measureLayer || !world.contains(measureLayer)) {
        measureLayer = document.createElement('div');
        measureLayer.className = 'canvas-measure-layer';
        world.appendChild(measureLayer);
      }
    }

    function clearMeasureGuides() {
      if (measureLayer) {
        measureLayer.innerHTML = '';
      }
      updateTextToolbar();
    }

    function addMeasureLine(x1, y1, x2, y2, value, isVertical) {
      if (!measureLayer) ensureMeasureLayer();
      const dist = Math.round(value);
      if (dist <= 0) return;

      const line = document.createElement('div');
      line.className = `canvas-measure-line ${isVertical ? 'canvas-measure-line--v' : 'canvas-measure-line--h'}`;

      if (isVertical) {
        const top = Math.min(y1, y2);
        const height = Math.abs(y2 - y1);
        if (height < 1) return;
        line.style.left = `${x1}px`;
        line.style.top = `${top}px`;
        line.style.height = `${height}px`;
      } else {
        const left = Math.min(x1, x2);
        const width = Math.abs(x2 - x1);
        if (width < 1) return;
        line.style.left = `${left}px`;
        line.style.top = `${y1}px`;
        line.style.width = `${width}px`;
      }
      measureLayer.appendChild(line);

      const badge = document.createElement('div');
      badge.className = 'canvas-measure-badge';
      badge.textContent = `${dist}`;
      badge.style.left = `${(x1 + x2) / 2}px`;
      badge.style.top = `${(y1 + y2) / 2}px`;
      measureLayer.appendChild(badge);
    }

    function addMeasureTargetBox(x, y, w, h) {
      if (!measureLayer) ensureMeasureLayer();
      const box = document.createElement('div');
      box.className = 'canvas-measure-target-box';
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
      measureLayer.appendChild(box);
    }

    function updateMeasureGuides(mousePos) {
      if (!isMeasureKeyActive) {
        clearMeasureGuides();
        return;
      }
      // Oculta barras flutuantes de edição para não atrapalhar a visualização
      const imageToolbar = document.getElementById('canvas-image-toolbar');
      const cropToolbar = document.getElementById('canvas-crop-toolbar');
      if (textToolbar) textToolbar.classList.remove('is-visible');
      if (imageToolbar) imageToolbar.classList.remove('is-visible');
      if (cropToolbar) cropToolbar.classList.remove('is-visible');

      ensureMeasureLayer();
      if (measureLayer) measureLayer.innerHTML = '';

      // Caso 1: Um nó filho está selecionado (Imagem ou Texto)
      if (selectedChildNodes.length === 1) {
        const sel = selectedChildNodes[0];
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame) return;
        const child = (frame.children || []).find(c => c.id === sel.childId);
        if (!child) return;
        const elA = nodeElement(child.id);
        const Ah = elA ? elA.offsetHeight : (child.h || 40);
        const Aw = child.w;
        const Ax = frame.x + child.x;
        const Ay = frame.y + child.y;

        // Detecta se o mouse está sobre outro elemento ou frame
        let hoveredChild = null;
        let hoveredFrame = null;

        if (mousePos) {
          const under = document.elementFromPoint(mousePos.clientX, mousePos.clientY);
          if (under) {
            const childEl = under.closest('.canvas-text-node, .canvas-image-node');
            if (childEl && Number(childEl.dataset.id) !== child.id) {
              const cId = Number(childEl.dataset.id);
              const fEl = childEl.closest('.canvas-frame');
              const fId = fEl ? Number(fEl.dataset.id) : null;
              const hFrame = frames.find(f => f.id === fId);
              if (hFrame) {
                const hChild = (hFrame.children || []).find(c => c.id === cId);
                if (hChild) {
                  hoveredChild = { frame: hFrame, child: hChild, el: childEl };
                }
              }
            } else {
              const fEl = under.closest('.canvas-frame');
              if (fEl && Number(fEl.dataset.id) !== frame.id) {
                hoveredFrame = frames.find(f => f.id === Number(fEl.dataset.id));
              }
            }
          }
        }

        // Subcaso A: Hover em outro elemento
        if (hoveredChild) {
          const Bframe = hoveredChild.frame;
          const Bchild = hoveredChild.child;
          const Bel = hoveredChild.el;
          const Bw = Bchild.w;
          const Bh = Bel.offsetHeight || Bchild.h || 40;
          const Bx = Bframe.x + Bchild.x;
          const By = Bframe.y + Bchild.y;

          addMeasureTargetBox(Bx, By, Bw, Bh);

          // Eixo X
          if (Bx >= Ax + Aw) {
            // B está à direita de A
            const gap = Bx - (Ax + Aw);
            const midY = (Math.max(Ay, By) + Math.min(Ay + Ah, By + Bh)) / 2 || (Ay + Ah / 2);
            addMeasureLine(Ax + Aw, midY, Bx, midY, gap, false);
          } else if (Ax >= Bx + Bw) {
            // B está à esquerda de A
            const gap = Ax - (Bx + Bw);
            const midY = (Math.max(Ay, By) + Math.min(Ay + Ah, By + Bh)) / 2 || (Ay + Ah / 2);
            addMeasureLine(Bx + Bw, midY, Ax, midY, gap, false);
          } else {
            // Sobrepostos no eixo X: mostra distâncias de alinhamento
            const midY = (Ay + By) / 2;
            if (Math.abs(Ax - Bx) > 0) {
              addMeasureLine(Math.min(Ax, Bx), midY, Math.max(Ax, Bx), midY, Math.abs(Ax - Bx), false);
            }
          }

          // Eixo Y
          if (By >= Ay + Ah) {
            // B está abaixo de A
            const gap = By - (Ay + Ah);
            const midX = (Math.max(Ax, Bx) + Math.min(Ax + Aw, Bx + Bw)) / 2 || (Ax + Aw / 2);
            addMeasureLine(midX, Ay + Ah, midX, By, gap, true);
          } else if (Ay >= By + Bh) {
            // B está acima de A
            const gap = Ay - (By + Bh);
            const midX = (Math.max(Ax, Bx) + Math.min(Ax + Aw, Bx + Bw)) / 2 || (Ax + Aw / 2);
            addMeasureLine(midX, By + Bh, midX, Ay, gap, true);
          } else {
            // Sobrepostos no eixo Y: mostra distâncias de alinhamento
            const midX = (Ax + Bx) / 2;
            if (Math.abs(Ay - By) > 0) {
              addMeasureLine(midX, Math.min(Ay, By), midX, Math.max(Ay, By), Math.abs(Ay - By), true);
            }
          }
          return;
        }

        // Subcaso B: Padrão Figma — Medição em relação às 4 bordas do frame pai
        const topDist = child.y;
        const bottomDist = frame.h - (child.y + Ah);
        const leftDist = child.x;
        const rightDist = frame.w - (child.x + Aw);

        const midX = Ax + Aw / 2;
        const midY = Ay + Ah / 2;

        // Top
        if (topDist > 0) {
          addMeasureLine(midX, frame.y, midX, Ay, topDist, true);
        }
        // Bottom
        if (bottomDist > 0) {
          addMeasureLine(midX, Ay + Ah, midX, frame.y + frame.h, bottomDist, true);
        }
        // Left
        if (leftDist > 0) {
          addMeasureLine(frame.x, midY, Ax, midY, leftDist, false);
        }
        // Right
        if (rightDist > 0) {
          addMeasureLine(Ax + Aw, midY, frame.x + frame.w, midY, rightDist, false);
        }
        return;
      }

      // Caso 2: Um frame está selecionado
      if (selectedFrameIds.size === 1 && selectedChildNodes.length === 0) {
        const frameA = getSelectedFrames()[0];
        if (!frameA) return;

        let hoveredOtherFrame = null;
        if (mousePos) {
          const under = document.elementFromPoint(mousePos.clientX, mousePos.clientY);
          if (under) {
            const fEl = under.closest('.canvas-frame');
            if (fEl && Number(fEl.dataset.id) !== frameA.id) {
              hoveredOtherFrame = frames.find(f => f.id === Number(fEl.dataset.id));
            }
          }
        }

        if (hoveredOtherFrame) {
          const B = hoveredOtherFrame;
          addMeasureTargetBox(B.x, B.y, B.w, B.h);

          // Eixo X
          if (B.x >= frameA.x + frameA.w) {
            const gap = B.x - (frameA.x + frameA.w);
            const midY = (frameA.y + frameA.h / 2 + B.y + B.h / 2) / 2;
            addMeasureLine(frameA.x + frameA.w, midY, B.x, midY, gap, false);
          } else if (frameA.x >= B.x + B.w) {
            const gap = frameA.x - (B.x + B.w);
            const midY = (frameA.y + frameA.h / 2 + B.y + B.h / 2) / 2;
            addMeasureLine(B.x + B.w, midY, frameA.x, midY, gap, false);
          }

          // Eixo Y
          if (B.y >= frameA.y + frameA.h) {
            const gap = B.y - (frameA.y + frameA.h);
            const midX = (frameA.x + frameA.w / 2 + B.x + B.w / 2) / 2;
            addMeasureLine(midX, frameA.y + frameA.h, midX, B.y, gap, true);
          } else if (frameA.y >= B.y + B.h) {
            const gap = frameA.y - (B.y + B.h);
            const midX = (frameA.x + frameA.w / 2 + B.x + B.w / 2) / 2;
            addMeasureLine(midX, B.y + B.h, midX, frameA.y, gap, true);
          }
        }
      }
    }

    function startRotateNode(e, child, frame, el) {
      e.stopPropagation();
      e.preventDefault();
      selectTextNode(frame.id, child.id);

      const nodesToRotate = selectedChildNodes.length > 0 ? [...selectedChildNodes] : [{ frameId: frame.id, childId: child.id }];
      
      const initialRotations = new Map();
      nodesToRotate.forEach(sel => {
        const f = frames.find(fr => fr.id === sel.frameId);
        if (!f) return;
        const c = (f.children || []).find(ch => ch.id === sel.childId);
        if (c) initialRotations.set(`${sel.frameId}_${sel.childId}`, c.rotation || 0);
      });

      const rect = el.getBoundingClientRect();
      const centerX = (rect.left + rect.right) / 2;
      const centerY = (rect.top + rect.bottom) / 2;

      const startMouseAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);
      const startRotation = child.rotation || 0;

      document.body.classList.add('is-rotating-element');
      const rotateHandle = el.querySelector('.canvas-node__rotate-handle');
      if (rotateHandle) rotateHandle.classList.add('is-rotating');

      let hud = document.getElementById('canvas-rotation-hud');
      if (!hud) {
        hud = document.createElement('div');
        hud.id = 'canvas-rotation-hud';
        hud.className = 'canvas-rotation-hud';
        document.body.appendChild(hud);
      }
      hud.style.display = 'block';

      const updateHud = (angle, clientX, clientY) => {
        hud.textContent = `${angle}°`;
        hud.style.left = `${clientX}px`;
        hud.style.top = `${clientY}px`;
      };
      updateHud(startRotation, e.clientX, e.clientY);

      let hasMoved = false;

      const onMove = ev => {
        hasMoved = true;
        const curMouseAngle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX) * (180 / Math.PI);
        let deltaAngle = curMouseAngle - startMouseAngle;

        let targetAngle = (startRotation + deltaAngle) % 360;
        if (targetAngle < 0) targetAngle += 360;
        targetAngle = Math.round(targetAngle);

        if (ev.shiftKey) {
          targetAngle = Math.round(targetAngle / 15) * 15;
          targetAngle = ((targetAngle % 360) + 360) % 360;
        } else {
          const cardinals = [0, 45, 90, 135, 180, 225, 270, 315, 360];
          for (const card of cardinals) {
            if (Math.abs(targetAngle - card) <= 2.5) {
              targetAngle = card % 360;
              break;
            }
          }
        }

        const angleDiff = targetAngle - startRotation;

        nodesToRotate.forEach(sel => {
          const f = frames.find(fr => fr.id === sel.frameId);
          if (!f) return;
          const c = (f.children || []).find(ch => ch.id === sel.childId);
          const initRot = initialRotations.get(`${sel.frameId}_${sel.childId}`) || 0;
          if (!c) return;

          if (sel.childId === child.id) {
            c.rotation = targetAngle;
          } else {
            c.rotation = ((initRot + angleDiff) % 360 + 360) % 360;
          }

          const nodeDom = nodeElement(c.id);
          if (nodeDom) {
            nodeDom.style.transform = c.rotation ? `rotate(${c.rotation}deg)` : '';
            nodeDom.style.transformOrigin = 'center center';
          }
          /* As 8 alças moram numa camada fora da máscara do frame: sem isto
             elas ficavam paradas enquanto a imagem girava. */
          if (c.type === 'image') {
            const chromeDom = imageChromeOf(c);
            if (chromeDom) positionImageChrome(chromeDom, c);
          }
        });

        updateHud(targetAngle, ev.clientX, ev.clientY);
        updateTextToolbar();
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('is-rotating-element');
        if (rotateHandle) rotateHandle.classList.remove('is-rotating');
        if (hud) hud.style.display = 'none';
        if (hasMoved) {
          saveQuiet();
          updateTextToolbar();
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    function startChildNodeDrag(e, child, frame, el) {
      const isMultiKey = e.shiftKey || e.metaKey || e.ctrlKey;
      const alreadySelected = isChildNodeSelected(frame.id, child.id);

      if (isMultiKey) {
        selectTextNode(frame.id, child.id, true);
        return;
      }

      if (!alreadySelected) {
        selectTextNode(frame.id, child.id, false);
      }

      const startX = e.clientX;
      const startY = e.clientY;
      const nodesToMove = [...selectedChildNodes];
      const origins = new Map();
      nodesToMove.forEach(n => {
        const f = frames.find(fr => fr.id === n.frameId);
        if (!f) return;
        const c = (f.children || []).find(ch => ch.id === n.childId);
        if (!c) return;
        origins.set(`${n.frameId}_${n.childId}`, { x: c.x, y: c.y });
        const cEl = nodeElement(c.id);
        if (cEl) cEl.classList.add('is-dragging');
      });

      let moved = false;
      const frameEl = frameElOf(frame);
      const snapGuideV = frameEl ? frameEl.querySelector('.canvas-frame__snap-guide--v') : null;
      const snapGuideH = frameEl ? frameEl.querySelector('.canvas-frame__snap-guide--h') : null;

      const onMove = ev => {
        if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) {
          moved = true;
        }
        if (!moved) return;

        let dx = (ev.clientX - startX) / cam.scale;
        let dy = (ev.clientY - startY) / cam.scale;

        // Snapping se apenas 1 elemento estiver selecionado
        if (nodesToMove.length === 1 && snapEnabled && frame) {
          const orig = origins.get(`${frame.id}_${child.id}`);
          if (orig) {
            let targetX = orig.x + dx;
            let targetY = orig.y + dy;
            const nodeH = el.offsetHeight || child.h || 40;
            const nodeW = child.w || el.offsetWidth || 100;
            const nodeCenterX = targetX + nodeW / 2;
            const nodeCenterY = targetY + nodeH / 2;
            // O ímã horizontal mira o centro da fatia sob o elemento, não da faixa
            const slice = sliceBoundsFor(frame, nodeCenterX);
            const frameCenterX = slice.left + slice.width / 2;
            const frameCenterY = frame.h / 2;
            const SNAP_DIST = 16;

            /* Ímã de largura (estilo Figma): centro, bordas da fatia e
               metades da fatia — cobre os encaixes que importam num post. */
            const magnetXs = [
              { at: slice.left + slice.width / 2, edge: 'center' },
              { at: slice.left, edge: 'left' },
              { at: slice.left + slice.width, edge: 'right' },
              { at: slice.left + slice.width / 4, edge: 'quarter-l' },
              { at: slice.left + (slice.width * 3) / 4, edge: 'quarter-r' }
            ];
            let bestX = null;
            let bestGuideX = null;
            magnetXs.forEach(m => {
              // Testa o centro do nó e cada borda dele contra o ímã
              const probes = [nodeCenterX, targetX, targetX + nodeW];
              probes.forEach((probe, pi) => {
                if (Math.abs(probe - m.at) < SNAP_DIST && (bestX === null || Math.abs(probe - m.at) < Math.abs(bestX.probe - bestX.m.at))) {
                  const shift = m.at - probe;
                  bestX = { probe, m, shift };
                  bestGuideX = m.at;
                }
              });
            });
            if (bestX) {
              targetX = Math.round(targetX + bestX.shift);
              dx = targetX - orig.x;
              if (snapGuideV) {
                snapGuideV.style.left = `${bestGuideX}px`;
                snapGuideV.classList.add('is-active');
              }
            } else if (snapGuideV) {
              snapGuideV.classList.remove('is-active');
            }

            /* A guia vertical rosa respeita a fatia em que o elemento está:
               ela nasce na borda esquerda e morre na direita do post atual. */
            if (snapGuideV) {
              snapGuideV.style.left = `${slice.left}px`;
              snapGuideV.style.width = `${slice.width}px`;
              snapGuideV.style.right = 'auto';
              snapGuideV.style.transform = 'none';
              snapGuideV.style.background = 'transparent';
              snapGuideV.style.borderLeft = `calc(1px * var(--inv, 1)) solid #EC4899`;
              snapGuideV.style.boxSizing = 'border-box';
            }

            /* Ímã vertical: centro, topo e base da faixa (Figma: edges + center) */
            const magnetYs = [
              { at: frameCenterY },
              { at: 0 },
              { at: frame.h }
            ];
            let bestY = null;
            magnetYs.forEach(m => {
              const probes = [nodeCenterY, targetY, targetY + nodeH];
              probes.forEach(probe => {
                if (Math.abs(probe - m.at) < SNAP_DIST && (bestY === null || Math.abs(probe - m.at) < Math.abs(bestY.probe - bestY.m.at))) {
                  bestY = { probe, m, shift: m.at - probe };
                }
              });
            });
            if (bestY) {
              targetY = Math.round(targetY + bestY.shift);
              dy = targetY - orig.y;
              if (snapGuideH) snapGuideH.classList.add('is-active');
            } else if (snapGuideH) {
              snapGuideH.classList.remove('is-active');
            }
          }
        }

        nodesToMove.forEach(n => {
          const f = frames.find(fr => fr.id === n.frameId);
          if (!f) return;
          const c = (f.children || []).find(ch => ch.id === n.childId);
          const orig = origins.get(`${n.frameId}_${n.childId}`);
          if (!c || !orig) return;

          c.x = Math.round(orig.x + dx);
          c.y = Math.round(orig.y + dy);
          /* Mesma regra do frame: no arraste anda por transform (camada
             composta), senão uma foto grande é repintada inteira a cada
             quadro e a tela engasga. A rotação entra junto, senão o elemento
             girado voltava ao ângulo zero assim que era arrastado. */
          const cEl = nodeElement(c.id);
          const giro = c.rotation ? ` rotate(${c.rotation}deg)` : '';
          const passo = `translate3d(${c.x - orig.x}px, ${c.y - orig.y}px, 0)${giro}`;
          if (cEl) cEl.style.transform = passo;
          // As alças vivem noutra camada: sem isto ficavam paradas no lugar antigo
          if (c.type === 'image') {
            const chromeDom = imageChromeOf(c);
            if (chromeDom) chromeDom.style.transform = passo;
          }
        });
        updateTextToolbar();
      };

      const onUp = () => {
        nodesToMove.forEach(n => {
          const f = frames.find(fr => fr.id === n.frameId);
          const c = f && (f.children || []).find(ch => ch.id === n.childId);
          const cEl = nodeElement(n.childId);
          if (!cEl) return;
          // Devolve a posição definitiva e mantém a rotação que o nó já tinha
          cEl.style.transform = (c && c.rotation) ? `rotate(${c.rotation}deg)` : '';
          if (c) {
            cEl.style.left = `${c.x}px`;
            cEl.style.top = `${c.y}px`;
            if (c.type === 'image') {
              const chromeDom = imageChromeOf(c);
              if (chromeDom) positionImageChrome(chromeDom, c);
            }
          }
          cEl.classList.remove('is-dragging');
        });
        if (snapGuideV) snapGuideV.classList.remove('is-active');
        if (snapGuideH) snapGuideH.classList.remove('is-active');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (moved) saveQuiet();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    let worldGuideV = null;
    let worldGuideH = null;

    function ensureWorldGuides() {
      if (!worldGuideV || !world.contains(worldGuideV)) {
        worldGuideV = document.createElement('div');
        worldGuideV.className = 'canvas-world-guide canvas-world-guide--v';
        worldGuideV.style.display = 'none';
        world.appendChild(worldGuideV);
      }
      if (!worldGuideH || !world.contains(worldGuideH)) {
        worldGuideH = document.createElement('div');
        worldGuideH.className = 'canvas-world-guide canvas-world-guide--h';
        worldGuideH.style.display = 'none';
        world.appendChild(worldGuideH);
      }
    }

    function startFrameDrag(e, frame) {
      const isMultiKey = e.shiftKey || e.metaKey || e.ctrlKey;
      const alreadySelected = isFrameSelected(frame.id);

      if (isMultiKey) {
        selectFrame(frame.id, true);
        return;
      }

      selectTextNode(null, null);

      if (!alreadySelected || selectedFrameIds.size > 1) {
        selectFrame(frame.id, false);
      } else {
        updateTopbar();
        updateTextToolbar();
      }

      ensureWorldGuides();

      const startX = e.clientX;
      const startY = e.clientY;
      const framesToMove = getSelectedFrames();
      const originPositions = new Map();
      framesToMove.forEach(f => {
        originPositions.set(f.id, { x: f.x, y: f.y });
        const fEl = frameElOf(f);
        if (fEl) fEl.classList.add('is-dragging');
      });

      // Frames estáticos que servem de âncora para o snap magnético
      const movingIds = new Set(framesToMove.map(f => f.id));
      const staticFrames = frames.filter(f => !movingIds.has(f.id));

      const primaryOrig = originPositions.get(frame.id) || { x: frame.x, y: frame.y };
      const SNAP_THRESHOLD = 20; // Raio magnético em pixels do mundo

      let moved = false;

      const onMove = (ev) => {
        let rawDx = (ev.clientX - startX) / cam.scale;
        let rawDy = (ev.clientY - startY) / cam.scale;

        if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) {
          moved = true;
        }
        if (!moved) return;

        let dx = rawDx;
        let dy = rawDy;

        let snappedGuideX = null;
        let snappedGuideY = null;

        if (snapEnabled && staticFrames.length > 0) {
          const rawTargetX = primaryOrig.x + rawDx;
          const rawTargetY = primaryOrig.y + rawDy;
          const Fw = frame.w;
          const Fh = frame.h;

          let bestDiffX = Infinity;
          let bestSnapX = null;
          let bestGuideX = null;

          let bestDiffY = Infinity;
          let bestSnapY = null;
          let bestGuideY = null;

          staticFrames.forEach(other => {
            const Ow = other.w;
            const Oh = other.h;

            // --- ALINHAMENTOS HORIZONTAIS (EIXO X) ---
            const xAlignments = [
              // Esquerda com Esquerda
              { snapX: other.x, guideX: other.x },
              // Centro com Centro
              { snapX: other.x + (Ow - Fw) / 2, guideX: other.x + Ow / 2 },
              // Direita com Direita
              { snapX: other.x + Ow - Fw, guideX: other.x + Ow },
              // Lado a Lado com Gap padrão (120px)
              { snapX: other.x + Ow + FRAME_GAP, guideX: other.x + Ow },
              { snapX: other.x - FRAME_GAP - Fw, guideX: other.x },
              // Lado a Lado encostado (0px)
              { snapX: other.x + Ow, guideX: other.x + Ow },
              { snapX: other.x - Fw, guideX: other.x }
            ];

            xAlignments.forEach(cand => {
              const diff = Math.abs(cand.snapX - rawTargetX);
              if (diff < SNAP_THRESHOLD && diff < bestDiffX) {
                bestDiffX = diff;
                bestSnapX = cand.snapX;
                bestGuideX = cand.guideX;
              }
            });

            // --- ALINHAMENTOS VERTICAIS (EIXO Y) ---
            const yAlignments = [
              // Topo com Topo
              { snapY: other.y, guideY: other.y },
              // Centro com Centro
              { snapY: other.y + (Oh - Fh) / 2, guideY: other.y + Oh / 2 },
              // Base com Base
              { snapY: other.y + Oh - Fh, guideY: other.y + Oh },
              // Empilhado com Gap padrão (120px)
              { snapY: other.y + Oh + FRAME_GAP, guideY: other.y + Oh },
              { snapY: other.y - FRAME_GAP - Fh, guideY: other.y },
              // Empilhado encostado (0px)
              { snapY: other.y + Oh, guideY: other.y + Oh },
              { snapY: other.y - Fh, guideY: other.y }
            ];

            yAlignments.forEach(cand => {
              const diff = Math.abs(cand.snapY - rawTargetY);
              if (diff < SNAP_THRESHOLD && diff < bestDiffY) {
                bestDiffY = diff;
                bestSnapY = cand.snapY;
                bestGuideY = cand.guideY;
              }
            });
          });

          if (bestSnapX !== null) {
            dx = bestSnapX - primaryOrig.x;
            snappedGuideX = bestGuideX;
          }
          if (bestSnapY !== null) {
            dy = bestSnapY - primaryOrig.y;
            snappedGuideY = bestGuideY;
          }
        }

        // Exibe ou oculta as guias visuais magnéticas na tela
        if (worldGuideV) {
          if (snappedGuideX !== null) {
            worldGuideV.style.left = `${snappedGuideX}px`;
            worldGuideV.style.display = 'block';
          } else {
            worldGuideV.style.display = 'none';
          }
        }

        if (worldGuideH) {
          if (snappedGuideY !== null) {
            worldGuideH.style.top = `${snappedGuideY}px`;
            worldGuideH.style.display = 'block';
          } else {
            worldGuideH.style.display = 'none';
          }
        }

        /* Durante o arraste o frame anda por transform, não por left/top:
           left/top refaz o layout a cada quadro (é o que fazia o frame e o que
           está em volta dele tremerem). O transform vira uma camada composta e
           o desenho de dentro nem é repintado. A posição real entra no soltar. */
        framesToMove.forEach(f => {
          const orig = originPositions.get(f.id);
          if (orig) {
            f.x = Math.round(orig.x + dx);
            f.y = Math.round(orig.y + dy);
            const fEl = frameElOf(f);
            if (fEl) {
              /* Frame gigante (panorâmica de 5400px) não pode virar textura GPU:
                 acima do tile de 4096px do Chrome ele é fatiado e re-rasterizado
                 no meio do arrasto — era o piscar branco. Neles a posição anda
                 por left/top, sem promover a camada. */
              const huge = f.w > 4000 || f.h > 4000;
              fEl.classList.toggle('is-dragging-huge', huge);
              if (huge) {
                fEl.style.transform = '';
                fEl.style.left = `${f.x}px`;
                fEl.style.top = `${f.y}px`;
              } else {
                fEl.style.transform = `translate3d(${f.x - orig.x}px, ${f.y - orig.y}px, 0)`;
              }
            }
          }
        });
        wakeRopes();
      };

      const onUp = () => {
        if (worldGuideV) worldGuideV.style.display = 'none';
        if (worldGuideH) worldGuideH.style.display = 'none';
        framesToMove.forEach(f => {
          const fEl = frameElOf(f);
          if (!fEl) return;
          // Troca o transform do arraste pela posição definitiva
          fEl.style.transform = '';
          fEl.style.left = `${f.x}px`;
          fEl.style.top = `${f.y}px`;
          fEl.classList.remove('is-dragging', 'is-dragging-huge');
        });
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (moved) saveQuiet();
        updateTextToolbar();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    function renderImageNode(child, frame, frameEl) {
      ensureImageProps(child);

      const el = document.createElement('div');
      el.className = 'canvas-image-node';
      el.dataset.id = child.id;

      // 1. Ghost Layer (contextual preview outside the crop mask)
      const ghost = document.createElement('div');
      ghost.className = 'canvas-image-node__ghost';
      const ghostImg = document.createElement('img');
      ghostImg.className = 'canvas-image-node__ghost-img';
      ghostImg.draggable = false;
      ghost.appendChild(ghostImg);
      el.appendChild(ghost);

      // 2. Clip Layer (máscara de exibição com overflow: hidden)
      const clip = document.createElement('div');
      clip.className = 'canvas-image-node__clip';

      const img = document.createElement('img');
      img.className = 'canvas-image-node__img';
      img.draggable = false;
      clip.appendChild(img);
      el.appendChild(clip);

      // Helper de sincronização de imagem com auto-ajuste de proporção natural
      const onImageLoaded = () => {
        const nw = img.naturalWidth || img.width;
        const nh = img.naturalHeight || img.height;
        if (!nw || !nh) return;

        if (child.origW !== nw || child.origH !== nh) {
          const newAspect = nw / nh;
          child.origW = nw;
          child.origH = nh;

          // Se a imagem não tem recorte específico ativo, adapta a altura do nó para não espremer/distorcer
          if ((!child.imgX && !child.imgY) || (child.zoom === 1 || !child.zoom)) {
            child.h = Math.round(child.w / newAspect);
            child.imgW = child.w;
            child.imgH = child.h;
            child.imgX = 0;
            child.imgY = 0;
          } else {
            const maskAspect = child.w / child.h;
            if (newAspect > maskAspect) {
              child.imgH = child.h;
              child.imgW = Math.round(child.h * newAspect);
              child.imgX = Math.round((child.w - child.imgW) / 2);
              child.imgY = 0;
            } else {
              child.imgW = child.w;
              child.imgH = Math.round(child.w / newAspect);
              child.imgX = 0;
              child.imgY = Math.round((child.h - child.imgH) / 2);
            }
          }
          updateImageNodeDOM(child, el);
          updateTextToolbar();
        }
      };

      img.onload = onImageLoaded;

      const setImgSrc = (src) => {
        img.src = src;
        ghostImg.src = src;
      };

      if (child.src) {
        setImgSrc(child.src);
      } else if (child.assetId) {
        if (assetCache.has(child.assetId)) {
          setImgSrc(assetCache.get(child.assetId));
        } else {
          getAsset(child.assetId).then(src => {
            if (src) {
              assetCache.set(child.assetId, src);
              setImgSrc(src);
            }
          });
        }
      }

      updateImageNodeDOM(child, el);
      paintBind(child, el);

      // 3. Alça SE de redimensionamento em modo normal
      const resizerSE = document.createElement('div');
      resizerSE.className = 'canvas-image-node__resize canvas-image-node__resize--se';
      el.appendChild(resizerSE);

      // 4. 8 Alças de Recorte (estilo Figma / Canva)
      const cropHandles = [
        { type: 'corner', dir: 'nw' },
        { type: 'corner', dir: 'ne' },
        { type: 'corner', dir: 'sw' },
        { type: 'corner', dir: 'se' },
        { type: 'edge', dir: 'n' },
        { type: 'edge', dir: 's' },
        { type: 'edge', dir: 'w' },
        { type: 'edge', dir: 'e' }
      ];

      cropHandles.forEach(h => {
        const handleEl = document.createElement('div');
        handleEl.className = `canvas-crop-handle canvas-crop-handle--${h.type} canvas-crop-handle--${h.dir}`;
        handleEl.dataset.cropHandle = h.dir;
        el.appendChild(handleEl);
      });

      // 5. Alça de Rotação 360°
      const rotateHandle = document.createElement('div');
      rotateHandle.className = 'canvas-node__rotate-handle';
      rotateHandle.title = 'Girar imagem (Shift para travar a cada 15°)';
      rotateHandle.innerHTML = `
        <svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
          <path d="M21 3v5h-5"/>
        </svg>
      `;
      el.appendChild(rotateHandle);

      // Duplo clique: Alterna modo de recorte (Figma style)
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (croppingImage && croppingImage.childId === child.id) {
          exitCropMode();
        } else {
          enterCropMode(frame.id, child.id);
        }
      });

      // Scroll de roda / pinch zoom no modo de recorte
      el.addEventListener('wheel', (e) => {
        if (!croppingImage || croppingImage.childId !== child.id) return;
        e.preventDefault();
        e.stopPropagation();
        const delta = -e.deltaY * 0.0025;
        ensureImageProps(child);
        const nextZoom = Math.min(5, Math.max(1, (child.zoom || 1.0) + delta));
        setCropZoom(nextZoom);
      }, { passive: false });

      // Mousedown para ações (Recorte vs Normal)
      el.addEventListener('mousedown', (e) => {
        const isCroppingThis = croppingImage && croppingImage.childId === child.id;

        const rotHandle = e.target.closest('.canvas-node__rotate-handle');
        if (rotHandle && !isCroppingThis) {
          startRotateNode(e, child, frame, el);
          return;
        }

        // Caso A: Arrastando uma das 8 alças de recorte
        const cropHandle = e.target.closest('.canvas-crop-handle');
        if (isCroppingThis && cropHandle) {
          e.stopPropagation();
          e.preventDefault();
          const dir = cropHandle.dataset.cropHandle;
          const startX = e.clientX;
          const startY = e.clientY;
          const originX = child.x;
          const originY = child.y;
          const originW = child.w;
          const originH = child.h;
          const originImgX = child.imgX;
          const originImgY = child.imgY;

          const onMove = ev => {
            const dx = (ev.clientX - startX) / cam.scale;
            const dy = (ev.clientY - startY) / cam.scale;

            let targetX = originX;
            let targetY = originY;
            let targetW = originW;
            let targetH = originH;
            let targetImgX = originImgX;
            let targetImgY = originImgY;

            if (dir.includes('e')) {
              targetW = Math.max(20, originW + dx);
            }
            if (dir.includes('s')) {
              targetH = Math.max(20, originH + dy);
            }
            if (dir.includes('w')) {
              const maxDx = originW - 20;
              const actualDx = Math.min(maxDx, dx);
              targetX = originX + actualDx;
              targetW = originW - actualDx;
              targetImgX = originImgX - actualDx;
            }
            if (dir.includes('n')) {
              const maxDy = originH - 20;
              const actualDy = Math.min(maxDy, dy);
              targetY = originY + actualDy;
              targetH = originH - actualDy;
              targetImgY = originImgY - actualDy;
            }

            child.x = Math.round(targetX);
            child.y = Math.round(targetY);
            child.w = Math.round(targetW);
            child.h = Math.round(targetH);
            child.imgX = Math.round(targetImgX);
            child.imgY = Math.round(targetImgY);

            updateImageNodeDOM(child, el);
            updateCropToolbar();
          };

          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            saveQuiet(); // arrasto: salva igual, sem acender o "Salvando…"
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
          return;
        }

        // Caso B: Em modo de recorte, arrastar a imagem faz o pan dentro da máscara
        if (isCroppingThis) {
          e.stopPropagation();
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          const originImgX = child.imgX;
          const originImgY = child.imgY;

          const onMove = ev => {
            const dx = (ev.clientX - startX) / cam.scale;
            const dy = (ev.clientY - startY) / cam.scale;
            child.imgX = Math.round(originImgX + dx);
            child.imgY = Math.round(originImgY + dy);
            updateImageNodeDOM(child, el);
          };

          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            saveQuiet(); // arrasto: salva igual, sem acender o "Salvando…"
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
          return;
        }

        // Caso C: Redimensionamento em modo normal (alça SE)
        if (e.target === resizerSE) {
          e.stopPropagation();
          e.preventDefault();
          selectTextNode(frame.id, child.id);
          const startX = e.clientX;
          const originW = child.w;
          const originH = child.h;
          const originImgW = child.imgW;
          const originImgH = child.imgH;
          const originImgX = child.imgX;
          const originImgY = child.imgY;
          const ratio = originW / originH;
          
          const onMove = ev => {
            const delta = (ev.clientX - startX) / cam.scale;
            const newW = Math.max(20, originW + delta);
            const scaleFactor = newW / originW;
            child.w = Math.round(newW);
            child.h = Math.round(newW / ratio);
            child.imgW = Math.round(originImgW * scaleFactor);
            child.imgH = Math.round(originImgH * scaleFactor);
            child.imgX = Math.round(originImgX * scaleFactor);
            child.imgY = Math.round(originImgY * scaleFactor);
            updateImageNodeDOM(child, el);
            updateTextToolbar();
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            saveQuiet(); // arrasto: salva igual, sem acender o "Salvando…"
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
          return;
        }

        // Caso D: Movimentação em modo normal (com suporte a multi-seleção e Snapping)
        e.stopPropagation();
        e.preventDefault();
        startChildNodeDrag(e, child, frame, el);
      });

      // Dentro da máscara do frame: imagem grande demais é cortada nas bordas
      const contentMask = frameEl.querySelector('.canvas-frame__content');
      if (contentMask) contentMask.appendChild(el);
      else frameEl.appendChild(el);
      return el;
    }

    /* --------------------------------------------------
       Variáveis do Batch Create
       O nó continua mostrando o texto de exemplo — é ele que faz o design ficar
       de pé. O `bind` é só a etiqueta que diz de qual coluna da planilha esse
       nó vai puxar o conteúdo na hora de gerar o lote.
       -------------------------------------------------- */
    const BIND_RE = /^[a-z0-9_]+$/;

    // "Título Principal!" -> "titulo_principal": o nome que vira coluna do CSV
    function slugifyBind(raw) {
      return (raw || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 32);
    }

    function paintBind(child, el) {
      el.classList.toggle('has-bind', !!child.bind);
      let tag = el.querySelector('.canvas-node__bind');
      if (!child.bind) {
        if (tag) tag.remove();
        return;
      }
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'canvas-node__bind';
        el.appendChild(tag);
      }
      tag.textContent = `{{${child.bind}}}`;
    }

    /* Qualquer código que pinte is-selected nos nós sem passar por
       selectTextNode (marquee, undo, delete, paste) também precisa manter
       o chrome em sincronia — este observer cobre todos de uma vez. */
    function watchSelectionForChrome() {
      const mo = new MutationObserver(() => syncImageChrome());
      mo.observe(world, { subtree: true, attributeFilter: ['class'], attributeOldValue: false });
    }

    function nodeElement(childId) {
      return world.querySelector(`.canvas-text-node[data-id="${childId}"], .canvas-image-node[data-id="${childId}"]`);
    }

    function toggleBind() {
      const child = selectedChild();
      if (!child) return;
      if (window.openBindModal) {
        window.openBindModal({ type: 'child', child });
      }
    }

    let _measureDiv = null;
    function getExactTextHeight(child) {
      if (!child) return 40;
      if (!_measureDiv) {
        _measureDiv = document.createElement('div');
        _measureDiv.style.position = 'fixed';
        _measureDiv.style.left = '-99999px';
        _measureDiv.style.top = '-99999px';
        _measureDiv.style.visibility = 'hidden';
        _measureDiv.style.pointerEvents = 'none';
        _measureDiv.style.boxSizing = 'border-box';
        _measureDiv.style.whiteSpace = 'pre-wrap';
        _measureDiv.style.wordBreak = 'break-word';
        _measureDiv.style.padding = '0';
        _measureDiv.style.margin = '0';
        _measureDiv.style.border = 'none';
        document.body.appendChild(_measureDiv);
      }

      const fontSize = child.fontSize || 48;
      const fontFamily = child.fontFamily || '"Inter Tight", sans-serif';
      const fontWeight = child.fontWeight || 500;
      const lineHeight = child.lineHeight || 1.15;
      const letterSpacing = child.letterSpacing != null ? `${child.letterSpacing}em` : 'normal';
      const textTransform = child.transform || 'none';

      _measureDiv.style.width = `${child.w || 600}px`;
      _measureDiv.style.fontFamily = fontFamily;
      _measureDiv.style.fontSize = `${fontSize}px`;
      _measureDiv.style.fontWeight = String(fontWeight);
      _measureDiv.style.lineHeight = String(lineHeight);
      _measureDiv.style.letterSpacing = letterSpacing;
      _measureDiv.style.textTransform = textTransform;

      if (child.html) {
        _measureDiv.innerHTML = child.html;
      } else {
        _measureDiv.textContent = child.text || '';
      }

      return Math.max(10, Math.round(_measureDiv.offsetHeight || _measureDiv.scrollHeight));
    }

    function isHorizontallyAligned(a, b) {
      const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (overlap > 12) return true;
      const aCenter = a.x + a.w / 2;
      const bCenter = b.x + b.w / 2;
      return Math.abs(aCenter - bCenter) < Math.max(a.w, b.w) * 0.7;
    }

    function renderChildNode(child, frame, frameEl) {
      if (child.type === 'image') return renderImageNode(child, frame, frameEl);
      if (child.type !== 'text') return;
      const el = document.createElement('div');
      el.className = 'canvas-text-node';
      el.dataset.id = child.id;
      el.style.left = `${child.x}px`;
      el.style.top = `${child.y}px`;
      el.style.width = `${child.w}px`;
      el.style.transform = child.rotation ? `rotate(${child.rotation}deg)` : '';
      el.style.transformOrigin = 'center center';
      
      const content = document.createElement('div');
      content.className = 'canvas-text-node__content';
      // Nasce só selecionável: quem liga a edição é o duplo clique
      content.contentEditable = 'false';
      content.spellcheck = false;
      // html só existe quando algum trecho ganhou estilo próprio
      if (child.html) content.innerHTML = child.html;
      else content.textContent = child.text || '';
      paintTextStyle(child, content);

      let baselineHeight = 0;
      let baselineYMap = new Map();

      content.addEventListener('focus', () => {
        selectTextNode(frame.id, child.id);
        baselineHeight = content.offsetHeight || getExactTextHeight(child);
        baselineYMap = new Map();
        (frame.children || []).forEach(c => {
          if (c.type === 'text') baselineYMap.set(c.id, c.y);
        });
      });

      content.addEventListener('input', () => {
        syncTextHtml(child, content);
        const currentHeight = content.offsetHeight || getExactTextHeight(child);
        if (baselineHeight > 0 && baselineYMap.size > 0) {
          const delta = currentHeight - baselineHeight;
          (frame.children || []).forEach(c => {
            if (c.type === 'text' && c.id !== child.id && c.y >= child.y && isHorizontallyAligned(child, c)) {
              const origY = baselineYMap.has(c.id) ? baselineYMap.get(c.id) : c.y;
              c.y = Math.round(origY + delta);
              const nodeEl = frameEl ? frameEl.querySelector(`.canvas-text-node[data-id="${c.id}"]`) : null;
              if (nodeEl) nodeEl.style.top = `${c.y}px`;
            }
          });
        }
        saveQuiet(); // uma tecla não é "ação nomeada": não vale spinner
        updateTextToolbar(); // in case height changes, repositions toolbar
      });

      content.addEventListener('blur', () => {
        baselineHeight = 0;
        baselineYMap.clear();
      });

      /* Colar traz HTML do Word, do Notion, do que for. O conteúdo entra cru:
         a marcação de fora sobreporia a tipografia daqui, e os únicos spans
         que este editor entende são os data-run que ele mesmo cria. */
      content.addEventListener('paste', (e) => {
        e.preventDefault();
        const plain = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, plain);
      });

      el.appendChild(content);
      paintBind(child, el);

      // Resize handle E
      const resizerE = document.createElement('div');
      resizerE.className = 'canvas-text-node__resize canvas-text-node__resize--e';
      el.appendChild(resizerE);

      // Rotate handle
      const rotateHandle = document.createElement('div');
      rotateHandle.className = 'canvas-node__rotate-handle';
      rotateHandle.title = 'Girar texto (Shift para travar a cada 15°)';
      rotateHandle.innerHTML = `
        <svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
          <path d="M21 3v5h-5"/>
        </svg>
      `;
      el.appendChild(rotateHandle);

      // Mouse drag no texto
      el.addEventListener('mousedown', (e) => {
        const rotHandle = e.target.closest('.canvas-node__rotate-handle');
        if (rotHandle) {
          startRotateNode(e, child, frame, el);
          return;
        }

        if (e.target === resizerE) {
          // Lida com o resize horizontal
          e.stopPropagation();
          e.preventDefault();
          selectTextNode(frame.id, child.id);
          const startX = e.clientX;
          const originW = child.w;
          const originH = content.offsetHeight || getExactTextHeight(child);
          const resizeYMap = new Map();
          (frame.children || []).forEach(c => {
            if (c.type === 'text') resizeYMap.set(c.id, c.y);
          });
          
          const onMove = ev => {
            const delta = (ev.clientX - startX) / cam.scale;
            child.w = Math.max(20, originW + delta);
            el.style.width = `${child.w}px`;
            const currentH = content.offsetHeight || getExactTextHeight(child);
            const deltaH = currentH - originH;
            (frame.children || []).forEach(c => {
              if (c.type === 'text' && c.id !== child.id && c.y >= child.y && isHorizontallyAligned(child, c)) {
                const origY = resizeYMap.has(c.id) ? resizeYMap.get(c.id) : c.y;
                c.y = Math.round(origY + deltaH);
                const nodeEl = frameEl ? frameEl.querySelector(`.canvas-text-node[data-id="${c.id}"]`) : null;
                if (nodeEl) nodeEl.style.top = `${c.y}px`;
              }
            });
            updateTextToolbar();
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            saveQuiet(); // arrasto: salva igual, sem acender o "Salvando…"
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
          return;
        }

        /* Já editando: o navegador cuida do resto — caret no ponto do clique,
           arrastar para selecionar, duplo clique na palavra, triplo no bloco.
           Qualquer preventDefault aqui mataria os três.
           contains, e não ===: clicar num trecho estilizado acerta o span. */
        if (document.activeElement === content && content.contains(e.target)) return;

        e.stopPropagation();
        e.preventDefault();
        startChildNodeDrag(e, child, frame, el);
      });

      // Duplo clique abre a edição com o cursor onde o mouse parou
      el.addEventListener('dblclick', (e) => {
        if (e.target === resizerE || e.target.closest('.canvas-node__rotate-handle')) return;
        e.stopPropagation();
        selectTextNode(frame.id, child.id);
        enterTextEditing(content, e.clientX, e.clientY);
      });

      // Dentro da máscara do frame: texto além da borda é cortado
      const contentMask = frameEl.querySelector('.canvas-frame__content');
      if (contentMask) contentMask.appendChild(el);
      else frameEl.appendChild(el);
      return el;
    }

    /* CRUD do nó de texto. Mesmo molde do frame: mexe no JSON, deriva o DOM.
       Todo caminho de criação (botão, tecla T, duplo clique) passa por aqui. */
    function frameElOf(frame) {
      return world.querySelector(`.canvas-frame[data-id="${frame.id}"]`);
    }

    function focusTextNode(childId) {
      const dom = world.querySelector(`.canvas-text-node[data-id="${childId}"]`);
      if (!dom) return;
      const content = dom.querySelector('.canvas-text-node__content');
      // Texto recém-criado já entra em edição: foi para isso que ele nasceu
      if (content) enterTextEditing(content);
    }

    function addTextNode(frame, localX, localY) {
      const frameEl = frameElOf(frame);
      if (!frameEl) return;
      if (!frame.children) frame.children = [];
      const child = {
        ...TEXT_DEFAULTS,
        id: childSeq++,
        type: 'text',
        x: localX,
        y: localY,
        w: Math.min(600, Math.round(frame.w * 0.72)),
        text: '',
      };
      frame.children.push(child);
      renderChildNode(child, frame, frameEl);
      selectTextNode(frame.id, child.id);
      save();
      // O caret não nasce sozinho num contentEditable vazio recém-inserido
      setTimeout(() => focusTextNode(child.id), 30);
    }

    // Sem coordenada: entra no meio do frame, que é onde o olho já está
    function addTextToSelectedFrame() {
      const frame = frames.find(f => f.id === selectedId);
      if (!frame) return;
      const w = Math.min(600, Math.round(frame.w * 0.72));
      addTextNode(frame, Math.round((frame.w - w) / 2), Math.round(frame.h / 2 - 24));
    }

    async function addImageNode(frame, rawData, imgW, imgH, customX, customY) {
      if (!frame.children) frame.children = [];
      const frameEl = frameElOf(frame);
      if (!frameEl) return;
      
      const MAX_W = Math.min(800, Math.round(frame.w * 0.8));
      let w = imgW;
      let h = imgH;
      if (w > MAX_W) {
        h = Math.round(h * (MAX_W / w));
        w = MAX_W;
      }

      const x = customX !== undefined ? customX : Math.round((frame.w - w) / 2);
      const y = customY !== undefined ? customY : Math.round((frame.h - h) / 2);

      const assetId = 'asset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      assetCache.set(assetId, rawData);
      await saveAsset(assetId, rawData);

      const child = {
        id: childSeq++,
        type: 'image',
        assetId,
        x, y, w, h,
        origW: imgW,
        origH: imgH,
        imgX: 0,
        imgY: 0,
        imgW: w,
        imgH: h,
        zoom: 1.0,
        borderRadius: 0,
        borderWidth: 0,
        borderColor: '#000000',
        opacity: 100,
        blur: 0,
        shadow: 0
      };
      frame.children.push(child);
      renderChildNode(child, frame, frameEl);
      selectTextNode(frame.id, child.id);
      save();
    }

    function duplicateTextNode() {
      if (selectedChildNodes.length === 0) return;
      const newSelections = [];
      selectedChildNodes.forEach(sel => {
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame) return;
        const src = (frame.children || []).find(c => c.id === sel.childId);
        const frameEl = frameElOf(frame);
        if (!src || !frameEl) return;
        // Deslocamento diagonal para a cópia não sumir embaixo do original
        const copy = {
          ...src,
          id: childSeq++,
          x: src.x + 24,
          y: src.y + 24
        };
        if (src.type === 'image') {
          ensureImageProps(copy);
        }
        frame.children.push(copy);
        renderChildNode(copy, frame, frameEl);
        newSelections.push({ frameId: frame.id, childId: copy.id });
      });
      selectedChildNodes = newSelections;
      selectedTextNode = newSelections.length > 0 ? newSelections[0] : { frameId: null, childId: null };
      world.querySelectorAll('.canvas-text-node, .canvas-image-node').forEach(el => {
        const cId = Number(el.dataset.id);
        el.classList.toggle('is-selected', selectedChildNodes.some(n => n.childId === cId));
      });
      updateTextToolbar();
      save();
    }

    function deleteTextNode() {
      if (croppingImage) exitCropMode();
      if (selectedChildNodes.length === 0) return;
      selectedChildNodes.forEach(sel => {
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame) return;
        const elText = world.querySelector(`.canvas-text-node[data-id="${sel.childId}"]`);
        const elImg = world.querySelector(`.canvas-image-node[data-id="${sel.childId}"]`);
        if (elText) elText.remove();
        if (elImg) elImg.remove();
        frame.children = (frame.children || []).filter(c => c.id !== sel.childId);
      });
      selectTextNode(null, null);
      save();
    }

    function isPanoramicFrame(frame) {
      return !!(frame && frame.panoramic && frame.panoramic.slices > 1);
    }

    function panoramicSliceCount(frame) {
      return isPanoramicFrame(frame) ? frame.panoramic.slices : 1;
    }

    /* Numa faixa panorâmica o "post" é a fatia, não a faixa inteira. Centralizar
       e o ímã têm que mirar a fatia onde o elemento está — senão o texto do post
       5 voa para o meio da faixa, que é a emenda entre o post 2 e o 3. */
    function sliceBoundsFor(frame, centerX) {
      if (!isPanoramicFrame(frame)) {
        return { left: 0, width: frame.w, index: 0, total: 1 };
      }
      const total = frame.panoramic.slices;
      const width = frame.w / total;
      const index = Math.min(total - 1, Math.max(0, Math.floor((centerX || 0) / width)));
      return { left: index * width, width, index, total };
    }

    function frameFormatBadge(frame, fmt) {
      if (!isPanoramicFrame(frame)) return `${fmt.name} · ${frame.w} × ${frame.h}`;
      const n = frame.panoramic.slices;
      return `${fmt.name} · ${n} posts · ${frame.w} × ${frame.h}`;
    }

    /* As divisórias são o contrato visual da faixa: o que fica dentro de cada
       célula é exatamente o que sai naquele post. */
    function createPanoramicGuides(frame) {
      const slices = frame.panoramic.slices;
      const sliceW = frame.w / slices;
      const layer = document.createElement('div');
      layer.className = 'canvas-frame__pano-guides';
      for (let i = 0; i < slices; i++) {
        const cell = document.createElement('div');
        cell.className = 'canvas-frame__pano-cell';
        if (i === slices - 1) cell.classList.add('is-last');
        cell.style.left = `${i * sliceW}px`;
        cell.style.width = `${sliceW}px`;
        const tag = document.createElement('span');
        tag.className = 'canvas-frame__pano-tag';
        tag.textContent = `${i + 1}/${slices}`;
        cell.appendChild(tag);
        layer.appendChild(cell);
      }
      return layer;
    }

    function createSafeZoneElement(frame) {
      const container = document.createElement('div');
      container.className = 'canvas-frame__safezone';

      if (frame.format === 'story') {
        // 9:16 Story / TikTok / Reels (1080 x 1920)
        // Uma zona só para as duas redes = a interseção da pior UI de cada uma.
        // Rodapé: TikTok come 400–484px (legenda + disco de áudio + CTA), Reels
        // 320–400px. Direita: TikTok 140–180px de coluna de ações, Reels 90–120px.
        container.innerHTML = `
          <div class="canvas-safezone__danger canvas-safezone__danger--top" style="height: 200px;">
            <span class="canvas-safezone__badge">⚠️ Topo (Status, Abas & Busca · 200px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--bottom" style="height: 480px;">
            <span class="canvas-safezone__badge">⚠️ Rodapé (Legenda, Áudio & CTA · 480px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--left" style="top: 200px; bottom: 480px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">Margem (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--right" style="top: 200px; bottom: 480px; width: 180px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">⚠️ Ações (Like, Comentar, Salvar · 180px)</span>
          </div>
          <div class="canvas-safezone__box" style="top: 200px; bottom: 480px; left: 60px; right: 180px;">
            <span class="canvas-safezone__label">✅ Área Segura TikTok (840 × 1240)</span>
          </div>
        `;
      } else if (frame.format === 'reels') {
        // 9:16 Instagram Reels (1080 x 1920)
        // Rodapé menor que o do TikTok (320–400px) e coluna de ações mais
        // estreita (90–120px), porque a legenda do Reels ocupa menos linhas.
        container.innerHTML = `
          <div class="canvas-safezone__danger canvas-safezone__danger--top" style="height: 220px;">
            <span class="canvas-safezone__badge">⚠️ Topo (Status & "Reels" · 220px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--bottom" style="height: 400px;">
            <span class="canvas-safezone__badge">⚠️ Rodapé (Legenda, @perfil & Áudio · 400px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--left" style="top: 220px; bottom: 400px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">Margem (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--right" style="top: 220px; bottom: 400px; width: 120px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">⚠️ Ações (Curtir, Comentar · 120px)</span>
          </div>
          <div class="canvas-safezone__box" style="top: 220px; bottom: 400px; left: 60px; right: 120px;">
            <span class="canvas-safezone__label">✅ Área Segura Reels (900 × 1300)</span>
          </div>
        `;
      } else if (frame.format === 'ig-story') {
        // 9:16 Instagram Story (1080 x 1920)
        // Regra que a própria Meta repete: miolo de 1080 × 1420, ou seja 250px
        // presos em cima (barra de progresso, @perfil, fechar) e 250px embaixo
        // (campo de resposta, enviar e onde caem enquete/caixinha de pergunta).
        container.innerHTML = `
          <div class="canvas-safezone__danger canvas-safezone__danger--top" style="height: 250px;">
            <span class="canvas-safezone__badge">⚠️ Topo (Barra de Progresso & @perfil · 250px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--bottom" style="height: 250px;">
            <span class="canvas-safezone__badge">⚠️ Rodapé (Responder, Enviar & Stickers · 250px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--left" style="top: 250px; bottom: 250px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">Margem (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--right" style="top: 250px; bottom: 250px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">Margem (60px)</span>
          </div>
          <div class="canvas-safezone__box" style="top: 250px; bottom: 250px; left: 60px; right: 60px;">
            <span class="canvas-safezone__label">✅ Área Segura Story (960 × 1420)</span>
          </div>
        `;
      } else if (frame.format === 'yt-thumb') {
        // 16:9 Thumbnail do YouTube (1280 x 720)
        // Miolo que sobrevive a todas as vitrines: 1100 × 620 — o app corta as
        // laterais no feed. O carimbo de duração é cravado pelo YouTube no canto
        // inferior direito e entra por cima até da área segura.
        container.innerHTML = `
          <div class="canvas-safezone__danger canvas-safezone__danger--top" style="height: 50px;">
            <span class="canvas-safezone__badge">⚠️ Margem Superior (50px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--bottom" style="height: 50px;">
            <span class="canvas-safezone__badge">⚠️ Rodapé (Barra de Progresso · 50px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--left" style="top: 50px; bottom: 50px; width: 90px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">✂️ Corte no feed (90px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--right" style="top: 50px; bottom: 50px; width: 90px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">✂️ Corte no feed (90px)</span>
          </div>
          <div class="canvas-safezone__box" style="top: 50px; bottom: 50px; left: 90px; right: 90px;">
            <span class="canvas-safezone__label">✅ Área Segura YouTube (1100 × 620)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--corner" style="right: 0; bottom: 0; width: 220px; height: 80px;">
            <span class="canvas-safezone__badge">⏱ Duração</span>
          </div>
        `;
      } else if (frame.format === 'ig-feed') {
        // 4:5 Instagram Feed (1080 x 1350)
        // Desde jan/2025 a grade do perfil é 3:4 (~1013 × 1350), não mais 1:1:
        // o post 4:5 aparece inteiro em altura e perde ~34px de cada lateral.
        // Como 34 < 60, respeitar a margem de respiro já cobre o corte da grade.
        container.innerHTML = `
          <div class="canvas-safezone__danger canvas-safezone__danger--top" style="height: 60px;">
            <span class="canvas-safezone__badge">⚠️ Margem Superior (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--bottom" style="height: 60px;">
            <span class="canvas-safezone__badge">⚠️ Margem Inferior (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--left" style="top: 60px; bottom: 60px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">✂️ Grade 3:4 corta 34px · margem 60px</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--right" style="top: 60px; bottom: 60px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">✂️ Grade 3:4 corta 34px · margem 60px</span>
          </div>
          <div class="canvas-safezone__box" style="top: 60px; bottom: 60px; left: 60px; right: 60px;">
            <span class="canvas-safezone__label">📸 Feed & Grade 3:4 Seguros (960 × 1230)</span>
          </div>
        `;
      } else if (frame.format === 'pinterest') {
        // 2:3 Pinterest (1000 x 1500)
        // A UI do Pinterest (avatar, título, botão Salvar) come ~15% em cima e
        // embaixo = 225px de cada lado num pin de 1500px de altura.
        container.innerHTML = `
          <div class="canvas-safezone__danger canvas-safezone__danger--top" style="height: 225px;">
            <span class="canvas-safezone__badge">⚠️ Topo (Avatar & Navegação · 225px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--bottom" style="height: 225px;">
            <span class="canvas-safezone__badge">⚠️ Rodapé (Botão Salvar & Título do Site · 225px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--left" style="top: 225px; bottom: 225px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">Margem (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--right" style="top: 225px; bottom: 225px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">Margem (60px)</span>
          </div>
          <div class="canvas-safezone__box" style="top: 225px; bottom: 225px; left: 60px; right: 60px;">
            <span class="canvas-safezone__label">📌 Área Segura Pinterest (880 × 1050)</span>
          </div>
        `;
      } else {
        // 1:1 Square (1080 x 1080)
        container.innerHTML = `
          <div class="canvas-safezone__danger canvas-safezone__danger--top" style="height: 60px;">
            <span class="canvas-safezone__badge">⚠️ Margem Superior (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--bottom" style="height: 60px;">
            <span class="canvas-safezone__badge">⚠️ Margem Inferior (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--left" style="top: 60px; bottom: 60px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">Margem (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--right" style="top: 60px; bottom: 60px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">Margem (60px)</span>
          </div>
          <div class="canvas-safezone__box" style="top: 60px; bottom: 60px; left: 60px; right: 60px;">
            <span class="canvas-safezone__label">✅ Área Segura Quadrada (960 × 960)</span>
          </div>
        `;
      }
      return container;
    }

    /* Desfoque de fundo assado no bitmap: `filter: blur()` numa foto grande é
       recalculado a cada zoom (era isso que fazia a tela quebrar e piscar).
       Aqui o desfoque é aplicado uma vez num canvas menor e vira imagem comum,
       então o zoom não custa mais nada. O export continua usando o original. */
    const blurredBgCache = new Map();
    let bgBakeSeq = 0;

    function makeBlurredBg(src, blurPx, frameW, frameH) {
      const key = `${blurPx}|${frameW}x${frameH}|${src.length}|${src.slice(-48)}`;
      if (blurredBgCache.has(key)) return Promise.resolve(blurredBgCache.get(key));
      return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const natW = img.naturalWidth || img.width;
            const natH = img.naturalHeight || img.height;
            if (!natW || !natH) return resolve(null);
            const MAX_W = 1600;
            const k = Math.min(1, MAX_W / natW);
            const outW = Math.max(1, Math.round(natW * k));
            const outH = Math.max(1, Math.round(natH * k));
            /* O raio é medido no tamanho em que a foto aparece no post (cover),
               então volta para a escala do bitmap antes de ser aplicado. */
            const disp = Math.max(frameW / natW, frameH / natH) || 1;
            const radius = Math.max(0.5, (blurPx / disp) * k);
            const canvas = document.createElement('canvas');
            canvas.width = outW;
            canvas.height = outH;
            const ctx = canvas.getContext('2d');
            ctx.filter = `blur(${radius}px)`;
            ctx.drawImage(img, 0, 0, outW, outH);
            const url = canvas.toDataURL('image/jpeg', 0.82);
            blurredBgCache.set(key, url);
            resolve(url);
          } catch (e) {
            // Foto de outro domínio suja o canvas: segue com o filtro em CSS
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = src;
      });
    }

    function applyFrameBackground(frame, frameEl) {
      const el = frameEl || frameElOf(frame);
      if (!el) return;

      let bgContainer = el.querySelector('.canvas-frame__bg-container');
      if (!bgContainer) {
        bgContainer = document.createElement('div');
        bgContainer.className = 'canvas-frame__bg-container';
        // Fundo mora dentro da máscara (se existir) pro clip valer também pra ele
        const contentMask = el.querySelector('.canvas-frame__content');
        if (contentMask) contentMask.prepend(bgContainer);
        else el.prepend(bgContainer);
      }

      let bgLayer = bgContainer.querySelector('.canvas-frame__bg-layer');
      if (!bgLayer) {
        bgLayer = document.createElement('div');
        bgLayer.className = 'canvas-frame__bg-layer';
        bgContainer.appendChild(bgLayer);
      }

      let overlayEl = bgContainer.querySelector('.canvas-frame__bg-overlay');
      if (!overlayEl) {
        overlayEl = document.createElement('div');
        overlayEl.className = 'canvas-frame__bg-overlay';
        bgContainer.appendChild(overlayEl);
      }

      // Remove elementos antigos soltos fora do bgContainer (se existirem)
      const legacyBg = el.querySelector(':scope > .canvas-frame__bg-layer');
      if (legacyBg) legacyBg.remove();
      const legacyOverlay = el.querySelector(':scope > .canvas-frame__bg-overlay');
      if (legacyOverlay) legacyOverlay.remove();

      // 1. Imagem de fundo com overlay & blur
      if (hasFrameBg(frame)) {
        const defaultOverlay = frame.bgRecipe ? 0 : 35;
        const overlayAlpha = (frame.bgOverlay != null ? frame.bgOverlay : defaultOverlay) / 100;
        const blurPx = frame.bgBlur || 0;
        const bgSrc = frameBgSrc(frame);
        const posX = frame.bgPosX != null ? frame.bgPosX : 50;
        const posY = frame.bgPosY != null ? frame.bgPosY : 50;
        const zoom = (frame.bgZoom || 100) / 100;
        const minDim = Math.min(frame.w || 1080, frame.h || 1350);
        const blurScale = blurPx > 0 ? (1 + (blurPx * 2.2) / minDim) : 1.0;
        const totalScale = blurScale * zoom;

        /* Asset ainda não veio do IndexedDB (reload): pinta a camada que já
           existe quando chegar — recriar o frame aqui duplicaria o elemento. */
        /* Mostra na hora com o filtro em CSS e, quando a versão já desfocada
           fica pronta, troca por ela e desliga o filtro. */
        const bakeInto = (layerRef, src) => {
          if (!src || blurPx <= 0) return;
          const stamp = String(++bgBakeSeq);
          layerRef.dataset.bakeStamp = stamp;
          makeBlurredBg(src, blurPx, frame.w || 1080, frame.h || 1350).then(url => {
            if (!url || layerRef.dataset.bakeStamp !== stamp) return;
            layerRef.style.backgroundImage = `url("${url}")`;
            layerRef.style.filter = 'none';
          });
        };

        if (!bgSrc && frame.bgAssetId) {
          const layerRef = bgLayer;
          getAsset(frame.bgAssetId).then(src => {
            if (!src) return;
            layerRef.style.backgroundImage = `url("${src}")`;
            bakeInto(layerRef, src);
          });
        }

        bgLayer.style.backgroundImage = bgSrc ? `url("${bgSrc}")` : 'none';
        bgLayer.style.backgroundSize = 'cover';
        bgLayer.style.backgroundRepeat = 'no-repeat';
        bgLayer.style.backgroundPosition = `${posX}% ${posY}%`;
        bgLayer.style.transformOrigin = `${posX}% ${posY}%`;
        bgLayer.style.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
        bgLayer.style.transform = totalScale !== 1 ? `scale(${totalScale})` : 'none';

        bakeInto(bgLayer, bgSrc);
        bgLayer.style.backgroundColor = frame.bg || 'transparent';

        if (overlayAlpha > 0) {
          overlayEl.style.backgroundColor = `rgba(0, 0, 0, ${overlayAlpha})`;
          overlayEl.style.display = 'block';
        } else {
          overlayEl.style.display = 'none';
        }
      } else {
        // 2. Cor sólida ou gradiente
        bgLayer.style.backgroundImage = (frame.bg && frame.bg.includes('gradient')) ? frame.bg : 'none';
        bgLayer.style.backgroundColor = (frame.bg && !frame.bg.includes('gradient')) ? frame.bg : (frame.bg || '#FFFFFF');
        bgLayer.style.filter = 'none';
        bgLayer.style.transform = 'none';
        overlayEl.style.display = 'none';
      }
    }

    function formatFrameDisplayName(frame, posMap) {
      if (frame && frame.name && frame.name.trim() !== '') {
        return frame.name;
      }
      const p = posMap ? posMap.get(frame.id) : null;
      if (p) {
        return p.total > 1 ? `Post ${p.post} · Slide ${p.page}` : `Post ${p.post}`;
      }
      const idx = frames.indexOf(frame);
      return `Post ${idx !== -1 ? idx + 1 : frame.id}`;
    }

    function startRenameFrame(frame) {
      if (!frame) return;
      const frameEl = frameElOf(frame);
      if (!frameEl) return;
      const labelEl = frameEl.querySelector('.canvas-frame__label');
      if (!labelEl) return;

      const currentName = frame.name || formatFrameDisplayName(frame);
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'canvas-frame__name-input';
      input.value = currentName;
      input.placeholder = 'Nome do post';

      const nameBadge = labelEl.querySelector('.canvas-frame__name-badge');
      if (nameBadge) {
        nameBadge.replaceWith(input);
      } else {
        labelEl.innerHTML = '';
        labelEl.appendChild(input);
      }

      let finished = false;
      function finishRename() {
        if (finished) return;
        finished = true;
        const val = input.value.trim();
        if (val) {
          frame.name = val;
          toast.success(`Post renomeado para "${val}"`);
        }
        updateFrameMeta();
        save();
        updateTextToolbar();
        updateTopbar();
      }

      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finishRename();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finished = true;
          updateFrameMeta();
        }
      });

      input.addEventListener('mousedown', (e) => e.stopPropagation());
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('dblclick', (e) => e.stopPropagation());
      input.addEventListener('blur', finishRename);

      setTimeout(() => {
        input.focus();
        input.select();
      }, 50);
    }

    function updateFrameLabels() {
      updateFrameMeta();
    }

    function renderFrame(frame) {
      const fmt = FORMATS[frame.format] || FORMATS['ig-feed'];
      const el = document.createElement('div');
      el.className = 'canvas-frame';
      el.dataset.id = frame.id;
      el.style.left = `${frame.x}px`;
      el.style.top = `${frame.y}px`;
      el.style.width = `${frame.w}px`;
      el.style.height = `${frame.h}px`;
      // Marca desde o nascimento quem é maior que o tile de GPU: essas camadas
      // internas nunca são promovidas (a promoção é o flicker do panorâmico)
      if (frame.w > 4000 || frame.h > 4000) el.classList.add('is-dragging-huge');

      // Máscara de conteúdo: tudo que é post (fundo + filhos) mora aqui dentro
      const contentMask = document.createElement('div');
      contentMask.className = 'canvas-frame__content';
      el.appendChild(contentMask);

      applyFrameBackground(frame, el);

      const label = document.createElement('div');
      label.className = 'canvas-frame__label';
      const displayName = formatFrameDisplayName(frame);
      label.innerHTML = `
        <span class="canvas-frame__name-badge" title="Clique duas vezes para renomear">${escapeHtml(displayName)}</span>
        <span class="canvas-frame__format-badge">${frameFormatBadge(frame, fmt)}</span>
      `;
      const nameBadge = label.querySelector('.canvas-frame__name-badge');
      if (nameBadge) {
        nameBadge.addEventListener('mousedown', (e) => e.stopPropagation());
        nameBadge.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          e.preventDefault();
          startRenameFrame(frame);
        });
        nameBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          selectFrame(frame.id);
        });
      }
      label.addEventListener('mousedown', (e) => e.stopPropagation());
      label.addEventListener('dblclick', (e) => {
        if (e.target.closest('.canvas-frame__name-input')) return;
        e.stopPropagation();
        e.preventDefault();
        startRenameFrame(frame);
      });
      el.appendChild(label);

      // Linhas-guia magnéticas de alinhamento ao centro
      const snapGuideV = document.createElement('div');
      snapGuideV.className = 'canvas-frame__snap-guide canvas-frame__snap-guide--v';
      el.appendChild(snapGuideV);

      const snapGuideH = document.createElement('div');
      snapGuideH.className = 'canvas-frame__snap-guide canvas-frame__snap-guide--h';
      el.appendChild(snapGuideH);

      // Overlay de Safe Zone específico do formato
      /* Na faixa panorâmica cada fatia é um post de verdade, então o visor de
         área segura da rede aparece repetido, um por fatia. */
      if (isPanoramicFrame(frame)) {
        const slices = frame.panoramic.slices;
        const sliceW = frame.w / slices;
        for (let i = 0; i < slices; i++) {
          const safeZone = createSafeZoneElement(frame);
          safeZone.style.left = `${i * sliceW}px`;
          safeZone.style.right = 'auto';
          safeZone.style.width = `${sliceW}px`;
          el.appendChild(safeZone);
        }
        // Mostra onde a exportação vai cortar cada post
        el.appendChild(createPanoramicGuides(frame));
      } else {
        el.appendChild(createSafeZoneElement(frame));
      }
      
      // Renderiza textos e imagens guardados
      if (frame.children) {
        frame.children.forEach(child => renderChildNode(child, frame, el));
      }

      const pOut = document.createElement('div');
      pOut.className = 'canvas-frame__port canvas-frame__port--out';
      pOut.title = 'Arraste até outro frame para ligar no mesmo post';
      pOut.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        startLinkDrag(frame, e);
      });
      el.appendChild(pOut);

      const pIn = document.createElement('div');
      pIn.className = 'canvas-frame__port canvas-frame__port--in';
      el.appendChild(pIn);

      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.canvas-frame__label')) return;
        if (repositioningFrameId === frame.id) {
          e.stopPropagation();
          startFrameBgPan(e, frame, el);
          return;
        }

        if (e.target.closest('.canvas-text-node, .canvas-image-node')) return;
        if (e.target.closest('.canvas-frame__port')) return;

        e.stopPropagation();
        e.preventDefault();
        startFrameDrag(e, frame);
      });
      
      // Duplo clique: se tiver imagem de fundo, entra no modo de ajuste de foto; senão cria nó de texto
      el.addEventListener('dblclick', (e) => {
        if (e.target.closest('.canvas-frame__label')) return;
        if (e.target.closest('.canvas-text-node, .canvas-image-node')) return;
        if (hasFrameBg(frame)) {
          e.stopPropagation();
          enterFrameBgRepositionMode(frame.id);
          return;
        }
        const rect = el.getBoundingClientRect();
        // Converte do screen point para a posição dentro do frame
        addTextNode(frame, (e.clientX - rect.left) / cam.scale, (e.clientY - rect.top) / cam.scale - 24);
      });

      // Scroll/Wheel no frame enquanto em modo de reposicionamento faz zoom da imagem de fundo
      el.addEventListener('wheel', (e) => {
        if (repositioningFrameId !== frame.id) return;
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY < 0 ? 5 : -5;
        const currentZoom = frame.bgZoom || 100;
        frame.bgZoom = Math.max(100, Math.min(300, currentZoom + delta));
        applyFrameBackground(frame, el);
        updateBgRepositionToolbar();
        saveQuiet();
      }, { passive: false });

      world.appendChild(el);
      return el;
    }

    function selectFrame(id, isMulti = false) {
      if (id !== null) {
        selectTextNode(null, null);
      }
      if (id !== null && selectedLinkId !== null) {
        selectedLinkId = null;
        if (linksRoot) {
          linksRoot.querySelectorAll('.canvas-link.is-selected')
            .forEach(g => g.classList.remove('is-selected'));
        }
      }

      if (id === null) {
        selectedFrameIds.clear();
        selectedId = null;
      } else if (isMulti) {
        if (selectedFrameIds.has(id)) {
          selectedFrameIds.delete(id);
        } else {
          selectedFrameIds.add(id);
        }
        selectedId = selectedFrameIds.size > 0 ? [...selectedFrameIds][0] : null;
      } else {
        selectedFrameIds = new Set([id]);
        selectedId = id;
      }

      world.querySelectorAll('.canvas-frame').forEach((el) => {
        const fId = Number(el.dataset.id);
        el.classList.toggle('is-selected', selectedFrameIds.has(fId));
      });
      if (id !== null && document.activeElement && document.activeElement !== document.body && !document.activeElement.isContentEditable && !document.activeElement.classList.contains('canvas-frame__name-input')) {
        document.activeElement.blur();
      }
      updateTopbar();
      updateTextToolbar();
      if (isMeasureKeyActive) updateMeasureGuides(lastMouseClientPos);
    }

    function updateTopbar() {
      const selectedFrames = getSelectedFrames();
      const hasFrames = selectedFrames.length > 0;
      const firstFrame = selectedFrames[0];
      if (btnAddText) btnAddText.disabled = !hasFrames;
      if (btnAddImage) btnAddImage.disabled = !hasFrames;
      if (btnDupFrame) btnDupFrame.disabled = !hasFrames;
      // Delete serve para os dois: frame selecionado ou corda selecionada
      if (btnDelFrame) btnDelFrame.disabled = !hasFrames && selectedLinkId === null;
      /* Ligar em carrossel: dois ou mais, e todos da mesma rede. Quando os
         formatos não batem o botão explica no tooltip por que está apagado. */
      if (btnLinkFrames) {
        const enough = selectedFrames.length >= 2;
        const sameFormat = enough && selectedFrames.every(f => f.format === firstFrame.format);
        btnLinkFrames.disabled = !sameFormat;
        btnLinkFrames.title = enough && !sameFormat
          ? 'Formatos diferentes não formam um carrossel'
          : 'Ligar em carrossel (selecione 2+ frames do mesmo formato)';
      }

      /* Atualiza badge de variáveis no menu de lote */
      const badgeBinds = document.getElementById('canvas-batch-binds-count');
      if (badgeBinds) {
        let totalBinds = 0;
        frames.forEach(f => {
          (f.children || []).forEach(c => {
            if (c.bind) totalBinds++;
          });
        });
        badgeBinds.style.display = totalBinds > 0 ? 'inline-flex' : 'none';
        badgeBinds.textContent = totalBinds;
      }

      // Labels do menu de lote
      const bindsMenuLabel = document.getElementById('canvas-menu-binds-label');
      if (bindsMenuLabel) {
        const areHidden = world.classList.contains('hide-binds');
        bindsMenuLabel.textContent = 'Tags de Variáveis {{}}';
      }

      // Estado dos botões de Preferência no HUD
      const hudSnap = document.getElementById('canvas-hud-snap');
      if (hudSnap) {
        hudSnap.classList.toggle('is-active', snapEnabled);
        hudSnap.title = `Snap Magnético: ${snapEnabled ? 'Ligado' : 'Desligado'}`;
      }
      const hudGuides = document.getElementById('canvas-hud-guides');
      if (hudGuides) {
        hudGuides.classList.toggle('is-active', showGuides);
        hudGuides.title = `Safe Zones das Redes: ${showGuides ? 'Ligado' : 'Desligado'}`;
      }
      const hudBinds = document.getElementById('canvas-hud-binds');
      if (hudBinds) {
        hudBinds.classList.toggle('is-active', showBinds);
        hudBinds.title = `Visor de Variáveis CSV {{}}: ${showBinds ? 'Ligado' : 'Desligado'} (Atalho: B ou ⌥V)`;
      }

      // Habilita/desabilita menus e ações
      if (btnBatch) btnBatch.disabled = frames.length === 0;
      if (btnInsertMenu) btnInsertMenu.disabled = false;
      const exportBtn = document.getElementById('canvas-export-btn');
      if (exportBtn) exportBtn.disabled = frames.length === 0;
      const libBtn = document.getElementById('canvas-library-btn');
      if (libBtn) libBtn.disabled = frames.length === 0;

      if (!topLabel) return;

      if (selectedLinkId !== null) {
        topLabel.textContent = 'Ligação selecionada';
      } else if (selectedFrames.length === 1) {
        topLabel.textContent = `${FORMATS[firstFrame.format].name} · ${firstFrame.w} × ${firstFrame.h}`;
      } else if (selectedFrames.length > 1) {
        topLabel.textContent = `${selectedFrames.length} posts selecionados`;
      } else {
        const posts = computePosts().length;
        if (!frames.length) topLabel.textContent = 'Nenhum frame';
        else topLabel.textContent = `${frames.length} ${frames.length === 1 ? 'post' : 'posts'}`;
      }
    }

    // Enquadra o frame respeitando a barra de cima e a dock de baixo
    function zoomToFrame(frame) {
      const padX = 80;
      const padTop = 110;
      const padBottom = 140;
      const availW = innerWidth - padX * 2;
      const availH = innerHeight - padTop - padBottom;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(availW / frame.w, availH / frame.h)));
      cam.scale = scale;
      cam.x = padX + (availW - frame.w * scale) / 2 - frame.x * scale;
      cam.y = padTop + (availH - frame.h * scale) / 2 - frame.y * scale;
      applyCamera();
    }

    function zoomToFitFrames(targetFrames) {
      if (!targetFrames || targetFrames.length === 0) return;
      const padX = 100;
      const padTop = 130;
      const padBottom = 160;
      const availW = innerWidth - padX * 2;
      const availH = innerHeight - padTop - padBottom;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      targetFrames.forEach(f => {
        minX = Math.min(minX, f.x);
        minY = Math.min(minY, f.y);
        maxX = Math.max(maxX, f.x + f.w);
        maxY = Math.max(maxY, f.y + f.h);
      });

      const totalW = maxX - minX;
      const totalH = maxY - minY;

      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(availW / totalW, availH / totalH)));
      cam.scale = scale;
      cam.x = padX + (availW - totalW * scale) / 2 - minX * scale;
      cam.y = padTop + (availH - totalH * scale) / 2 - minY * scale;
      applyCamera();
    }

    /* Panorâmico é UM post largo, não vários colados: a pessoa desenha numa
       faixa de (largura do formato × nº de posts) e a exportação corta a faixa
       nas fatias do tamanho exato da rede. Nada atravessa nada. */
    function createPanoramicCarousel(count = 5, formatKey = 'ig-feed') {
      const key = (formatKey && FORMATS[formatKey]) ? formatKey : 'ig-feed';
      const fmt = FORMATS[key];
      const slices = Math.max(2, Math.min(10, count));
      const totalW = fmt.w * slices;

      let x, y;
      if (frames.length) {
        const last = frames[frames.length - 1];
        x = last.x + last.w + FRAME_GAP;
        y = last.y;
      } else {
        const center = screenToWorld(innerWidth / 2, innerHeight / 2);
        x = Math.round(center.x - totalW / 2);
        y = Math.round(center.y - fmt.h / 2);
      }

      const frame = {
        id: frameSeq++,
        name: `Panorâmico ${slices} posts`,
        format: key,
        x,
        y,
        w: totalW,
        h: fmt.h,
        bg: '#FFFFFF',
        panoramic: { slices },
        children: [
          {
            id: childSeq++,
            type: 'text',
            text: 'SEU TÍTULO AQUI',
            x: 80,
            y: 140,
            w: Math.min(900, fmt.w - 160),
            fontSize: 68,
            fontFamily: 'Inter',
            fontWeight: 800,
            fill: '#18181B',
            align: 'left',
            lineHeight: 1.15,
            letterSpacing: -0.02
          }
        ]
      };

      frames.push(frame);
      renderFrame(frame);
      selectFrame(frame.id);
      updateFrameMeta();
      updateFrameLabels();
      save();

      zoomToFitFrames([frame]);
      toast.success(`Faixa panorâmica criada: ${slices} posts de ${fmt.w} × ${fmt.h}`);
    }

    function addFrame(formatKey = 'ig-feed') {
      const key = (formatKey && FORMATS[formatKey]) ? formatKey : 'ig-feed';
      const fmt = FORMATS[key];
      let x, y;
      if (frames.length) {
        // Novo frame entra à direita do último: a fila natural de um carrossel
        const last = frames[frames.length - 1];
        x = last.x + last.w + FRAME_GAP;
        y = last.y;
      } else {
        const center = screenToWorld(innerWidth / 2, innerHeight / 2);
        x = Math.round(center.x - fmt.w / 2);
        y = Math.round(center.y - fmt.h / 2);
      }
      const frame = makeFrame(key, x, y);
      frames.push(frame);
      renderFrame(frame);
      selectFrame(frame.id);
      updateFrameMeta();
      zoomToFrame(frame);
      save();
      toast.success(`Post (${fmt.name}) criado`);
    }

    function duplicateFrame(id) {
      const framesToDup = selectedFrameIds.size > 0 ? getSelectedFrames() : [frames.find(f => f.id === id)].filter(Boolean);
      if (framesToDup.length === 0) return;
      const newFrameIds = new Set();
      framesToDup.forEach(src => {
        const copyName = src.name ? `${src.name} (Cópia)` : `Post ${frames.length + 1}`;
        const copy = {
          ...src,
          id: frameSeq++,
          name: copyName,
          x: src.x + src.w + FRAME_GAP,
          y: src.y,
          children: (src.children || []).map(c => {
            const chCopy = { ...c, id: childSeq++ };
            if (c.type === 'image') ensureImageProps(chCopy);
            return chCopy;
          })
        };
        frames.push(copy);
        renderFrame(copy);
        newFrameIds.add(copy.id);
      });
      selectedFrameIds = newFrameIds;
      selectedId = [...newFrameIds][0];
      world.querySelectorAll('.canvas-frame').forEach((el) => {
        const fId = Number(el.dataset.id);
        el.classList.toggle('is-selected', selectedFrameIds.has(fId));
      });
      updateTopbar();
      updateFrameMeta();
      updateFrameLabels();
      save();
    }

    function deleteFrame(id) {
      const framesToDelete = selectedFrameIds.size > 0 ? getSelectedFrameIds() : (id !== null ? [id] : []);
      if (framesToDelete.length === 0) return;
      framesToDelete.forEach(fId => {
        const frameEl = world.querySelector(`.canvas-frame[data-id="${fId}"]`);
        if (frameEl) frameEl.remove();
        links = links.filter(l => l.from !== fId && l.to !== fId);
      });
      frames = frames.filter(f => !framesToDelete.includes(f.id));
      selectFrame(null);
      renderLinks();
      updateFrameLabels();
      updateFrameMeta();
      save();
    }

    /* --------------------------------------------------
       Ligações entre frames (a "cordinha" do carrossel)
       Um link é só { from, to }. O post é a cadeia que sai daí:
       quem não recebe ligação é a capa, e segue-se a corrente.
       -------------------------------------------------- */
    const SVG_NS = 'http://www.w3.org/2000/svg';

    // Saída à direita, entrada à esquerda, ambas na metade da altura
    function portOut(frame) { return { x: frame.x + frame.w, y: frame.y + frame.h / 2 }; }
    function portIn(frame) { return { x: frame.x, y: frame.y + frame.h / 2 }; }

    /* Corda em repouso, no estilo do VCV Rack: o ponto de controle é a média das
       pontas puxada para baixo em proporção à distância. Barata e imediata,
       então é a que segue o mouse enquanto a ligação está sendo puxada. */
    const CABLE_TENSION = 0.35;

    function linkPath(x1, y1, x2, y2) {
      const dist = Math.hypot(x2 - x1, y2 - y1);
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2 + (1 - CABLE_TENSION) * (240 + dist * 0.55);
      return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
    }

    /* --------------------------------------------------
       Motor de corda (Verlet)
       A corda é uma fileira de pontos com gravidade, presos por restrições de
       distância. Método do "Advanced Character Physics" (Jakobsen): integra,
       depois relaxa as distâncias algumas vezes por quadro. É o que dá o
       balanço quando você arrasta o frame e a corda assenta sozinha.
       -------------------------------------------------- */
    const ROPE_POINTS = 22;
    const ROPE_GRAVITY = 3200;
    const ROPE_DAMPING = 0.965;
    const ROPE_RELAX = 12;
    const ROPE_SLACK = 1.16;   // cabo 16% mais longo que a distância: é a folga que faz pender

    const ropes = new Map();
    let ropesRunning = false;
    let ropeIdleFrames = 0;
    let lastRopeTime = 0;

    function makeRope(a, b) {
      const p1 = portOut(a);
      const p2 = portIn(b);
      const pts = [];
      for (let i = 0; i < ROPE_POINTS; i++) {
        const t = i / (ROPE_POINTS - 1);
        const x = p1.x + (p2.x - p1.x) * t;
        const y = p1.y + (p2.y - p1.y) * t;
        pts.push({ x, y, px: x, py: y });
      }
      const dist = Math.max(Math.hypot(p2.x - p1.x, p2.y - p1.y), 260);
      return { pts, segLen: (dist * ROPE_SLACK) / (ROPE_POINTS - 1) };
    }

    function stepRope(rope, a, b, dt) {
      const p1 = portOut(a);
      const p2 = portIn(b);
      const pts = rope.pts;
      const last = pts.length - 1;
      const g = ROPE_GRAVITY * dt * dt;

      // Integração: a velocidade está implícita na diferença para a posição anterior
      for (let i = 1; i < last; i++) {
        const p = pts[i];
        const vx = (p.x - p.px) * ROPE_DAMPING;
        const vy = (p.y - p.py) * ROPE_DAMPING;
        p.px = p.x;
        p.py = p.y;
        p.x += vx;
        p.y += vy + g;
      }

      // Relaxamento: as pontas ficam presas nas portas e o meio se acomoda
      for (let k = 0; k < ROPE_RELAX; k++) {
        pts[0].x = p1.x; pts[0].y = p1.y;
        pts[last].x = p2.x; pts[last].y = p2.y;
        for (let i = 0; i < last; i++) {
          const A = pts[i];
          const B = pts[i + 1];
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const d = Math.hypot(dx, dy) || 0.0001;
          const shift = ((d - rope.segLen) / d) * 0.5;
          const ox = dx * shift;
          const oy = dy * shift;
          if (i > 0) { A.x += ox; A.y += oy; }
          if (i + 1 < last) { B.x -= ox; B.y -= oy; }
        }
      }
    }

    // Liga os pontos por quadráticas nos pontos médios: sai uma curva lisa
    function ropePath(pts) {
      let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        d += ` Q ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
      }
      const end = pts[pts.length - 1];
      return `${d} L ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
    }

    function ropeTick(now) {
      if (!ropesRunning) return;
      const dt = Math.min(0.032, (now - lastRopeTime) / 1000) || 0.016;
      lastRopeTime = now;

      const byId = new Map(frames.map(f => [f.id, f]));
      let energy = 0;

      links.forEach((link) => {
        const a = byId.get(link.from);
        const b = byId.get(link.to);
        if (!a || !b) return;

        let rope = ropes.get(link.id);
        if (!rope) {
          rope = makeRope(a, b);
          ropes.set(link.id, rope);
        }
        stepRope(rope, a, b, dt);
        rope.pts.forEach(p => { energy += Math.abs(p.x - p.px) + Math.abs(p.y - p.py); });

        const g = linksRoot && linksRoot.querySelector(`.canvas-link[data-id="${link.id}"]`);
        if (g) {
          // Só o traço e a faixa de clique: o "×" tem path próprio e não pode ser tocado
          const d = ropePath(rope.pts);
          g.querySelector('.canvas-link__line').setAttribute('d', d);
          g.querySelector('.canvas-link__hit').setAttribute('d', d);
          const cut = g.querySelector('.canvas-link__cut');
          const mid = rope.pts[Math.floor(rope.pts.length / 2)];
          if (cut) cut.setAttribute('transform', `translate(${mid.x.toFixed(1)}, ${mid.y.toFixed(1)})`);
        }
      });

      // Corda parada dorme: sem isso o requestAnimationFrame giraria à toa
      ropeIdleFrames = energy < 1.5 ? ropeIdleFrames + 1 : 0;
      if (ropeIdleFrames > 18) {
        ropesRunning = false;
        return;
      }
      requestAnimationFrame(ropeTick);
    }

    function wakeRopes() {
      ropeIdleFrames = 0;
      if (ropesRunning) return;
      ropesRunning = true;
      lastRopeTime = performance.now();
      requestAnimationFrame(ropeTick);
    }

    /* O SVG precisa de uma caixa grande de verdade: o que transborda dele é
       desenhado, mas não recebe clique. Então damos área e deslocamos a origem
       para dentro, mantendo as coordenadas do mundo intactas. */
    const LINK_ORIGIN = 50000;

    function ensureLinksLayer() {
      linksLayer = document.createElementNS(SVG_NS, 'svg');
      linksLayer.setAttribute('class', 'canvas-links');
      linksRoot = document.createElementNS(SVG_NS, 'g');
      linksRoot.setAttribute('transform', `translate(${LINK_ORIGIN}, ${LINK_ORIGIN})`);
      linksLayer.appendChild(linksRoot);
      world.appendChild(linksLayer);
    }

    /* Cadeias de frames ligados. Índice 0 é a capa do post. */
    function computePosts() {
      const byId = new Map(frames.map(f => [f.id, f]));
      const next = new Map();
      const hasIncoming = new Set();
      links.forEach((l) => {
        if (!byId.has(l.from) || !byId.has(l.to)) return;
        next.set(l.from, l.to);
        hasIncoming.add(l.to);
      });

      const visited = new Set();
      const posts = [];
      frames.forEach((f) => {
        if (hasIncoming.has(f.id) || visited.has(f.id)) return;
        const chain = [];
        let cur = f.id;
        // O guard do visited também protege de um ciclo acidental
        while (cur !== undefined && !visited.has(cur)) {
          visited.add(cur);
          chain.push(cur);
          cur = next.get(cur);
        }
        // Frame solto também é um post — só que de imagem única
        posts.push(chain);
      });
      return posts;
    }

    // Escreve no rótulo de cada frame a que post e a que página ele pertence
    function updateFrameMeta() {
      const pos = new Map();
      computePosts().forEach((chain, i) => {
        chain.forEach((id, idx) => pos.set(id, { post: i + 1, page: idx + 1, total: chain.length }));
      });

      frames.forEach((frame) => {
        const el = world.querySelector(`.canvas-frame[data-id="${frame.id}"]`);
        if (!el) return;
        const label = el.querySelector('.canvas-frame__label');
        if (!label) return;

        // Se estiver com o input de renomeação ativo, não destrói o input
        if (label.querySelector('.canvas-frame__name-input')) return;

        const fmt = FORMATS[frame.format] || FORMATS['ig-feed'];
        const p = pos.get(frame.id);
        const displayName = formatFrameDisplayName(frame, pos);
        const pagination = (p && p.total > 1 && !displayName.includes(String(p.page))) ? ` · ${p.page}/${p.total}` : '';
        const bindTag = frame.bgBind
          ? ` <span class="canvas-frame__bind-tag" style="background: #7C3AED; color: #FFFFFF; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; vertical-align: middle;">{{${frame.bgBind}}}</span>`
          : '';

        label.innerHTML = `
          <span class="canvas-frame__name-badge" title="Clique duas vezes para renomear">${escapeHtml(displayName)}${pagination}</span>
          ${bindTag}
          <span class="canvas-frame__format-badge">${frameFormatBadge(frame, fmt)}</span>
        `;

        const nameBadge = label.querySelector('.canvas-frame__name-badge');
        if (nameBadge) {
          nameBadge.addEventListener('mousedown', (e) => e.stopPropagation());
          nameBadge.addEventListener('click', (e) => {
            e.stopPropagation();
            selectFrame(frame.id);
          });
          nameBadge.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            e.preventDefault();
            startRenameFrame(frame);
          });
        }

        label.addEventListener('mousedown', (e) => e.stopPropagation());
        label.addEventListener('dblclick', (e) => {
          if (e.target.closest('.canvas-frame__name-input')) return;
          e.stopPropagation();
          e.preventDefault();
          startRenameFrame(frame);
        });

        el.classList.toggle('is-linked', !!p && p.total > 1);
        el.classList.toggle('has-bg-bind', !!frame.bgBind);
      });
      updateTopbar();
    }

    function renderLinks() {
      if (!linksRoot) return;
      linksRoot.innerHTML = '';
      const byId = new Map(frames.map(f => [f.id, f]));

      links.forEach((link) => {
        const a = byId.get(link.from);
        const b = byId.get(link.to);
        if (!a || !b) return;
        const p1 = portOut(a);
        const p2 = portIn(b);
        const d = linkPath(p1.x, p1.y, p2.x, p2.y);

        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('class', 'canvas-link' + (link.id === selectedLinkId ? ' is-selected' : ''));
        g.dataset.id = link.id;

        // Faixa larga e invisível por cima: é ela que recebe o clique
        const hit = document.createElementNS(SVG_NS, 'path');
        hit.setAttribute('class', 'canvas-link__hit');
        hit.setAttribute('d', d);

        const line = document.createElementNS(SVG_NS, 'path');
        line.setAttribute('class', 'canvas-link__line');
        line.setAttribute('d', d);

        g.appendChild(line);
        g.appendChild(hit);

        /* Botão de desatar no meio da corda: aparece ao passar o mouse.
           Bem mais achável do que "selecione e aperte Delete". */
        const cut = document.createElementNS(SVG_NS, 'g');
        cut.setAttribute('class', 'canvas-link__cut');
        const cutInner = document.createElementNS(SVG_NS, 'g');
        cutInner.setAttribute('class', 'canvas-link__cut-inner');
        const disc = document.createElementNS(SVG_NS, 'circle');
        disc.setAttribute('r', '11');
        const cross = document.createElementNS(SVG_NS, 'path');
        cross.setAttribute('d', 'M -4 -4 L 4 4 M 4 -4 L -4 4');
        cutInner.appendChild(disc);
        cutInner.appendChild(cross);
        cut.appendChild(cutInner);
        cut.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          deleteLink(link.id);
        });
        g.appendChild(cut);

        g.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          selectLink(link.id);
        });

        linksRoot.appendChild(g);
      });

      // Descarta a física de cordas que não existem mais
      const alive = new Set(links.map(l => l.id));
      Array.from(ropes.keys()).forEach(id => { if (!alive.has(id)) ropes.delete(id); });
      wakeRopes();
    }

    function selectLink(id) {
      selectedLinkId = id;
      if (id !== null && selectedId !== null) selectFrame(null);
      linksRoot.querySelectorAll('.canvas-link').forEach((g) => {
        g.classList.toggle('is-selected', Number(g.dataset.id) === id);
      });
      updateTopbar();
    }

    /* A cadeia é um post só, e um post não mistura redes: os slides de um
       carrossel saem como arquivos do mesmo tamanho, então ligar um Feed a um
       TikTok geraria algo que nenhuma rede aceita. */
    function canLink(a, b) {
      return !!a && !!b && a.format === b.format;
    }

    /* Cadeias misturadas salvas antes desta regra existir: derruba na abertura,
       senão o canvas continua mostrando um carrossel que não exporta */
    function pruneMixedLinks() {
      const byId = new Map(frames.map(f => [f.id, f]));
      links = links.filter(l => canLink(byId.get(l.from), byId.get(l.to)));
    }

    function addLink(fromId, toId) {
      if (fromId === toId) return;
      const byId = new Map(frames.map(f => [f.id, f]));
      if (!canLink(byId.get(fromId), byId.get(toId))) return;
      // Carrossel é linha reta: uma saída por frame e uma entrada por frame
      links = links.filter(l => l.from !== fromId && l.to !== toId);
      // Impede fechar um ciclo: seguindo a corrente a partir de `toId`
      // não se pode voltar em `fromId`
      const next = new Map(links.map(l => [l.from, l.to]));
      let cur = toId;
      const seen = new Set();
      while (cur !== undefined && !seen.has(cur)) {
        if (cur === fromId) return;
        seen.add(cur);
        cur = next.get(cur);
      }
      links.push({ id: linkSeq++, from: fromId, to: toId });
      renderLinks();
      updateFrameMeta();
      save();
    }

    /* Liga a seleção inteira numa corrente só, sem puxar corda a corda.
       A ordem é a que está na tela — esquerda para direita, de cima para baixo
       no empate — porque é assim que se lê um carrossel. */
    function linkSelectedFrames() {
      const chain = getSelectedFrames().sort((a, b) => a.x - b.x || a.y - b.y);
      if (chain.length < 2) return;
      if (!chain.every(f => canLink(f, chain[0]))) return;
      for (let i = 0; i < chain.length - 1; i++) addLink(chain[i].id, chain[i + 1].id);
    }

    function deleteLink(id) {
      links = links.filter(l => l.id !== id);
      if (selectedLinkId === id) selectedLinkId = null;
      renderLinks();
      updateFrameMeta();
      save();
    }

    /* Puxar a corda de uma porta até outro frame */
    function startLinkDrag(frame, e) {
      /* Frame sob o cursor + se ele aceita a corda que está sendo puxada */
      const frameUnder = (ev) => {
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const el = under && under.closest('.canvas-frame');
        if (!el || Number(el.dataset.id) === frame.id) return null;
        const other = frames.find(f => f.id === Number(el.dataset.id));
        return { el, ok: canLink(frame, other) };
      };

      const p1 = portOut(frame);
      const ghost = document.createElementNS(SVG_NS, 'path');
      ghost.setAttribute('class', 'canvas-link__line canvas-link__ghost');
      linksRoot.appendChild(ghost);
      let hovered = null;

      const onMove = (ev) => {
        const w = screenToWorld(ev.clientX, ev.clientY);
        ghost.setAttribute('d', linkPath(p1.x, p1.y, w.x, w.y));

        // Realça o frame sob o cursor para deixar claro onde a corda vai encaixar
        const target = frameUnder(ev);
        // Recusa em cima da hora: azul encaixa, vermelho diz que o formato não bate
        const valid = target ? target.el : null;
        if (hovered !== valid) {
          if (hovered) hovered.classList.remove('is-link-target', 'is-link-invalid');
          if (valid) valid.classList.add(target.ok ? 'is-link-target' : 'is-link-invalid');
          hovered = valid;
        }
      };

      const onUp = (ev) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        ghost.remove();
        if (hovered) hovered.classList.remove('is-link-target', 'is-link-invalid');
        const target = frameUnder(ev);
        if (target && target.ok) addLink(frame.id, Number(target.el.dataset.id));
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    function renderAll() {
      world.innerHTML = '';
      ensureLinksLayer();
      ensureWorldGuides();
      ensureMeasureLayer();
      frames.forEach(renderFrame);
      renderLinks();
      updateFrameMeta();
      applyCamera();
      syncImageChrome();
    }

    // Observer global: qualquer mudança de is-selected re-sincroniza o chrome
    watchSelectionForChrome();

    /* --------------------------------------------------
       Pan (com Espaço / Botão do Meio) e Seleção Múltipla (Marquee / Lasso)
       -------------------------------------------------- */
    view.addEventListener('mousedown', (e) => {
      if (e.target.closest('.canvas-hud')) return;
      if (e.target.closest('.canvas-frame') || e.target.closest('.canvas-topbar')) return;
      if (e.target.closest('.canvas-text-toolbar') || e.target.closest('.canvas-image-toolbar') || e.target.closest('.canvas-crop-toolbar')) return;

      const isPanning = isSpacePressed || e.button === 1 || e.altKey;

      if (isPanning) {
        e.preventDefault();
        view.classList.add('is-panning');
        if (isSpacePressed) view.classList.add('is-space-grabbing');
        const startX = e.clientX;
        const startY = e.clientY;
        const originX = cam.x;
        const originY = cam.y;

        const onMove = (ev) => {
          cam.x = originX + (ev.clientX - startX);
          cam.y = originY + (ev.clientY - startY);
          applyCamera();
        };
        const onUp = () => {
          view.classList.remove('is-panning', 'is-space-grabbing');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          saveQuiet(false);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return;
      }

      // Marquee Selection no Canvas com Botão Esquerdo
      if (e.button === 0) {
        const startScreenX = e.clientX;
        const startScreenY = e.clientY;
        const startWorldPt = screenToWorld(startScreenX, startScreenY);
        let marqueeEl = null;
        let moved = false;

        const onMove = (ev) => {
          const dx = ev.clientX - startScreenX;
          const dy = ev.clientY - startScreenY;
          if (!moved && Math.abs(dx) + Math.abs(dy) > 4) {
            moved = true;
            marqueeEl = document.createElement('div');
            marqueeEl.className = 'canvas-marquee-box';
            view.appendChild(marqueeEl);
          }
          if (!moved || !marqueeEl) return;

          const curScreenX = ev.clientX;
          const curScreenY = ev.clientY;
          const left = Math.min(startScreenX, curScreenX);
          const top = Math.min(startScreenY, curScreenY);
          const width = Math.abs(curScreenX - startScreenX);
          const height = Math.abs(curScreenY - startScreenY);

          marqueeEl.style.left = `${left}px`;
          marqueeEl.style.top = `${top}px`;
          marqueeEl.style.width = `${width}px`;
          marqueeEl.style.height = `${height}px`;

          const curWorldPt = screenToWorld(curScreenX, curScreenY);
          const boxX1 = Math.min(startWorldPt.x, curWorldPt.x);
          const boxX2 = Math.max(startWorldPt.x, curWorldPt.x);
          const boxY1 = Math.min(startWorldPt.y, curWorldPt.y);
          const boxY2 = Math.max(startWorldPt.y, curWorldPt.y);

          // 1. Testa nós filhos dentro dos frames
          const hitChildren = [];
          frames.forEach(f => {
            (f.children || []).forEach(c => {
              const nodeX1 = f.x + c.x;
              const nodeY1 = f.y + c.y;
              const nodeX2 = nodeX1 + c.w;
              const nodeY2 = nodeY1 + (c.h || 40);
              const intersects = !(nodeX2 < boxX1 || nodeX1 > boxX2 || nodeY2 < boxY1 || nodeY1 > boxY2);
              if (intersects) {
                hitChildren.push({ frameId: f.id, childId: c.id });
              }
            });
          });

          // 2. Testa frames
          const hitFrames = [];
          frames.forEach(f => {
            const fX1 = f.x;
            const fY1 = f.y;
            const fX2 = f.x + f.w;
            const fY2 = f.y + f.h;
            const intersects = !(fX2 < boxX1 || fX1 > boxX2 || fY2 < boxY1 || fY1 > boxY2);
            if (intersects) {
              hitFrames.push(f.id);
            }
          });

          // Feedback visual em tempo real:
          if (hitChildren.length > 0) {
            world.querySelectorAll('.canvas-text-node, .canvas-image-node').forEach(el => {
              const cId = Number(el.dataset.id);
              el.classList.toggle('is-selected', hitChildren.some(n => n.childId === cId));
            });
            world.querySelectorAll('.canvas-frame').forEach(el => el.classList.remove('is-selected'));
          } else {
            world.querySelectorAll('.canvas-text-node, .canvas-image-node').forEach(el => el.classList.remove('is-selected'));
            world.querySelectorAll('.canvas-frame').forEach(el => {
              const fId = Number(el.dataset.id);
              el.classList.toggle('is-selected', hitFrames.includes(fId));
            });
          }
        };

        const onUp = (ev) => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);

          if (marqueeEl) {
            marqueeEl.remove();
          }

          if (moved) {
            const curScreenX = ev.clientX;
            const curScreenY = ev.clientY;
            const curWorldPt = screenToWorld(curScreenX, curScreenY);
            const boxX1 = Math.min(startWorldPt.x, curWorldPt.x);
            const boxX2 = Math.max(startWorldPt.x, curWorldPt.x);
            const boxY1 = Math.min(startWorldPt.y, curWorldPt.y);
            const boxY2 = Math.max(startWorldPt.y, curWorldPt.y);

            const hitChildren = [];
            frames.forEach(f => {
              (f.children || []).forEach(c => {
                const nodeX1 = f.x + c.x;
                const nodeY1 = f.y + c.y;
                const nodeX2 = nodeX1 + c.w;
                const nodeY2 = nodeY1 + (c.h || 40);
                if (!(nodeX2 < boxX1 || nodeX1 > boxX2 || nodeY2 < boxY1 || nodeY1 > boxY2)) {
                  hitChildren.push({ frameId: f.id, childId: c.id });
                }
              });
            });

            if (hitChildren.length > 0) {
              selectedFrameIds.clear();
              selectedId = null;
              selectedChildNodes = hitChildren;
              selectedTextNode = hitChildren[0];
              world.querySelectorAll('.canvas-text-node, .canvas-image-node').forEach(el => {
                const cId = Number(el.dataset.id);
                el.classList.toggle('is-selected', hitChildren.some(n => n.childId === cId));
              });
              world.querySelectorAll('.canvas-frame').forEach(el => el.classList.remove('is-selected'));
              updateTextToolbar();
              updateTopbar();
            } else {
              const hitFrames = [];
              frames.forEach(f => {
                const fX1 = f.x;
                const fY1 = f.y;
                const fX2 = f.x + f.w;
                const fY2 = f.y + f.h;
                if (!(fX2 < boxX1 || fX1 > boxX2 || fY2 < boxY1 || fY1 > boxY2)) {
                  hitFrames.push(f.id);
                }
              });
              selectedChildNodes = [];
              selectedTextNode = { frameId: null, childId: null };
              selectedFrameIds = new Set(hitFrames);
              selectedId = hitFrames.length > 0 ? hitFrames[0] : null;
              world.querySelectorAll('.canvas-frame').forEach(el => {
                const fId = Number(el.dataset.id);
                el.classList.toggle('is-selected', selectedFrameIds.has(fId));
              });
              world.querySelectorAll('.canvas-text-node, .canvas-image-node').forEach(el => el.classList.remove('is-selected'));
              updateTopbar();
              updateTextToolbar();
            }
          } else {
            // Clique simples no vazio: limpa seleção
            selectFrame(null);
            selectTextNode(null, null);
            selectLink(null);
          }
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }
    });

    /* Zoom no scroll; scroll puro de trackpad faz pan lateral/vertical */
    view.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.08 : 0.92);
      } else {
        cam.x -= e.deltaX;
        cam.y -= e.deltaY;
        applyCamera();
        saveQuiet(); // pan de trackpad: dezenas de eventos por segundo
      }
    }, { passive: false });

    /* --------------------------------------------------
       Processamento Universal de Imagens (Unsplash, Figma, Canva, Pinterest, Google, Local)
       Extrai a melhor resolução de imagens a partir de HTML (srcset/src), arquivos, SVGs ou URLs.
       -------------------------------------------------- */
    function extractBestSrcFromSrcset(srcset) {
      if (!srcset || typeof srcset !== 'string') return null;
      const entries = srcset.split(',').map(s => s.trim()).filter(Boolean);
      let bestUrl = null;
      let bestWidth = 0;
      for (const entry of entries) {
        const parts = entry.split(/\s+/);
        const url = parts[0];
        const descriptor = parts[1] || '';
        let w = 0;
        if (descriptor.endsWith('w')) {
          w = parseInt(descriptor, 10) || 0;
        } else if (descriptor.endsWith('x')) {
          w = (parseFloat(descriptor) || 1) * 1000;
        }
        if (w >= bestWidth) {
          bestWidth = w;
          bestUrl = url;
        }
      }
      return bestUrl || (entries[entries.length - 1] ? entries[entries.length - 1].split(/\s+/)[0] : null);
    }

    function extractImageUrlsFromHtml(html) {
      if (!html || typeof html !== 'string') return [];
      const urls = [];
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // 1. Tags <img> (Unsplash, Canva, Figma, Google Images, etc.)
        const imgs = doc.querySelectorAll('img');
        imgs.forEach(img => {
          const srcset = img.getAttribute('srcset');
          const bestSrc = extractBestSrcFromSrcset(srcset);
          if (bestSrc) {
            urls.push(bestSrc);
            return;
          }
          const dataSrc = img.getAttribute('data-src') || 
                          img.getAttribute('data-original-src') || 
                          img.getAttribute('data-zoom-src') || 
                          img.getAttribute('data-high-res-src') ||
                          img.getAttribute('data-image-src');
          if (dataSrc) {
            urls.push(dataSrc);
            return;
          }
          const src = img.getAttribute('src');
          if (src) {
            urls.push(src);
          }
        });

        // 2. Elementos <svg> (Figma, ícones, vetores copiados)
        const svgs = doc.querySelectorAll('svg');
        svgs.forEach(svg => {
          const svgStr = new XMLSerializer().serializeToString(svg);
          if (svgStr && svgStr.length > 20) {
            urls.push('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr));
          }
        });

        // 3. background-image: url(...)
        const styled = doc.querySelectorAll('[style*="background"]');
        styled.forEach(el => {
          const style = el.getAttribute('style') || '';
          const m = style.match(/url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/i);
          if (m && m[1]) urls.push(m[1]);
        });
      } catch (err) {
        console.warn('Error parsing HTML image data:', err);
      }
      return urls;
    }

    function extractSvgFromText(text) {
      if (!text || typeof text !== 'string') return null;
      const trimmed = text.trim();
      if (trimmed.startsWith('<svg') && trimmed.endsWith('</svg>')) {
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(trimmed);
      }
      return null;
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
    }

    function loadImageAndDimensions(srcOrDataUrl) {
      return new Promise((resolve, reject) => {
        let url = srcOrDataUrl;
        // Se for URL de foto do Unsplash com resolução restrita (ex: &w=200 ou &w=400), aprimora para alta resolução
        if (url.includes('images.unsplash.com') && url.includes('w=')) {
          url = url.replace(/w=\d+/, 'w=1400');
        }

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const origW = img.naturalWidth || img.width || 800;
          const origH = img.naturalHeight || img.height || 600;
          let rawData = url;

          if (url.startsWith('http://') || url.startsWith('https://')) {
            try {
              const cvs = document.createElement('canvas');
              cvs.width = origW;
              cvs.height = origH;
              const ctx = cvs.getContext('2d');
              ctx.drawImage(img, 0, 0);
              rawData = cvs.toDataURL('image/png');
            } catch {
              rawData = url;
            }
          }
          resolve({ rawData, origW, origH });
        };
        img.onerror = () => {
          const fallback = new Image();
          fallback.onload = () => {
            const origW = fallback.naturalWidth || fallback.width || 800;
            const origH = fallback.naturalHeight || fallback.height || 600;
            resolve({ rawData: url, origW, origH });
          };
          fallback.onerror = () => reject(new Error('Failed to load image from ' + url));
          fallback.src = url;
        };
        img.src = url;
      });
    }

    async function insertImageAtPosition(srcOrDataUrl, worldPt, targetFrameOverride, offsetIndex = 0) {
      try {
        const { rawData, origW, origH } = await loadImageAndDimensions(srcOrDataUrl);
        
        let targetFrame = targetFrameOverride;
        if (!targetFrame && worldPt) {
          targetFrame = [...frames].reverse().find(f => 
            worldPt.x >= f.x && worldPt.x <= f.x + f.w &&
            worldPt.y >= f.y && worldPt.y <= f.y + f.h
          );
        }
        if (!targetFrame) {
          targetFrame = frames.find(f => f.id === selectedId) || frames[0];
        }
        if (!targetFrame) {
          const initX = worldPt ? Math.round(worldPt.x - 540) : 100;
          const initY = worldPt ? Math.round(worldPt.y - 675) : 100;
          targetFrame = makeFrame('ig-feed', initX, initY);
          frames.push(targetFrame);
          renderFrame(targetFrame);
          selectFrame(targetFrame.id);
        }

        const MAX_W = Math.min(800, Math.round(targetFrame.w * 0.8));
        let w = origW;
        let h = origH;
        if (w > MAX_W) {
          h = Math.round(h * (MAX_W / w));
          w = MAX_W;
        }

        let localX, localY;
        if (worldPt && (worldPt.x >= targetFrame.x && worldPt.x <= targetFrame.x + targetFrame.w &&
                        worldPt.y >= targetFrame.y && worldPt.y <= targetFrame.y + targetFrame.h)) {
          localX = Math.round(worldPt.x - targetFrame.x - (w / 2)) + (offsetIndex * 24);
          localY = Math.round(worldPt.y - targetFrame.y - (h / 2)) + (offsetIndex * 24);
        } else {
          localX = Math.round((targetFrame.w - w) / 2) + (offsetIndex * 24);
          localY = Math.round((targetFrame.h - h) / 2) + (offsetIndex * 24);
        }

        await addImageNode(targetFrame, rawData, origW, origH, localX, localY);
        return true;
      } catch (err) {
        console.warn('Could not insert image:', err);
        return false;
      }
    }

    async function processDroppedOrPastedImage(dataTransfer, worldPt, targetFrameOverride) {
      if (!dataTransfer) return false;

      // 1. Arquivos locais / blobs (Finder, Explorer, prints de tela, Figma exports)
      if (dataTransfer.files && dataTransfer.files.length > 0) {
        const validFiles = Array.from(dataTransfer.files).filter(f => 
          f.type.startsWith('image/') || /\.(png|jpe?g|webp|svg|gif|avif|bmp|ico)$/i.test(f.name)
        );
        if (validFiles.length > 0) {
          let count = 0;
          for (let i = 0; i < validFiles.length; i++) {
            const dataUrl = await readFileAsDataUrl(validFiles[i]);
            if (dataUrl) {
              const ok = await insertImageAtPosition(dataUrl, worldPt, targetFrameOverride, i);
              if (ok) count++;
            }
          }
          if (count > 0) {
            toast.success(count === 1 ? 'Imagem inserida no post' : `${count} imagens inseridas`);
            return true;
          }
        }
      }

      // 2. Items do clipboard / DataTransfer com tipo imagem
      if (dataTransfer.items && dataTransfer.items.length > 0) {
        const imageItems = Array.from(dataTransfer.items).filter(it => it.kind === 'file' && it.type.startsWith('image/'));
        if (imageItems.length > 0) {
          let count = 0;
          for (let i = 0; i < imageItems.length; i++) {
            const file = imageItems[i].getAsFile();
            if (file) {
              const dataUrl = await readFileAsDataUrl(file);
              if (dataUrl) {
                const ok = await insertImageAtPosition(dataUrl, worldPt, targetFrameOverride, i);
                if (ok) count++;
              }
            }
          }
          if (count > 0) {
            toast.success(count === 1 ? 'Imagem inserida no post' : `${count} imagens inseridas`);
            return true;
          }
        }
      }

      // 3. HTML (Unsplash, Canva, Figma, Google Imagens, Pinterest, qualquer página)
      const html = dataTransfer.getData('text/html');
      if (html) {
        const htmlUrls = extractImageUrlsFromHtml(html);
        if (htmlUrls.length > 0) {
          let count = 0;
          for (let i = 0; i < htmlUrls.length; i++) {
            const ok = await insertImageAtPosition(htmlUrls[i], worldPt, targetFrameOverride, i);
            if (ok) count++;
          }
          if (count > 0) {
            toast.success(count === 1 ? 'Imagem inserida no post' : `${count} imagens inseridas`);
            return true;
          }
        }
      }

      // 4. URI-List ou Plain text
      const uriList = dataTransfer.getData('text/uri-list');
      const plainText = dataTransfer.getData('text/plain')?.trim() || '';

      const svgDataUrl = extractSvgFromText(plainText);
      if (svgDataUrl) {
        const ok = await insertImageAtPosition(svgDataUrl, worldPt, targetFrameOverride);
        if (ok) {
          toast.success('SVG inserido no post');
          return true;
        }
      }

      const candidateUrls = [];
      if (uriList) {
        uriList.split(/\r?\n/).map(u => u.trim()).filter(u => u && !u.startsWith('#')).forEach(u => candidateUrls.push(u));
      }
      if (plainText && !candidateUrls.includes(plainText)) {
        candidateUrls.push(plainText);
      }

      let count = 0;
      for (let i = 0; i < candidateUrls.length; i++) {
        const url = candidateUrls[i];
        if (url && (url.startsWith('data:image/') || url.startsWith('blob:') || url.startsWith('http://') || url.startsWith('https://'))) {
          const ok = await insertImageAtPosition(url, worldPt, targetFrameOverride, i);
          if (ok) count++;
        }
      }

      if (count > 0) {
        toast.success(count === 1 ? 'Imagem inserida no post' : `${count} imagens inseridas`);
        return true;
      }

      return false;
    }

    /* --------------------------------------------------
       Integração de Arrastar e Soltar na Aba/Dock do Canvas
       Ao arrastar uma imagem de fora e passar sobre a aba do Canvas na dock,
       a aba se ilumina e o Canvas se abre instantaneamente para soltar a imagem.
       -------------------------------------------------- */
    const dockCanvasBtn = document.getElementById('dock-btn-canvas');
    if (dockCanvasBtn) {
      dockCanvasBtn.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dockCanvasBtn.classList.add('is-dock-drag-hover');
        if (!view.classList.contains('is-open')) {
          toggleCanvas(true);
        }
      });
      dockCanvasBtn.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        dockCanvasBtn.classList.add('is-dock-drag-hover');
        if (!view.classList.contains('is-open')) {
          toggleCanvas(true);
        }
      });
      dockCanvasBtn.addEventListener('dragleave', (e) => {
        if (!dockCanvasBtn.contains(e.relatedTarget)) {
          dockCanvasBtn.classList.remove('is-dock-drag-hover');
        }
      });
      dockCanvasBtn.addEventListener('drop', () => {
        dockCanvasBtn.classList.remove('is-dock-drag-hover');
      });
    }

    // Proteção de janela: evita que soltar imagem acidentalmente navegue fora da aplicação
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      if (!e.target.closest('#canvas-view') && !e.target.closest('.canvas-batch-dropzone-oa') && !e.target.closest('.canvas-font-dropzone-oa')) {
        e.preventDefault();
      }
    });

    /* --------------------------------------------------
       Drag & Drop Universal no Canvas (Unsplash / Figma / Canva / Desktop)
       Soltar imagem calcula a posição exata e ancora dentro do post.
       -------------------------------------------------- */
    let canvasDragCounter = 0;
    const dropIndicatorTextEl = document.getElementById('canvas-drop-text');

    function clearCanvasDropVisuals() {
      canvasDragCounter = 0;
      if (view) view.classList.remove('is-drag-active');
      world.querySelectorAll('.canvas-frame.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
      if (dockCanvasBtn) dockCanvasBtn.classList.remove('is-dock-drag-hover');
    }

    view.addEventListener('dragenter', (e) => {
      e.preventDefault();
      canvasDragCounter++;
      view.classList.add('is-drag-active');
    });

    view.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!view.classList.contains('is-drag-active')) {
        view.classList.add('is-drag-active');
      }

      const worldPt = screenToWorld(e.clientX, e.clientY);
      const hoveredFrame = [...frames].reverse().find(f => 
        worldPt.x >= f.x && worldPt.x <= f.x + f.w &&
        worldPt.y >= f.y && worldPt.y <= f.y + f.h
      );

      world.querySelectorAll('.canvas-frame').forEach(el => {
        const fId = Number(el.dataset.id);
        if (hoveredFrame && fId === hoveredFrame.id) {
          el.classList.add('is-drop-target');
        } else {
          el.classList.remove('is-drop-target');
        }
      });

      if (dropIndicatorTextEl) {
        if (hoveredFrame) {
          const frameName = hoveredFrame.name || `Post ${hoveredFrame.id}`;
          dropIndicatorTextEl.textContent = `Solte para adicionar no ${frameName}`;
        } else {
          const selF = frames.find(f => f.id === selectedId) || frames[0];
          if (selF) {
            dropIndicatorTextEl.textContent = `Solte para adicionar ao post selecionado`;
          } else {
            dropIndicatorTextEl.textContent = `Solte para criar um novo post`;
          }
        }
      }
    });

    view.addEventListener('dragleave', (e) => {
      e.preventDefault();
      canvasDragCounter--;
      if (canvasDragCounter <= 0 || !view.contains(e.relatedTarget)) {
        clearCanvasDropVisuals();
      }
    });

    view.addEventListener('drop', async (e) => {
      e.preventDefault();
      clearCanvasDropVisuals();
      const worldPt = screenToWorld(e.clientX, e.clientY);
      await processDroppedOrPastedImage(e.dataTransfer, worldPt);
    });

    /* Rastreia o mouse no canvas para colar (Cmd+V) na posição do cursor */
    let lastMouseScreen = { x: innerWidth / 2, y: innerHeight / 2 };
    view.addEventListener('mousemove', (e) => {
      lastMouseScreen = { x: e.clientX, y: e.clientY };
    });

    /* --------------------------------------------------
       Copiar e Colar Universal (⌘C / ⌘V / Ctrl+C / Ctrl+V / ⌘X / Ctrl+X)
       Suporta nós de texto, fotos, posts/frames inteiros e imagens externas entre abas/browsers
       -------------------------------------------------- */
    function copySelectedElements() {
      const isTyping = document.activeElement && 
        (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
      if (isTyping) return null;

      let payload = null;

      if (selectedChildNodes.length > 0) {
        const nodes = selectedChildNodes.map(sel => {
          const frame = frames.find(f => f.id === sel.frameId);
          const child = (frame && frame.children) ? frame.children.find(c => c.id === sel.childId) : null;
          if (!child) return null;
          const copy = JSON.parse(JSON.stringify(child));
          if (copy.type === 'image') {
            ensureImageProps(copy);
            if (copy.assetId && assetCache.has(copy.assetId)) {
              copy.src = assetCache.get(copy.assetId);
            }
          }
          return copy;
        }).filter(Boolean);

        if (nodes.length > 0) {
          payload = {
            type: 'oa-canvas-clipboard',
            kind: 'nodes',
            version: 1,
            source: 'AnalyticsOnboard',
            nodes
          };
        }
      } else if (selectedFrameIds.size > 0) {
        const framesToCopy = getSelectedFrames();
        if (framesToCopy.length > 0) {
          payload = {
            type: 'oa-canvas-clipboard',
            kind: 'frames',
            version: 1,
            source: 'AnalyticsOnboard',
            frames: framesToCopy.map(f => {
              const copy = JSON.parse(JSON.stringify(f));
              (copy.children || []).forEach(c => {
                if (c.type === 'image') {
                  ensureImageProps(c);
                  if (c.assetId && assetCache.has(c.assetId)) {
                    c.src = assetCache.get(c.assetId);
                  }
                }
              });
              return copy;
            })
          };
        }
      }

      if (payload) {
        const jsonStr = JSON.stringify(payload);
        try {
          localStorage.setItem('oa_clipboard_data', jsonStr);
        } catch {}
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(jsonStr).catch(() => {});
        }
        return jsonStr;
      }
      return null;
    }

    /* Helper para garantir que qualquer data URL que chegue pelo clipboard vire asset no IndexedDB
       e que data URLs idênticos compartilhem o mesmo assetId (dedup). */
    async function ensureAssetForImage(dataUrl, existingAssetId = null, dedupeMap = null) {
      if (existingAssetId && assetCache.has(existingAssetId)) {
        if (dataUrl && dedupeMap) dedupeMap.set(dataUrl, existingAssetId);
        return existingAssetId;
      }
      if (!isImageSrcValue(dataUrl)) {
        return existingAssetId || null;
      }
      if (dedupeMap && dedupeMap.has(dataUrl)) {
        return dedupeMap.get(dataUrl);
      }
      for (const [id, cached] of assetCache.entries()) {
        if (cached === dataUrl) {
          if (dedupeMap) dedupeMap.set(dataUrl, id);
          return id;
        }
      }
      const newId = (existingAssetId && !assetCache.has(existingAssetId)) ? existingAssetId : ('asset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
      assetCache.set(newId, dataUrl);
      await saveAsset(newId, dataUrl);
      if (dedupeMap) dedupeMap.set(dataUrl, newId);
      return newId;
    }

    async function pasteClipboardPayload(pastedText) {
      let data = null;
      if (pastedText && typeof pastedText === 'string') {
        try {
          if (pastedText.includes('oa-canvas-clipboard')) {
            data = JSON.parse(pastedText);
          }
        } catch {}
      }
      if (!data || data.type !== 'oa-canvas-clipboard') {
        try {
          const local = localStorage.getItem('oa_clipboard_data');
          if (local && local.includes('oa-canvas-clipboard')) {
            data = JSON.parse(local);
          }
        } catch {}
      }
      if (!data || data.type !== 'oa-canvas-clipboard') return false;

      const worldPt = screenToWorld(lastMouseScreen.x, lastMouseScreen.y);
      const dedupeMap = new Map();

      if (data.kind === 'nodes' && Array.isArray(data.nodes) && data.nodes.length > 0) {
        let targetFrame = [...frames].reverse().find(f => 
          worldPt.x >= f.x && worldPt.x <= f.x + f.w &&
          worldPt.y >= f.y && worldPt.y <= f.y + f.h
        ) || frames.find(f => f.id === selectedId) || frames[0];

        if (!targetFrame) {
          targetFrame = makeFrame('ig-feed', Math.round(worldPt.x - 540), Math.round(worldPt.y - 675));
          frames.push(targetFrame);
          renderFrame(targetFrame);
          selectFrame(targetFrame.id);
        }

        const frameEl = frameElOf(targetFrame);
        if (!frameEl) return false;

        const minX = Math.min(...data.nodes.map(n => n.x || 0));
        const minY = Math.min(...data.nodes.map(n => n.y || 0));
        const isMouseOverTarget = (worldPt.x >= targetFrame.x && worldPt.x <= targetFrame.x + targetFrame.w &&
                                   worldPt.y >= targetFrame.y && worldPt.y <= targetFrame.y + targetFrame.h);

        const baseLocalX = isMouseOverTarget ? Math.round(worldPt.x - targetFrame.x) : null;
        const baseLocalY = isMouseOverTarget ? Math.round(worldPt.y - targetFrame.y) : null;

        const newSelections = [];
        for (const orig of data.nodes) {
          const copy = JSON.parse(JSON.stringify(orig));
          copy.id = childSeq++;
          if (isMouseOverTarget && baseLocalX !== null) {
            copy.x = baseLocalX + ((orig.x || 0) - minX);
            copy.y = baseLocalY + ((orig.y || 0) - minY);
          } else {
            copy.x = (orig.x || 0) + 24;
            copy.y = (orig.y || 0) + 24;
          }
          if (copy.type === 'image') {
            ensureImageProps(copy);
            if (copy.src && isImageSrcValue(copy.src)) {
              const assetId = await ensureAssetForImage(copy.src, copy.assetId, dedupeMap);
              if (assetId) copy.assetId = assetId;
              delete copy.src;
            } else if (copy.assetId && assetCache.has(copy.assetId)) {
              delete copy.src;
            }
          }

          targetFrame.children = targetFrame.children || [];
          targetFrame.children.push(copy);
          renderChildNode(copy, targetFrame, frameEl);
          newSelections.push({ frameId: targetFrame.id, childId: copy.id });
        }

        selectedFrameIds.clear();
        selectedId = null;
        selectedChildNodes = newSelections;
        selectedTextNode = newSelections.length > 0 ? newSelections[0] : { frameId: null, childId: null };
        world.querySelectorAll('.canvas-text-node, .canvas-image-node').forEach(el => {
          const cId = Number(el.dataset.id);
          el.classList.toggle('is-selected', selectedChildNodes.some(n => n.childId === cId));
        });
        world.querySelectorAll('.canvas-frame').forEach(el => el.classList.remove('is-selected'));

        updateTextToolbar();
        save();
        return true;
      }

      if (data.kind === 'frames' && Array.isArray(data.frames) && data.frames.length > 0) {
        const minX = Math.min(...data.frames.map(f => f.x || 0));
        const minY = Math.min(...data.frames.map(f => f.y || 0));
        const newFrameIds = new Set();

        for (const orig of data.frames) {
          const copy = JSON.parse(JSON.stringify(orig));
          copy.id = frameSeq++;
          copy.name = orig.name ? `${orig.name} (cópia)` : '';
          
          copy.x = Math.round(worldPt.x + ((orig.x || 0) - minX));
          copy.y = Math.round(worldPt.y + ((orig.y || 0) - minY));

          if (copy.bgImage && isImageSrcValue(copy.bgImage)) {
            const bgId = await ensureAssetForImage(copy.bgImage, copy.bgAssetId, dedupeMap);
            if (bgId) copy.bgAssetId = bgId;
            copy.bgImage = null;
          } else if (copy.bgAssetId && assetCache.has(copy.bgAssetId)) {
            copy.bgImage = null;
          }

          const children = [];
          for (const c of (orig.children || [])) {
            const chCopy = { ...JSON.parse(JSON.stringify(c)), id: childSeq++ };
            if (chCopy.type === 'image') {
              ensureImageProps(chCopy);
              if (chCopy.src && isImageSrcValue(chCopy.src)) {
                const assetId = await ensureAssetForImage(chCopy.src, chCopy.assetId, dedupeMap);
                if (assetId) chCopy.assetId = assetId;
                delete chCopy.src;
              } else if (chCopy.assetId && assetCache.has(chCopy.assetId)) {
                delete chCopy.src;
              }
            }
            children.push(chCopy);
          }
          copy.children = children;

          frames.push(copy);
          renderFrame(copy);
          newFrameIds.add(copy.id);
        }

        selectedChildNodes = [];
        selectedTextNode = { frameId: null, childId: null };
        selectedFrameIds = newFrameIds;
        selectedId = [...newFrameIds][0];
        world.querySelectorAll('.canvas-frame').forEach((el) => {
          const fId = Number(el.dataset.id);
          el.classList.toggle('is-selected', selectedFrameIds.has(fId));
        });
        world.querySelectorAll('.canvas-text-node, .canvas-image-node').forEach(el => el.classList.remove('is-selected'));

        updateTopbar();
        updateFrameMeta();
        save();
        return true;
      }

      return false;
    }

    document.addEventListener('copy', (e) => {
      if (!view.classList.contains('is-open')) return;
      const isTyping = document.activeElement && 
        (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
      if (isTyping) return;

      const payloadStr = copySelectedElements();
      if (payloadStr) {
        e.preventDefault();
        e.stopPropagation();
        if (e.clipboardData) {
          e.clipboardData.setData('text/plain', payloadStr);
        }
        // Copiar é a única ação do editor sem retorno visual nenhum
        toast.success('Copiado');
      }
    });

    document.addEventListener('cut', (e) => {
      if (!view.classList.contains('is-open')) return;
      const isTyping = document.activeElement && 
        (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
      if (isTyping) return;

      const payloadStr = copySelectedElements();
      if (payloadStr) {
        e.preventDefault();
        e.stopPropagation();
        if (e.clipboardData) {
          e.clipboardData.setData('text/plain', payloadStr);
        }
        if (selectedChildNodes.length > 0) deleteTextNode();
        else if (selectedFrameIds.size > 0) deleteFrame(selectedId);
      }
    });

    /* Helper para colar conteúdo do Clipboard via Menu de Contexto ou Atalho */
    async function pasteFromClipboardDirectly(targetFrame) {
      try {
        if (navigator.clipboard && navigator.clipboard.read) {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            for (const type of item.types) {
              if (type.startsWith('image/')) {
                const blob = await item.getType(type);
                const dataUrl = await readFileAsDataUrl(blob);
                if (dataUrl) {
                  const worldPt = screenToWorld(lastMouseScreen.x, lastMouseScreen.y);
                  await insertImageAtPosition(dataUrl, worldPt, targetFrame?.id ? targetFrame : null);
                  toast.success('Imagem inserida no post');
                  return;
                }
              }
            }
          }
        }
        if (navigator.clipboard && navigator.clipboard.readText) {
          const text = await navigator.clipboard.readText();
          if (text) {
            const handledNative = await pasteClipboardPayload(text);
            if (handledNative) return;
            const worldPt = screenToWorld(lastMouseScreen.x, lastMouseScreen.y);
            const mockDT = {
              getData: (type) => (type === 'text/plain' ? text : ''),
              files: [],
              items: []
            };
            await processDroppedOrPastedImage(mockDT, worldPt, targetFrame?.id ? targetFrame : null);
          }
        }
      } catch (err) {
        toast.info('Pressione ⌘V ou Ctrl+V para colar');
      }
    }

    document.addEventListener('paste', async (e) => {
      if (!view.classList.contains('is-open')) return;

      const isEditingText = document.activeElement && 
        (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

      const plainText = (e.clipboardData || window.clipboardData)?.getData('text/plain')?.trim() || '';

      // 1. Tenta colar nós/frames nativos copiados entre abas
      if (!isEditingText && plainText) {
        const handled = await pasteClipboardPayload(plainText);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      if (isEditingText) return;

      // 2. Colar imagens universais (Unsplash, Figma, Canva, Desktop, prints de tela, links, HTML, SVGs)
      const clipData = e.clipboardData || window.clipboardData;
      if (!clipData) return;

      const worldPt = screenToWorld(lastMouseScreen.x, lastMouseScreen.y);
      const handled = await processDroppedOrPastedImage(clipData, worldPt);
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    /* --------------------------------------------------
       Menu de Contexto Flutuante (Botão Direito / Right-Click) - OA Design
       -------------------------------------------------- */
    const contextMenuEl = document.getElementById('canvas-context-menu');

    function hideContextMenu() {
      if (!contextMenuEl) return;
      contextMenuEl.classList.remove('is-open');
      contextMenuEl.style.display = 'none';
      contextMenuEl.innerHTML = '';
    }

    /* Define um nó de imagem do frame como a imagem de fundo oficial do post (Canva/Figma style) */
    async function setChildAsFrameBackground(frameId, childId) {
      const frame = frames.find(f => f.id === frameId);
      if (!frame) return;
      const child = (frame.children || []).find(c => c.id === childId);
      if (!child || child.type !== 'image') return;

      let assetId = child.assetId;
      if (assetId && assetCache.has(assetId)) {
        frame.bgAssetId = assetId;
        frame.bgImage = null;
      } else if (child.src) {
        if (isImageSrcValue(child.src)) {
          assetId = await ensureAssetForImage(child.src);
          frame.bgAssetId = assetId;
          frame.bgImage = null;
        } else {
          frame.bgImage = child.src;
          frame.bgAssetId = null;
        }
      } else if (assetId) {
        frame.bgAssetId = assetId;
        frame.bgImage = null;
      }

      frame.bg = null;
      frame.bgRecipe = null;
      if (frame.bgOverlay == null) frame.bgOverlay = 35;
      if (frame.bgBlur == null) frame.bgBlur = 0;

      // Remove a camada da imagem do post para virar o fundo permanente
      frame.children = frame.children.filter(c => c.id !== childId);
      const domNode = world.querySelector(`.canvas-image-node[data-id="${childId}"]`);
      if (domNode) domNode.remove();

      selectedChildNodes = selectedChildNodes.filter(n => n.childId !== childId);
      selectedTextNode = { frameId: null, childId: null };
      selectFrame(frame.id);

      applyFrameBackground(frame);
      updateTextToolbar();
      updateTopbar();
      updateFrameMeta();
      save();
      toast.success('Imagem definida como fundo do post');
    }

    function showContextMenu(e, targetType, targetData) {
      if (!contextMenuEl) return;
      e.preventDefault();
      e.stopPropagation();

      let itemsHtml = '';

      if (targetType === 'child') {
        const isMulti = selectedChildNodes.length > 1;
        const label = isMulti ? `${selectedChildNodes.length} elementos` : 'Elemento';
        const targetFrame = frames.find(f => f.id === targetData?.frameId);
        const targetChild = (targetFrame?.children || []).find(c => c.id === targetData?.childId);
        const isImageNode = !isMulti && targetChild && targetChild.type === 'image';

        let imageSectionHtml = '';
        if (isImageNode) {
          imageSectionHtml = `
            <div class="canvas-context-section-label">Imagem</div>
            <button type="button" class="canvas-context-item canvas-context-item--primary" data-action="set-child-as-bg">
              <i data-lucide="image"></i>
              <span>Definir como Fundo do Post</span>
            </button>
            <button type="button" class="canvas-context-item" data-action="crop-image-node">
              <i data-lucide="crop"></i>
              <span>Recortar Imagem</span>
              <span class="canvas-context-meta">Duplo-clique</span>
            </button>
            <div class="canvas-context-divider"></div>
          `;
        }

        itemsHtml = `
          ${imageSectionHtml}
          <div class="canvas-context-section-label">Alinhar no Post</div>
          <button type="button" class="canvas-context-item" data-action="align-center-h">
            <i data-lucide="align-center-horizontal"></i>
            <span>Centralizar Horizontal</span>
            <span class="canvas-context-meta">⌥H</span>
          </button>
          <button type="button" class="canvas-context-item" data-action="align-center-v">
            <i data-lucide="align-center-vertical"></i>
            <span>Centralizar Vertical</span>
            <span class="canvas-context-meta">⌥V</span>
          </button>
          <button type="button" class="canvas-context-item" data-action="align-center-both">
            <i data-lucide="crosshair"></i>
            <span>Centro do Post</span>
            <span class="canvas-context-meta">⌥C</span>
          </button>

          <div class="canvas-context-divider"></div>
          <div class="canvas-context-section-label">Camadas</div>
          <button type="button" class="canvas-context-item" data-action="bring-front">
            <i data-lucide="chevrons-up"></i>
            <span>Trazer para o Topo</span>
            <span class="canvas-context-meta">⌥⌘]</span>
          </button>
          <button type="button" class="canvas-context-item" data-action="bring-forward">
            <i data-lucide="chevron-up"></i>
            <span>Avançar uma Camada</span>
            <span class="canvas-context-meta">⌘]</span>
          </button>
          <button type="button" class="canvas-context-item" data-action="send-backward">
            <i data-lucide="chevron-down"></i>
            <span>Recuar uma Camada</span>
            <span class="canvas-context-meta">⌘[</span>
          </button>
          <button type="button" class="canvas-context-item" data-action="send-back">
            <i data-lucide="chevrons-down"></i>
            <span>Enviar para o Fundo</span>
            <span class="canvas-context-meta">⌥⌘[</span>
          </button>

          <div class="canvas-context-divider"></div>
          <div class="canvas-context-section-label">Girar</div>
          <button type="button" class="canvas-context-item" data-action="rotate-cw-90">
            <i data-lucide="rotate-cw"></i>
            <span>Girar 90° Horário</span>
            <span class="canvas-context-meta">⌥R</span>
          </button>
          <button type="button" class="canvas-context-item" data-action="rotate-ccw-90">
            <i data-lucide="rotate-ccw"></i>
            <span>Girar 90° Anti-horário</span>
            <span class="canvas-context-meta">-90°</span>
          </button>
          <button type="button" class="canvas-context-item" data-action="rotate-reset">
            <i data-lucide="rotate-ccw"></i>
            <span>Redefinir Rotação</span>
            <span class="canvas-context-meta">0°</span>
          </button>

          <div class="canvas-context-divider"></div>
          <div class="canvas-context-section-label">Ações</div>
          <button type="button" class="canvas-context-item" data-action="duplicate-node">
            <i data-lucide="copy"></i>
            <span>Duplicar ${label}</span>
            <span class="canvas-context-meta">⌘D</span>
          </button>
          <button type="button" class="canvas-context-item canvas-context-item--danger" data-action="delete-node">
            <i data-lucide="trash-2"></i>
            <span>Excluir ${label}</span>
            <span class="canvas-context-meta">⌫</span>
          </button>
        `;
      } else if (targetType === 'frame') {
        const frame = targetData;
        const frameTitle = frame ? (frame.name || `Post ${frame.id}`) : 'Post';
        const hasBg = hasFrameBg(frame);

        itemsHtml = `
          <div class="canvas-context-section-label">${frameTitle}</div>
          <button type="button" class="canvas-context-item" data-action="rename-frame">
            <i data-lucide="edit-3"></i>
            <span>Renomear Post</span>
          </button>
          <button type="button" class="canvas-context-item" data-action="paste-clipboard">
            <i data-lucide="clipboard-paste"></i>
            <span>Colar no Post</span>
            <span class="canvas-context-meta">⌘V</span>
          </button>
          <button type="button" class="canvas-context-item" data-action="duplicate-frame">
            <i data-lucide="copy"></i>
            <span>Duplicar Post</span>
            <span class="canvas-context-meta">⌘D</span>
          </button>
          <button type="button" class="canvas-context-item" data-action="add-text-frame">
            <i data-lucide="type"></i>
            <span>Adicionar Texto</span>
          </button>
          ${hasBg ? `
          <button type="button" class="canvas-context-item canvas-context-item--primary" data-action="reposition-frame-bg">
            <i data-lucide="move"></i>
            <span>Ajustar Posição da Foto</span>
            <span class="canvas-context-meta">Duplo-clique</span>
          </button>
          <button type="button" class="canvas-context-item" data-action="remove-frame-bg">
            <i data-lucide="image-minus"></i>
            <span>Remover Imagem de Fundo</span>
          </button>
          ` : ''}
          <button type="button" class="canvas-context-item" data-action="export-frame">
            <i data-lucide="download"></i>
            <span>Exportar este Post</span>
          </button>

          <div class="canvas-context-divider"></div>
          <button type="button" class="canvas-context-item canvas-context-item--danger" data-action="delete-frame">
            <i data-lucide="trash-2"></i>
            <span>Excluir Post</span>
          </button>
        `;
      } else {
        itemsHtml = `
          <div class="canvas-context-section-label">Canvas</div>
          <button type="button" class="canvas-context-item" data-action="paste-clipboard">
            <i data-lucide="clipboard-paste"></i>
            <span>Colar no Canvas</span>
            <span class="canvas-context-meta">⌘V</span>
          </button>
          <button type="button" class="canvas-context-item" data-action="add-new-frame">
            <i data-lucide="plus-square"></i>
            <span>Novo Post</span>
          </button>
          <button type="button" class="canvas-context-item" data-action="toggle-binds">
            <i data-lucide="${showBinds ? 'eye-off' : 'variable'}"></i>
            <span>${showBinds ? 'Ocultar Visor de Variáveis {{}}' : 'Ligar Visor de Variáveis {{}}'}</span>
            <span class="canvas-context-meta">B</span>
          </button>
          <button type="button" class="canvas-context-item" data-action="reset-toolbar-pin">
            <i data-lucide="pin-off"></i>
            <span>Grudar Barra no Elemento</span>
            <span class="canvas-context-meta">⌥T</span>
          </button>
          <button type="button" class="canvas-context-item" data-action="open-library">
            <i data-lucide="sparkles"></i>
            <span>Biblioteca & Recursos</span>
          </button>
          <button type="button" class="canvas-context-item" data-action="reset-zoom">
            <i data-lucide="maximize-2"></i>
            <span>Ajustar Zoom (100%)</span>
          </button>
        `;
      }

      contextMenuEl.innerHTML = itemsHtml;
      if (window.lucide) lucide.createIcons({ root: contextMenuEl });

      // Action Dispatcher
      contextMenuEl.querySelectorAll('.canvas-context-item').forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const action = btn.dataset.action;
          hideContextMenu();

          if (action === 'toggle-binds') {
            toggleBindsVisibility(true);
          } else if (action === 'reset-toolbar-pin') {
            if (typeof resetToolbarToElement === 'function') resetToolbarToElement(false);
          } else if (action === 'set-child-as-bg') {
            if (targetData && targetData.frameId && targetData.childId) {
              setChildAsFrameBackground(targetData.frameId, targetData.childId);
            }
          } else if (action === 'crop-image-node') {
            if (targetData && targetData.frameId && targetData.childId) {
              enterCropMode(targetData.frameId, targetData.childId);
            }
          } else if (action === 'reposition-frame-bg') {
            const f = targetData || selectedFrame();
            if (f) enterFrameBgRepositionMode(f.id);
          } else if (action === 'remove-frame-bg') {
            const f = targetData || selectedFrame();
            if (f) {
              f.bgImage = null;
              f.bgAssetId = null;
              applyFrameBackground(f);
              save();
              updateTextToolbar();
              updateTopbar();
              updateFrameMeta();
              toast.success('Imagem de fundo removida');
            }
          } else if (action === 'align-center-h') alignSelectedNodes('center-h');
          else if (action === 'align-center-v') alignSelectedNodes('center-v');
          else if (action === 'align-center-both') alignSelectedNodes('center-both');
          else if (action === 'rotate-cw-90') rotateSelectedNodes(90);
          else if (action === 'rotate-ccw-90') rotateSelectedNodes(-90);
          else if (action === 'rotate-reset') rotateSelectedNodes('reset');
          else if (action === 'bring-front') bringChildToFront();
          else if (action === 'bring-forward') bringChildForward();
          else if (action === 'send-backward') sendChildBackward();
          else if (action === 'send-back') sendChildToBack();
          else if (action === 'duplicate-node') duplicateTextNode();
          else if (action === 'delete-node') deleteTextNode();
          else if (action === 'paste-clipboard') {
            pasteFromClipboardDirectly(targetData);
          } else if (action === 'rename-frame') {
            const f = targetData || selectedFrame();
            if (f) startRenameFrame(f);
          } else if (action === 'duplicate-frame') {
            if (targetData && targetData.id) duplicateFrame(targetData.id);
            else if (selectedId) duplicateFrame(selectedId);
          } else if (action === 'add-text-frame') {
            const f = targetData || selectedFrame();
            if (f) addTextNode(f, Math.round(f.w * 0.1), Math.round(f.h * 0.4));
          } else if (action === 'export-frame') {
            const exportBtn = document.getElementById('canvas-export-btn');
            if (exportBtn) exportBtn.click();
          } else if (action === 'delete-frame') {
            if (targetData && targetData.id) deleteFrame(targetData.id);
            else if (selectedId) deleteFrame(selectedId);
          } else if (action === 'add-new-frame') {
            addFrame();
          } else if (action === 'open-library') {
            const libBtn = document.getElementById('canvas-insert-menu-btn');
            if (libBtn) libBtn.click();
          } else if (action === 'reset-zoom') {
            cam.scale = 1;
            applyCamera();
          }
        });
      });

      // Posicionamento inteligente (evita sair da tela)
      contextMenuEl.style.display = 'flex';
      const menuW = 230;
      const menuH = contextMenuEl.offsetHeight || 280;
      let posX = e.clientX;
      let posY = e.clientY;

      if (posX + menuW > window.innerWidth - 12) {
        posX = window.innerWidth - menuW - 12;
      }
      if (posY + menuH > window.innerHeight - 12) {
        posY = window.innerHeight - menuH - 12;
      }

      contextMenuEl.style.left = `${Math.max(12, posX)}px`;
      contextMenuEl.style.top = `${Math.max(12, posY)}px`;

      requestAnimationFrame(() => {
        contextMenuEl.classList.add('is-open');
      });
    }

    view.addEventListener('contextmenu', (e) => {
      if (!view.classList.contains('is-open')) return;
      if (e.target.closest('.canvas-topbar') || e.target.closest('.canvas-hud') || e.target.closest('.dock-wrapper') || e.target.closest('.modal-overlay')) return;

      const childEl = e.target.closest('.canvas-text-node, .canvas-image-node');
      if (childEl) {
        const frameEl = childEl.closest('.canvas-frame');
        const frameId = frameEl ? Number(frameEl.dataset.id) : null;
        const childId = Number(childEl.dataset.id);
        if (frameId && childId) {
          if (!selectedChildNodes.some(n => n.childId === childId)) {
            selectTextNode(frameId, childId);
          }
          showContextMenu(e, 'child', { frameId, childId });
          return;
        }
      }

      const frameEl = e.target.closest('.canvas-frame');
      if (frameEl) {
        const frameId = Number(frameEl.dataset.id);
        const frame = frames.find(f => f.id === frameId);
        if (frame) {
          selectFrame(frame.id);
          showContextMenu(e, 'frame', frame);
          return;
        }
      }

      showContextMenu(e, 'canvas', null);
    });

    document.addEventListener('click', (e) => {
      if (contextMenuEl && !contextMenuEl.contains(e.target)) {
        hideContextMenu();
      }
    });

    window.addEventListener('wheel', () => hideContextMenu(), { passive: true });
    window.addEventListener('resize', () => hideContextMenu());

    /* Controles */
    const btnUndo = document.getElementById('canvas-undo');
    const btnRedo = document.getElementById('canvas-redo');
    const btnIn = document.getElementById('canvas-zoom-in');
    const btnOut = document.getElementById('canvas-zoom-out');
    const btnLabel = document.getElementById('canvas-zoom-label');
    const btnCenter = document.getElementById('canvas-recenter');

    if (btnUndo) {
      btnUndo.addEventListener('click', () => {
        if (undoStack.length <= 1) {
          toast.info('Nada para desfazer no histórico.');
          return;
        }
        undo();
        toast.info('Ação desfeita (⌘Z)');
      });
    }

    if (btnRedo) {
      btnRedo.addEventListener('click', () => {
        if (redoStack.length === 0) {
          toast.info('Nada para refazer no histórico.');
          return;
        }
        redo();
        toast.info('Ação refeita (⌘⇧Z)');
      });
    }

    if (btnIn) {
      btnIn.addEventListener('click', () => {
        zoomAt(innerWidth / 2, innerHeight / 2, 1.2);
        const pct = Math.round((cam.scale / BASE_SCALE) * 100);
        toast.info(`Zoom aumentado: ${pct}%`);
      });
    }

    if (btnOut) {
      btnOut.addEventListener('click', () => {
        zoomAt(innerWidth / 2, innerHeight / 2, 0.8);
        const pct = Math.round((cam.scale / BASE_SCALE) * 100);
        toast.info(`Zoom reduzido: ${pct}%`);
      });
    }

    if (btnLabel) {
      btnLabel.addEventListener('click', () => {
        const currentPct = Math.round((cam.scale / BASE_SCALE) * 100);
        if (currentPct === 100) {
          toast.info('Zoom já está em 100%');
          return;
        }
        zoomAt(innerWidth / 2, innerHeight / 2, BASE_SCALE / cam.scale);
        toast.success('Zoom redefinido para 100%');
      });
    }

    if (btnCenter) {
      btnCenter.addEventListener('click', () => {
        if (selectedChildNodes.length > 0 || (selectedTextNode && selectedTextNode.childId)) {
          alignSelectedNodes('center-both');
          toast.success('Elemento centralizado no post');
          return;
        }
        const selFrame = selectedFrame();
        if (selFrame) {
          cam.x = Math.round((innerWidth / 2) - (selFrame.x + (selFrame.w / 2)) * cam.scale);
          cam.y = Math.round((innerHeight / 2) - (selFrame.y + (selFrame.h / 2)) * cam.scale);
          applyCamera();
          save();
          toast.success('Post centralizado na tela');
          return;
        }
        cam = { x: 0, y: 0, scale: BASE_SCALE };
        applyCamera();
        save();
        toast.success('Canvas centralizado no visor');
      });
    }
    /* Barra do topo: Menus Verticais Suspensos & Ações */
    function closeAllDropdowns() {
      if (formatsMenu) formatsMenu.classList.remove('is-open');
      if (insertMenu) insertMenu.classList.remove('is-open');
      if (batchMenu) batchMenu.classList.remove('is-open');
      if (btnAddFrame) btnAddFrame.classList.remove('active');
      if (btnInsertMenu) btnInsertMenu.classList.remove('active');
      if (btnBatchMenu) btnBatchMenu.classList.remove('active');
    }

    // 1. Menu de Formatos de Frame (+ Post abre o card para escolher o formato)
    if (btnAddFrame && formatsMenu) {
      btnAddFrame.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !formatsMenu.classList.contains('is-open');
        closeAllDropdowns();
        if (willOpen) {
          formatsMenu.classList.add('is-open');
          btnAddFrame.classList.add('active');
        }
      });

      formatsMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.canvas-dropdown-item');
        if (!item) return;
        if (item.id === 'canvas-btn-open-panoramic' || item.classList.contains('canvas-formats__item--panoramic')) {
          closeAllDropdowns();
          if (window.openPanoramicModal) window.openPanoramicModal();
          return;
        }
        const formatKey = item.dataset.format || 'ig-feed';
        addFrame(formatKey);
        closeAllDropdowns();
      });
    }

    // 2. Menu de Inserção de Elementos (Texto, Imagem, Mesh, Ícones, Fontes)
    if (btnInsertMenu && insertMenu) {
      btnInsertMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !insertMenu.classList.contains('is-open');
        closeAllDropdowns();
        if (willOpen) {
          insertMenu.classList.add('is-open');
          btnInsertMenu.classList.add('active');
        }
      });

      insertMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.canvas-dropdown-item');
        if (!item) return;
        const action = item.dataset.action;
        closeAllDropdowns();

        // Se não houver frame no canvas, cria um primeiro automaticamente
        if (frames.length === 0) {
          addFrame('ig-feed');
        }
        const targetFrame = frames.find(f => f.id === selectedId) || frames[0];
        if (targetFrame && selectedId !== targetFrame.id) {
          selectFrame(targetFrame.id);
        }

        if (action === 'add-text') {
          addTextToSelectedFrame();
        } else if (action === 'open-templates') {
          if (window.openTemplatesModal) window.openTemplatesModal();
        } else if (action === 'open-photos') {
          if (window.openIconLibrary) window.openIconLibrary('photos');
        } else if (action === 'add-image') {
          if (imageUpload) imageUpload.click();
        } else if (action === 'open-mesh') {
          if (window.openIconLibrary) window.openIconLibrary('gradients');
        } else if (action === 'open-icons') {
          if (window.openIconLibrary) window.openIconLibrary('icons');
        } else if (action === 'open-fonts') {
          if (window.openIconLibrary) window.openIconLibrary('fonts');
        }
      });
    }

    // 3. Menu de Automação em Lote (CSV, Fotos, Exportar, Snapping, Guias, Binds)
    if (btnBatchMenu && batchMenu) {
      btnBatchMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !batchMenu.classList.contains('is-open');
        closeAllDropdowns();
        if (willOpen) {
          batchMenu.classList.add('is-open');
          btnBatchMenu.classList.add('active');
        }
      });

      batchMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.canvas-dropdown-item');
        if (!item) return;
        const action = item.dataset.action;
        closeAllDropdowns();

        if (action === 'batch-data') {
          if (window.openBatchModal) window.openBatchModal();
        } else if (action === 'batch-photos') {
          if (window.openBatchPhotosModal) window.openBatchPhotosModal();
        } else if (action === 'batch-export') {
          if (window.openBatchExportModal) window.openBatchExportModal();
        } else if (action === 'toggle-binds') {
          const btnBinds = document.getElementById('canvas-toggle-binds');
          if (btnBinds) btnBinds.click();
        } else if (action === 'toggle-snap') {
          const btnSnap = document.getElementById('canvas-toggle-snap');
          if (btnSnap) btnSnap.click();
        } else if (action === 'toggle-guides') {
          const btnGuides = document.getElementById('canvas-toggle-guides');
          if (btnGuides) btnGuides.click();
        }
      });
    }

    // Fecha dropdowns ao clicar fora
    document.addEventListener('mousedown', (e) => {
      if (e.target.closest('.canvas-dropdown-card') || e.target.closest('.canvas-topbar__btn')) return;
      closeAllDropdowns();
    });

    if (btnAddText) btnAddText.addEventListener('click', () => addTextToSelectedFrame());

    const imageUpload = document.getElementById('canvas-image-upload');

    if (btnAddImage) {
      btnAddImage.addEventListener('click', () => {
        if (selectedId !== null && imageUpload) imageUpload.click();
      });
    }

    if (imageUpload) {
      imageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file || selectedId === null) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const rawData = ev.target.result;
          const img = new Image();
          img.onload = () => {
            const frame = frames.find(f => f.id === selectedId);
            if (frame) {
              addImageNode(frame, rawData, img.naturalWidth || img.width, img.naturalHeight || img.height);
            }
          };
          img.src = rawData;
        };
        reader.readAsDataURL(file);
        imageUpload.value = '';
      });
    }

    if (btnDupFrame) btnDupFrame.addEventListener('click', () => {
      if (selectedId !== null) duplicateFrame(selectedId);
    });

    if (btnDelFrame) btnDelFrame.addEventListener('click', () => {
      if (selectedLinkId !== null) deleteLink(selectedLinkId);
      else if (selectedId !== null) deleteFrame(selectedId);
    });

    if (btnLinkFrames) btnLinkFrames.addEventListener('click', () => linkSelectedFrames());

    const btnToggleSnap = document.getElementById('canvas-toggle-snap');
    const btnToggleGuides = document.getElementById('canvas-toggle-guides');
    const hudSnap = document.getElementById('canvas-hud-snap');
    const hudGuides = document.getElementById('canvas-hud-guides');

    function toggleSnap(showToast = false) {
      snapEnabled = !snapEnabled;
      if (btnToggleSnap) btnToggleSnap.classList.toggle('active', snapEnabled);
      if (hudSnap) {
        hudSnap.classList.toggle('is-active', snapEnabled);
        hudSnap.title = `Snap Magnético: ${snapEnabled ? 'Ligado' : 'Desligado'}`;
      }
      localStorage.setItem('oa_canvas_snap', snapEnabled);
      if (showToast) {
        toast.info(snapEnabled ? 'Snap magnético ativado' : 'Snap magnético desativado');
      }
    }

    function toggleGuides(showToast = false) {
      showGuides = !showGuides;
      if (btnToggleGuides) btnToggleGuides.classList.toggle('active', showGuides);
      if (hudGuides) {
        hudGuides.classList.toggle('is-active', showGuides);
        hudGuides.title = `Safe Zones das Redes: ${showGuides ? 'Ligado' : 'Desligado'}`;
      }
      view.classList.toggle('show-guides', showGuides);
      localStorage.setItem('oa_canvas_guides', showGuides);
      if (showToast) {
        toast.info(showGuides ? 'Safe Zones das Redes ativadas' : 'Safe Zones das Redes desativadas');
      }
    }

    if (btnToggleSnap) btnToggleSnap.addEventListener('click', () => toggleSnap(true));
    if (hudSnap) hudSnap.addEventListener('click', () => toggleSnap(true));

    if (btnToggleGuides) btnToggleGuides.addEventListener('click', () => toggleGuides(true));
    if (hudGuides) hudGuides.addEventListener('click', () => toggleGuides(true));

    let showBinds = localStorage.getItem('oa_canvas_show_binds') !== 'false';
    const btnToggleBinds = document.getElementById('canvas-toggle-binds');
    const hudBinds = document.getElementById('canvas-hud-binds');

    function toggleBindsVisibility(showToast = true) {
      showBinds = !showBinds;
      updateBindsVisibility(showToast);
    }

    function updateBindsVisibility(showToast = false) {
      if (view) view.classList.toggle('hide-binds', !showBinds);
      if (world) world.classList.toggle('hide-binds', !showBinds);

      if (hudBinds) {
        hudBinds.classList.toggle('is-active', showBinds);
        hudBinds.title = `Visor de Variáveis CSV {{}}: ${showBinds ? 'Ligado' : 'Desligado'} (Atalho: B ou ⌥V)`;
        hudBinds.innerHTML = `<i data-lucide="${showBinds ? 'variable' : 'eye-off'}" style="width: 15px; height: 15px;"></i>`;
      }
      if (btnToggleBinds) {
        btnToggleBinds.classList.toggle('is-active', showBinds);
        btnToggleBinds.title = `Visor de Variáveis CSV {{}}: ${showBinds ? 'Ligado' : 'Desligado'} (Atalho: B)`;
        btnToggleBinds.innerHTML = `<i data-lucide="${showBinds ? 'variable' : 'eye-off'}" style="width: 16px; height: 16px;"></i>`;
      }
      if (window.lucide) lucide.createIcons();
      localStorage.setItem('oa_canvas_show_binds', showBinds);
      if (showToast) {
        toast.info(showBinds ? 'Visor de variáveis CSV {{}} ligado' : 'Visor de variáveis CSV {{}} desligado');
      }
    }

    if (btnToggleBinds) {
      updateBindsVisibility();
      btnToggleBinds.addEventListener('click', () => toggleBindsVisibility(true));
    }
    if (hudBinds) {
      updateBindsVisibility();
      hudBinds.addEventListener('click', () => toggleBindsVisibility(true));
    }

    /* --------------------------------------------------
       Atalhos de Teclado (Figma/Canva Standard)
       -------------------------------------------------- */
    window.addEventListener('keydown', (e) => {
      const isTyping = document.activeElement && 
        (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

      if (e.code === 'Space' && !e.repeat && !isTyping) {
        isSpacePressed = true;
        view.classList.add('is-space-grab');
      }

      if ((e.key === 'Alt' || e.key === 'Control') && !isTyping) {
        setMeasureActive(true);
      }
    });

    function setMeasureActive(active) {
      if (isMeasureKeyActive === active) return;
      isMeasureKeyActive = active;
      if (active) {
        updateMeasureGuides(lastMouseClientPos);
      } else {
        clearMeasureGuides();
      }
    }

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        isSpacePressed = false;
        view.classList.remove('is-space-grab', 'is-space-grabbing');
      }
      if (e.key === 'Alt' || e.key === 'Control') {
        setMeasureActive(false);
      }
    });

    window.addEventListener('mousemove', (e) => {
      lastMouseClientPos = { clientX: e.clientX, clientY: e.clientY };
      const isTyping = document.activeElement && 
        (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

      const modifierHeld = (e.altKey || (e.ctrlKey && !e.metaKey)) && !isTyping;
      if (modifierHeld) {
        if (!isMeasureKeyActive) {
          isMeasureKeyActive = true;
        }
        updateMeasureGuides(lastMouseClientPos);
      } else if (isMeasureKeyActive) {
        setMeasureActive(false);
      }
    });

    window.addEventListener('blur', () => {
      setMeasureActive(false);
      isSpacePressed = false;
      view.classList.remove('is-space-grab', 'is-space-grabbing');
    });

    window.addEventListener('focus', () => {
      setMeasureActive(false);
    });

    document.addEventListener('keydown', (e) => {
      if (!view.classList.contains('is-open')) return;

      if (contextMenuEl && contextMenuEl.classList.contains('is-open')) {
        if (e.key === 'Escape') {
          hideContextMenu();
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      if (repositioningFrameId) {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          exitFrameBgRepositionMode();
          return;
        }
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          const frame = frames.find(f => f.id === repositioningFrameId);
          if (frame) {
            const step = e.shiftKey ? 5 : 1;
            let currentX = frame.bgPosX != null ? frame.bgPosX : 50;
            let currentY = frame.bgPosY != null ? frame.bgPosY : 50;
            if (e.key === 'ArrowUp') currentY = Math.max(0, currentY - step);
            if (e.key === 'ArrowDown') currentY = Math.min(100, currentY + step);
            if (e.key === 'ArrowLeft') currentX = Math.max(0, currentX - step);
            if (e.key === 'ArrowRight') currentX = Math.min(100, currentX + step);
            frame.bgPosX = currentX;
            frame.bgPosY = currentY;
            applyFrameBackground(frame);
            updateBgRepositionToolbar();
            save();
            return;
          }
        }
      }

      /* Atalhos de Alinhamento & Rotação: ⌥H (Centro H), ⌥V (Centro V), ⌥C (Centro Total), ⌥R (Girar 90°) */
      if (e.altKey && !e.metaKey && !e.ctrlKey && selectedChildNodes.length > 0) {
        const k = e.key.toLowerCase();
        if (k === 'h' || e.code === 'KeyH') { e.preventDefault(); e.stopPropagation(); alignSelectedNodes('center-h'); return; }
        if (k === 'v' || e.code === 'KeyV') { e.preventDefault(); e.stopPropagation(); alignSelectedNodes('center-v'); return; }
        if (k === 'c' || e.code === 'KeyC') { e.preventDefault(); e.stopPropagation(); alignSelectedNodes('center-both'); return; }
        if (k === 'r' || e.code === 'KeyR') {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) rotateSelectedNodes('reset');
          else rotateSelectedNodes(90);
          return;
        }
      }

      /* ⌘Z / Ctrl+Z (Undo) e ⌘Shift+Z / Ctrl+Shift+Z / ⌘Y / Ctrl+Y (Redo) */
      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === 'z') {
          const isTyping = document.activeElement && 
            (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT');
          if (!isTyping) {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) redo();
            else undo();
            return;
          }
        }
        if (k === 'y') {
          const isTyping = document.activeElement && 
            (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT');
          if (!isTyping) {
            e.preventDefault();
            e.stopPropagation();
            redo();
            return;
          }
        }
      }

      /* ⌘B/I/U valem mesmo com o cursor dentro do texto */
      if ((e.metaKey || e.ctrlKey) && selectedChildNodes.length > 0) {
        const k = e.key.toLowerCase();
        if (k === 'b') { e.preventDefault(); e.stopPropagation(); toggleBold(); return; }
        if (k === 'i') { e.preventDefault(); e.stopPropagation(); applyTextToolbarAction(c => c.italic = !c.italic); return; }
        if (k === 'u') { e.preventDefault(); e.stopPropagation(); applyTextToolbarAction(c => c.underline = !c.underline); return; }
        // Camadas com modificador: ⌘] (topo) e ⌘[ (fundo)
        if (e.key === ']') { e.preventDefault(); e.stopPropagation(); bringChildToFront(); return; }
        if (e.key === '[') { e.preventDefault(); e.stopPropagation(); sendChildToBack(); return; }
      }

      // Se o usuário estiver ativamente digitando num texto ou input, não intercepta atalhos simples (letras, Delete, Backspace, Setas)
      const isTyping = document.activeElement && 
        (document.activeElement.isContentEditable || 
         document.activeElement.tagName === 'INPUT' || 
         document.activeElement.tagName === 'TEXTAREA');

      if (isTyping) {
        if (e.key === 'Escape') {
          document.activeElement.blur();
          e.preventDefault();
        }
        return;
      }

      // Atalho 'B' ou '⌥V' para alternar visibilidade das tags {{}} de variáveis
      if ((!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'b') || (e.altKey && e.key.toLowerCase() === 'v')) {
        e.preventDefault();
        e.stopPropagation();
        toggleBindsVisibility(true);
        return;
      }

      // Atalho '⌥T' para resetar e fixar a barra de edição de volta no elemento
      if (e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof resetToolbarToElement === 'function') resetToolbarToElement(false);
        return;
      }

      const hasChildren = selectedChildNodes.length > 0;
      const hasFrames = selectedFrameIds.size > 0;

      // Atalhos de camada simples (sem Cmd/Ctrl): ] (avançar 1) e [ (recuar 1)
      if (!e.metaKey && !e.ctrlKey && hasChildren) {
        if (e.key === ']') {
          e.preventDefault();
          e.stopPropagation();
          bringChildForward();
          return;
        }
        if (e.key === '[') {
          e.preventDefault();
          e.stopPropagation();
          sendChildBackward();
          return;
        }
      }

      if (!hasChildren && !hasFrames && selectedLinkId === null) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        if (hasChildren) deleteTextNode();
        else if (selectedLinkId !== null) deleteLink(selectedLinkId);
        else if (hasFrames) deleteFrame(selectedId);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        if (!hasChildren && !hasFrames) return;
        copySelectedElements();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x') {
        if (!hasChildren && !hasFrames) return;
        e.preventDefault();
        e.stopPropagation();
        copySelectedElements();
        if (hasChildren) deleteTextNode();
        else if (hasFrames) deleteFrame(selectedId);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        if (!hasChildren && !hasFrames) return;
        e.preventDefault();
        e.stopPropagation();
        if (hasChildren) duplicateTextNode();
        else if (hasFrames) duplicateFrame(selectedId);
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        /* Movimentação precisa por pixel (Nudge) com as setas do teclado:
           Seta pura move 1px. Shift + Seta move 10px (Super Nudge).
           Prevenção em fase de captura para impedir que o Chromium mude de aba/tab. */
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const step = e.shiftKey ? 10 : 1;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        else if (e.key === 'ArrowRight') dx = step;
        else if (e.key === 'ArrowUp') dy = -step;
        else if (e.key === 'ArrowDown') dy = step;

        if (hasChildren) {
          selectedChildNodes.forEach(sel => {
            const f = frames.find(fr => fr.id === sel.frameId);
            if (!f) return;
            const child = (f.children || []).find(c => c.id === sel.childId);
            if (!child) return;
            child.x += dx;
            child.y += dy;
            const cEl = nodeElement(child.id);
            if (cEl) {
              cEl.style.left = `${child.x}px`;
              cEl.style.top = `${child.y}px`;
            }
          });
          updateTextToolbar();
          if (isMeasureKeyActive) updateMeasureGuides(lastMouseClientPos);
          saveQuiet(); // seta segurada repete: mesmo caso do arrasto
          return;
        } else if (hasFrames) {
          const framesToMove = getSelectedFrames();
          framesToMove.forEach(f => {
            f.x += dx;
            f.y += dy;
            const fEl = frameElOf(f);
            if (fEl) {
              fEl.style.left = `${f.x}px`;
              fEl.style.top = `${f.y}px`;
            }
          });
          wakeRopes();
          if (isMeasureKeyActive) updateMeasureGuides(lastMouseClientPos);
          saveQuiet(); // seta segurada repete: mesmo caso do arrasto
          return;
        }
      } else if (!e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 't' && hasFrames) {
        e.preventDefault();
        e.stopPropagation();
        addTextToSelectedFrame();
      } else if (e.key === 'Enter') {
        if (croppingImage) {
          e.preventDefault();
          e.stopPropagation();
          exitCropMode();
          return;
        }
        const child = selectedChild();
        if (child && child.type === 'image') {
          e.preventDefault();
          e.stopPropagation();
          enterCropMode(selectedTextNode.frameId, child.id);
          return;
        }
      } else if (!e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 'c' && !croppingImage) {
        const child = selectedChild();
        if (child && child.type === 'image') {
          e.preventDefault();
          enterCropMode(selectedTextNode.frameId, child.id);
          return;
        }
      }
    });

    /* No produto standalone o canvas está sempre aberto; a função continua
       existindo porque o Esc do teclado e outros fluxos chamam toggleCanvas. */
    function toggleCanvas(open) {
      const isOpen = open === undefined ? !view.classList.contains('is-open') : open;
      view.classList.toggle('is-open', isOpen);
      if (isOpen) {
        applyCamera();
        wakeRopes();
      }
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && view.classList.contains('is-open')) {
        // 1. Fecha qualquer modal aberto
        const openModal = document.querySelector('.modal-overlay.open, #canvas-batch-modal.open');
        if (openModal) {
          openModal.classList.remove('open', 'is-open');
          if (typeof window.closeBatchModal === 'function') window.closeBatchModal();
          return;
        }

        // 2. Fecha dropdowns abertos
        const openDropdown = document.querySelector('.canvas-dropdown-card.is-open');
        if (openDropdown) {
          closeAllDropdowns();
          return;
        }

        // 3. No modo de recorte, o primeiro Escape encerra o recorte e salva
        if (croppingImage) {
          exitCropMode();
          return;
        }

        // 4. Editando um texto: o primeiro Escape só sai da edição, mantendo a seleção
        if (document.activeElement && document.activeElement.classList.contains('canvas-text-node__content')) {
          exitTextEditing(document.activeElement);
          return;
        }

        // 5. Desseleciona nós filhos (texto, imagem, gradiente)
        if (selectedChildNodes.length > 0 || (selectedTextNode && selectedTextNode.childId !== null)) {
          selectTextNode(null, null);
          return;
        }

        // 6. Desseleciona conexões de carrossel
        if (selectedLinkId !== null) {
          selectLink(null);
          return;
        }

        // 7. Desseleciona frames
        if (selectedFrameIds.size > 0 || selectedId !== null) {
          selectFrame(null);
          return;
        }

        // 8. ESC no canvas vazio: apenas tira foco ativo sem sair do app
        if (document.activeElement && document.activeElement !== document.body) {
          document.activeElement.blur();
        }
      }
    });

    /* --------------------------------------------------
       Batch Create Controller (Motor de Criação em Lote)
       -------------------------------------------------- */
    /* A tabela do modal é a fonte da verdade: cada record já vem chaveado pelo
       nome do bind, então não existe mais etapa de "mapear coluna" (e nem o bug
       de apontar um {{bind}} de imagem para uma coluna de texto). O CSV virou
       só um atalho de preenchimento. */
    let batchData = {
      binds: [],              // snapshot dos binds na última renderização da tabela
      records: [],            // [{ bindName: valor }] — valor de imagem é data URL
      csv: null,              // último { headers, rows } importado, para repontar colunas
      csvPick: {},            // bindName -> header do CSV que alimenta a coluna
      originalTemplateSnapshot: null,
      previewRowIndex: null
    };

    function isImageSrcValue(v) {
      return typeof v === 'string' && /^(data:image\/|blob:|https?:\/\/)/i.test(v.trim());
    }

    function parseCSV(text) {
      const rows = [];
      let currentRow = [];
      let currentCell = '';
      let insideQuotes = false;

      const firstLine = text.split(/\r\n|\n/)[0] || '';
      const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
          if (insideQuotes && nextChar === '"') {
            currentCell += '"';
            i++;
          } else {
            insideQuotes = !insideQuotes;
          }
        } else if (char === delimiter && !insideQuotes) {
          currentRow.push(currentCell.trim());
          currentCell = '';
        } else if ((char === '\r' || char === '\n') && !insideQuotes) {
          if (char === '\r' && nextChar === '\n') i++;
          currentRow.push(currentCell.trim());
          if (currentRow.some(c => c.length > 0)) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentCell = '';
        } else {
          currentCell += char;
        }
      }
      if (currentCell.length > 0 || currentRow.length > 0) {
        currentRow.push(currentCell.trim());
        if (currentRow.some(c => c.length > 0)) {
          rows.push(currentRow);
        }
      }
      if (rows.length === 0) return { headers: [], rows: [] };
      const headers = rows[0].map((h, idx) => h || `coluna_${idx + 1}`);
      const dataRows = rows.slice(1).map(r => {
        const obj = {};
        headers.forEach((h, idx) => {
          obj[h] = r[idx] !== undefined ? r[idx] : '';
        });
        return obj;
      });
      return { headers, rows: dataRows };
    }

    /* `assumeHeader`: true força a primeira linha como cabeçalho (arquivo .csv
       sempre tem uma), 'auto' deduz pelos binds (colagem do Sheets pode vir só
       com as células de dados selecionadas). */
    function parseTSVOrCSV(text, assumeHeader = 'auto') {
      if (!text || typeof text !== 'string') return { headers: [], rows: [], hasRealHeaders: false };
      const clean = text.trim();
      if (!clean) return { headers: [], rows: [], hasRealHeaders: false };

      const isTSV = clean.includes('\t');
      const firstLine = clean.split(/\r\n|\n/)[0] || '';
      let delimiter = '\t';
      if (!isTSV) {
        delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
      }

      const rows = [];
      let currentRow = [];
      let currentCell = '';
      let insideQuotes = false;

      for (let i = 0; i < clean.length; i++) {
        const char = clean[i];
        const nextChar = clean[i + 1];

        if (char === '"') {
          if (insideQuotes && nextChar === '"') {
            currentCell += '"';
            i++;
          } else {
            insideQuotes = !insideQuotes;
          }
        } else if (char === delimiter && !insideQuotes) {
          currentRow.push(currentCell.trim());
          currentCell = '';
        } else if ((char === '\r' || char === '\n') && !insideQuotes) {
          if (char === '\r' && nextChar === '\n') i++;
          currentRow.push(currentCell.trim());
          if (currentRow.some(c => c.length > 0)) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentCell = '';
        } else {
          currentCell += char;
        }
      }
      if (currentCell.length > 0 || currentRow.length > 0) {
        currentRow.push(currentCell.trim());
        if (currentRow.some(c => c.length > 0)) {
          rows.push(currentRow);
        }
      }

      if (rows.length === 0) return { headers: [], rows: [], hasRealHeaders: false };

      const binds = (typeof getCanvasBinds === 'function') ? getCanvasBinds() : [];
      const firstRow = rows[0];
      const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const bindsNorm = binds.map(b => norm(b.name));

      const firstRowMatchesBind = assumeHeader === true || (assumeHeader !== false && firstRow.some(cell => {
        const c = norm(cell);
        return c && bindsNorm.some(b => b === c || b.includes(c) || c.includes(b));
      }));

      let headers = [];
      let dataRows = [];

      if (firstRowMatchesBind && rows.length > 1) {
        headers = firstRow.map((h, idx) => h || `coluna_${idx + 1}`);
        dataRows = rows.slice(1).map(r => {
          const obj = {};
          headers.forEach((h, idx) => {
            obj[h] = r[idx] !== undefined ? r[idx] : '';
          });
          return obj;
        });
      } else {
        headers = firstRow.map((_, idx) => `coluna_${idx + 1}`);
        dataRows = rows.map(r => {
          const obj = {};
          headers.forEach((h, idx) => {
            obj[h] = r[idx] !== undefined ? r[idx] : '';
          });
          return obj;
        });
      }

      return { headers, rows: dataRows, hasRealHeaders: firstRowMatchesBind && rows.length > 1 };
    }

    function initBatchCreateController() {
      const modal = document.getElementById('canvas-batch-modal');
      const openBtn = document.getElementById('canvas-batch-btn');
      const closeBtn = document.getElementById('canvas-batch-close');
      const csvInput = document.getElementById('canvas-batch-csv-input');
      const imagesInput = document.getElementById('canvas-batch-images-input');
      const importBtn = document.getElementById('canvas-batch-import-btn');
      const pasteBtn = document.getElementById('canvas-batch-paste-btn');
      const addRowBtn = document.getElementById('canvas-batch-add-row');
      const gridWrap = document.getElementById('canvas-batch-gridwrap');
      const grid = document.getElementById('canvas-batch-grid');
      const hint = document.getElementById('canvas-batch-hint');
      const footInfo = document.getElementById('canvas-batch-foot-info');
      const startBtn = document.getElementById('canvas-batch-start-btn');
      const startLabel = document.getElementById('canvas-batch-start-label');
      const summaryBox = document.getElementById('canvas-batch-summary');

      // Elementos do Funil em 3 Passos
      const stepNav1 = document.getElementById('canvas-batch-step-nav-1');
      const stepNav2 = document.getElementById('canvas-batch-step-nav-2');
      const stepNav3 = document.getElementById('canvas-batch-step-nav-3');
      const viewStep1 = document.getElementById('canvas-batch-view-1');
      const viewStep2 = document.getElementById('canvas-batch-view-2');
      const viewStep3 = document.getElementById('canvas-batch-view-3');
      const titleEl = document.getElementById('canvas-batch-title');
      const subEl = document.getElementById('canvas-batch-sub');
      const prevStepBtn = document.getElementById('canvas-batch-prev-step-btn');
      const nextStepBtn = document.getElementById('canvas-batch-next-step-btn');
      const bindsStatusWrap = document.getElementById('canvas-batch-binds-status');
      const summaryHero = document.getElementById('canvas-batch-summary-hero');
      const btnGenCanvas = document.getElementById('canvas-batch-generate-canvas-btn');
      const labelGenCanvas = document.getElementById('canvas-batch-generate-canvas-label');
      const scaleSelect = document.getElementById('canvas-batch-scale');
      const formatSelect = document.getElementById('canvas-batch-format');
      const progressBox = document.getElementById('canvas-batch-progress');
      const progressText = document.getElementById('canvas-batch-progress-text');
      const progressPct = document.getElementById('canvas-batch-progress-pct');
      const progressFill = document.getElementById('canvas-batch-progress-fill');

      if (!modal || !openBtn) return;

      let currentBatchStep = 1;

      function setBatchStep(step) {
        currentBatchStep = step;

        if (viewStep1) viewStep1.style.display = step === 1 ? 'flex' : 'none';
        if (viewStep2) viewStep2.style.display = step === 2 ? 'flex' : 'none';
        if (viewStep3) viewStep3.style.display = step === 3 ? 'flex' : 'none';

        [stepNav1, stepNav2, stepNav3].forEach((btn, idx) => {
          if (!btn) return;
          const s = idx + 1;
          btn.classList.toggle('is-active', s === step);
          btn.classList.toggle('is-done', s < step);
        });

        if (step === 1) {
          if (titleEl) titleEl.textContent = 'Elementos Dinâmicos';
          if (subEl) subEl.textContent = 'Defina quais textos e fotos mudam em cada post';
          if (prevStepBtn) prevStepBtn.style.display = 'none';
          if (nextStepBtn) {
            nextStepBtn.style.display = 'inline-flex';
            const span = nextStepBtn.querySelector('span');
            if (span) span.textContent = 'Continuar para o Conteúdo';
          }
          renderStep1BindsStatus();
        } else if (step === 2) {
          if (titleEl) titleEl.textContent = 'Preencher Conteúdo';
          if (subEl) subEl.textContent = 'Digite ou cole os dados para gerar seus novos posts';
          if (prevStepBtn) {
            prevStepBtn.style.display = 'inline-flex';
            const span = prevStepBtn.querySelector('span');
            if (span) span.textContent = 'Voltar para Elementos';
          }
          if (nextStepBtn) {
            nextStepBtn.style.display = 'inline-flex';
            const span = nextStepBtn.querySelector('span');
            if (span) span.textContent = 'Avançar para Gerar';
          }
          renderBatchGrid();
          updateBatchFooter();
        } else if (step === 3) {
          if (titleEl) titleEl.textContent = 'Gerar Posts';
          if (subEl) subEl.textContent = 'Escolha onde você deseja gerar o resultado';
          if (prevStepBtn) {
            prevStepBtn.style.display = 'inline-flex';
            const span = prevStepBtn.querySelector('span');
            if (span) span.textContent = 'Voltar para a Tabela';
          }
          if (nextStepBtn) {
            nextStepBtn.style.display = 'none';
          }
          renderStep3Summary();
          updateBatchFooter();
        }

        if (window.lucide) lucide.createIcons();
      }

      if (stepNav1) stepNav1.addEventListener('click', () => setBatchStep(1));
      if (stepNav2) stepNav2.addEventListener('click', () => setBatchStep(2));
      if (stepNav3) stepNav3.addEventListener('click', () => {
        if (batchData.records.length === 0) {
          batchData.records.push(blankRecord(getCanvasBinds()));
        }
        setBatchStep(3);
      });

      if (prevStepBtn) {
        prevStepBtn.addEventListener('click', () => {
          if (currentBatchStep === 2) setBatchStep(1);
          else if (currentBatchStep === 3) setBatchStep(2);
        });
      }

      if (nextStepBtn) {
        nextStepBtn.addEventListener('click', () => {
          if (currentBatchStep === 1) {
            const binds = getCanvasBinds();
            if (binds.length === 0) {
              // Auto-conecta textos existentes no frame para não travar o usuário
              const anchor = selectedFrame() || frames[0];
              const textChildren = (anchor && anchor.children) ? anchor.children.filter(c => c.type === 'text') : [];
              if (textChildren.length > 0) {
                textChildren.forEach((c, idx) => {
                  if (!c.bind) {
                    const defaultName = idx === 0 ? 'titulo' : idx === 1 ? 'subtitulo' : `texto_${idx + 1}`;
                    c.bind = slugifyBind(c.text) || defaultName;
                    const el = nodeElement(c.id);
                    if (el) paintBind(c, el);
                  }
                });
                updateTextToolbar();
                save();
              }
            }
            setBatchStep(2);
          } else if (currentBatchStep === 2) {
            if (batchData.records.length === 0) {
              batchData.records.push(blankRecord(getCanvasBinds()));
            }
            setBatchStep(3);
          }
        });
      }

      openBtn.addEventListener('click', () => {
        if (modal.classList.contains('open')) {
          closeBatchModal();
        } else {
          openBatchModal();
        }
      });
      if (closeBtn) closeBtn.addEventListener('click', closeBatchModal);

      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeBatchModal();
      });

      /* ----------------------------------------------------
         Colar direto do Google Sheets ou Excel no Modal (⌘V)
         ---------------------------------------------------- */
      modal.addEventListener('paste', (e) => {
        if (!modal.classList.contains('open')) return;
        const text = (e.clipboardData || window.clipboardData)?.getData('text/plain')?.trim();
        if (text && (text.includes('\t') || (text.includes('\n') && (text.includes(',') || text.includes(';'))))) {
          e.preventDefault();
          e.stopPropagation();
          handleTableText(text, 'Google Sheets / Excel');
        }
      });

      // ----------------------------------------------------
      // TABELA EDITÁVEL (fonte da verdade do lote)
      // ----------------------------------------------------
      let pendingImageTarget = null; // { rowIndex, bindName } | { column: bindName }

      function readFileAsDataURL(file) {
        return new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = ev => resolve(ev.target.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        });
      }

      function blankRecord(binds) {
        const rec = {};
        binds.forEach(b => { rec[b.name] = ''; });
        return rec;
      }

      /* CSV/TSV: casa header com bind por nome (exato antes de parcial). */
      function matchHeaderForBind(bindName, headers) {
        const normBind = bindName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const norm = h => h.toLowerCase().replace(/[^a-z0-9]/g, '');
        const exact = headers.find(h => norm(h) === normBind);
        if (exact) return exact;
        return headers.find(h => norm(h).includes(normBind) || normBind.includes(norm(h))) || '';
      }

      function handleTableText(text, sourceName = 'Tabela', assumeHeader = 'auto') {
        if (!text || typeof text !== 'string') return false;
        const parsed = parseTSVOrCSV(text, assumeHeader);
        if (!parsed.headers.length || !parsed.rows.length) {
          if (hint) hint.innerHTML = `<span style="color: #EF4444;">Formato de tabela vazio ou não reconhecido.</span>`;
          return false;
        }

        const binds = getCanvasBinds();
        batchData.csv = parsed;
        batchData.csvPick = {};

        if (parsed.hasRealHeaders) {
          binds.forEach(b => {
            batchData.csvPick[b.name] = matchHeaderForBind(b.name, parsed.headers);
          });
        } else {
          // Se não vieram cabeçalhos, mapeia na ordem sequencial das variáveis
          binds.forEach((b, idx) => {
            if (idx < parsed.headers.length) {
              batchData.csvPick[b.name] = parsed.headers[idx];
            }
          });
        }

        batchData.records = parsed.rows.map(() => blankRecord(binds));
        binds.forEach(b => fillColumnFromCSV(b));

        setBatchStep(2);
        renderBatchGrid();
        updateBatchFooter();

        toast.success(`✓ ${parsed.rows.length} ${parsed.rows.length === 1 ? 'post carregado' : 'posts carregados'} com sucesso!`);
        return true;
      }

      if (pasteBtn) {
        pasteBtn.addEventListener('click', async () => {
          try {
            if (navigator.clipboard && navigator.clipboard.readText) {
              const text = await navigator.clipboard.readText();
              if (text && (text.includes('\t') || text.includes('\n') || text.includes(','))) {
                const ok = handleTableText(text, 'Google Sheets / Excel');
                if (ok) return;
              }
            }
          } catch (err) {}
          toast.info('Pressione ⌘V para colar sua tabela do Sheets / Excel.');
        });
      }

      if (importBtn && csvInput) {
        importBtn.addEventListener('click', () => csvInput.click());
        csvInput.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (file) handleCSVFile(file);
          csvInput.value = '';
        });
      }

      if (addRowBtn) {
        addRowBtn.addEventListener('click', () => {
          batchData.records.push(blankRecord(getCanvasBinds()));
          renderBatchGrid();
          updateBatchFooter();
          if (gridWrap) gridWrap.scrollTop = gridWrap.scrollHeight;
        });
      }

      // Soltar um .csv em cima da tabela preenche tudo
      if (gridWrap) {
        gridWrap.addEventListener('dragover', (e) => {
          if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          gridWrap.classList.add('is-dragover');
        });
        gridWrap.addEventListener('dragleave', () => gridWrap.classList.remove('is-dragover'));
        gridWrap.addEventListener('drop', (e) => {
          const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (!file) return;
          gridWrap.classList.remove('is-dragover');
          if (file.name.toLowerCase().endsWith('.csv') || file.type.includes('csv')) {
            e.preventDefault();
            handleCSVFile(file);
          }
        });
      }

      // Seletor de fotos: serve tanto para uma célula quanto para a coluna toda
      if (imagesInput) {
        imagesInput.addEventListener('change', async (e) => {
          const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
          imagesInput.value = '';
          if (!files.length || !pendingImageTarget) return;
          const target = pendingImageTarget;
          pendingImageTarget = null;

          if (target.column) {
            const urls = await Promise.all(files.map(readFileAsDataURL));
            const binds = getCanvasBinds();
            urls.forEach((url, i) => {
              if (!url) return;
              while (batchData.records.length <= i) batchData.records.push(blankRecord(binds));
              batchData.records[i][target.column] = url;
              delete batchData.records[i]['__hint_' + target.column];
            });
            toast.success(`✓ ${urls.length} fotos do computador aplicadas!`);
          } else {
            const url = await readFileAsDataURL(files[0]);
            const rec = batchData.records[target.rowIndex];
            if (url && rec) {
              rec[target.bindName] = url;
              delete rec['__hint_' + target.bindName];
            }
            toast.success('Foto aplicada com sucesso!');
          }
          renderBatchGrid();
          updateBatchFooter();
        });
      }

      // ----------------------------------------------------
      // SELETOR DE IMAGENS DE VARIÁVEL (UNSPLASH + COMPUTADOR + URL)
      // ----------------------------------------------------
      const photoModal = document.getElementById('canvas-batch-photo-modal');
      const photoCloseBtn = document.getElementById('canvas-batch-photo-close');
      const photoCancelBtn = document.getElementById('canvas-batch-photo-cancel');
      const photoTitle = document.getElementById('canvas-batch-photo-title');
      const photoSub = document.getElementById('canvas-batch-photo-sub');
      const photoTabs = document.querySelectorAll('.canvas-batch-photo-tab');
      const photoViewUnsplash = document.getElementById('canvas-batch-photo-view-unsplash');
      const photoViewUpload = document.getElementById('canvas-batch-photo-view-upload');
      const photoViewUrl = document.getElementById('canvas-batch-photo-view-url');
      const photoSearchInput = document.getElementById('canvas-batch-photo-search');
      const photoSearchClear = document.getElementById('canvas-batch-photo-search-clear');
      const photoBulkFillBtn = document.getElementById('canvas-batch-photo-bulk-fill');
      const photoBulkFillLabel = document.getElementById('canvas-batch-photo-bulk-label');
      const photoCatsWrap = document.getElementById('canvas-batch-photo-cats');
      const photoGrid = document.getElementById('canvas-batch-photo-grid');
      const photoDropzone = document.getElementById('canvas-batch-upload-dropzone');
      const photoUploadTrigger = document.getElementById('canvas-batch-upload-trigger-btn');
      const photoUrlInput = document.getElementById('canvas-batch-photo-url-input');
      const photoUrlApply = document.getElementById('canvas-batch-photo-url-apply');
      const photoUrlPreview = document.getElementById('canvas-batch-photo-url-preview');
      const photoUrlImg = document.getElementById('canvas-batch-photo-url-img');

      let currentPhotoTarget = null; // { rowIndex, bindName } | { column }
      let photoTab = 'unsplash';
      let photoQuery = '';
      let photoCategory = 'all';
      let photoLoading = false;
      let photoSeq = 0;
      let photoDebounce = null;

      function openBatchPhotoPickerModal(target) {
        currentPhotoTarget = target;
        pendingImageTarget = target;
        if (!photoModal) return;

        // Atualiza títulos
        if (target.column) {
          if (photoTitle) photoTitle.textContent = `Preencher Coluna {{${target.column}}}`;
          if (photoSub) photoSub.textContent = `Selecione fotos do Unsplash para todos os posts ou envie do computador`;
          if (photoBulkFillBtn) {
            photoBulkFillBtn.style.display = 'inline-flex';
            const count = batchData.records.length;
            if (photoBulkFillLabel) {
              photoBulkFillLabel.textContent = `Preencher os ${count} ${count === 1 ? 'post' : 'posts'} com este tema`;
            }
          }
        } else {
          if (photoTitle) photoTitle.textContent = `Escolher Foto para {{${target.bindName}}}`;
          if (photoSub) photoSub.textContent = `Post #${target.rowIndex + 1} · Escolha do Unsplash ou faça upload do computador`;
          if (photoBulkFillBtn) photoBulkFillBtn.style.display = 'none';
        }

        switchPhotoTab('unsplash');
        if (photoSearchInput) {
          photoSearchInput.value = '';
          if (photoSearchClear) photoSearchClear.style.display = 'none';
        }
        photoQuery = '';
        photoCategory = 'all';
        if (photoCatsWrap) {
          photoCatsWrap.querySelectorAll('.canvas-batch-photo-chip').forEach(c => {
            c.classList.toggle('is-active', c.dataset.cat === 'all');
          });
        }

        photoModal.classList.add('open');
        carregarFotosUnsplash();
        if (window.lucide) lucide.createIcons();
      }

      function closeBatchPhotoPickerModal() {
        if (!photoModal) return;
        photoModal.classList.remove('open');
        currentPhotoTarget = null;
      }

      function switchPhotoTab(t) {
        photoTab = t;
        photoTabs.forEach(tabBtn => {
          tabBtn.classList.toggle('is-active', tabBtn.dataset.tab === t);
        });
        if (photoViewUnsplash) photoViewUnsplash.style.display = t === 'unsplash' ? 'flex' : 'none';
        if (photoViewUpload) photoViewUpload.style.display = t === 'upload' ? 'flex' : 'none';
        if (photoViewUrl) photoViewUrl.style.display = t === 'url' ? 'flex' : 'none';
        if (window.lucide) lucide.createIcons();
      }

      photoTabs.forEach(tabBtn => {
        tabBtn.addEventListener('click', () => switchPhotoTab(tabBtn.dataset.tab));
      });

      if (photoCloseBtn) photoCloseBtn.addEventListener('click', closeBatchPhotoPickerModal);
      if (photoCancelBtn) photoCancelBtn.addEventListener('click', closeBatchPhotoPickerModal);
      if (photoModal) {
        photoModal.addEventListener('click', (e) => {
          if (e.target === photoModal) closeBatchPhotoPickerModal();
        });
      }

      // Categorias Unsplash
      const CATEGORY_QUERIES = {
        'all': '',
        'minimalist': 'minimalist clean white architecture aesthetic',
        'business': 'modern business technology startup workspace',
        'editorial': 'editorial fashion modern architecture portrait',
        'coffee': 'coffee shop cafe workspace latte aesthetic',
        'dark_moody': 'dark moody cinematic black aesthetic contrast',
        'textures': 'texture paper concrete noise abstract surface',
        'nature': 'nature landscape peaceful serene aesthetic'
      };

      if (photoCatsWrap) {
        photoCatsWrap.querySelectorAll('.canvas-batch-photo-chip').forEach(chip => {
          chip.addEventListener('click', () => {
            photoCatsWrap.querySelectorAll('.canvas-batch-photo-chip').forEach(c => c.classList.remove('is-active'));
            chip.classList.add('is-active');
            photoCategory = chip.dataset.cat;
            photoQuery = CATEGORY_QUERIES[photoCategory] || '';
            if (photoSearchInput) photoSearchInput.value = '';
            if (photoSearchClear) photoSearchClear.style.display = 'none';
            carregarFotosUnsplash();
          });
        });
      }

      if (photoSearchInput) {
        photoSearchInput.addEventListener('input', () => {
          clearTimeout(photoDebounce);
          const val = photoSearchInput.value.trim();
          if (photoSearchClear) photoSearchClear.style.display = val.length > 0 ? 'flex' : 'none';
          photoDebounce = setTimeout(() => {
            photoQuery = val;
            if (photoCatsWrap) {
              photoCatsWrap.querySelectorAll('.canvas-batch-photo-chip').forEach(c => c.classList.remove('is-active'));
            }
            carregarFotosUnsplash();
          }, 240);
        });
      }

      if (photoSearchClear && photoSearchInput) {
        photoSearchClear.addEventListener('click', () => {
          photoSearchInput.value = '';
          photoQuery = '';
          photoSearchClear.style.display = 'none';
          if (photoCatsWrap) {
            const first = photoCatsWrap.querySelector('[data-cat="all"]');
            if (first) first.classList.add('is-active');
          }
          photoSearchInput.focus();
          carregarFotosUnsplash();
        });
      }

      async function carregarFotosUnsplash() {
        if (!photoGrid) return;
        const seq = ++photoSeq;
        photoLoading = true;
        photoGrid.innerHTML = `
          <div style="grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 48px 0; color: rgba(255,255,255,0.6); font-size: 13px;">
            <i data-lucide="loader-2" class="canvas-topbar__save-spin" style="width: 18px; height: 18px;"></i>
            <span>Carregando fotos do Unsplash…</span>
          </div>
        `;
        if (window.lucide) lucide.createIcons();

        try {
          if (!window.UnsplashService) throw new Error('UnsplashService ausente');

          let res;
          if (photoQuery) {
            res = await window.UnsplashService.searchPhotos(photoQuery, { page: 1, perPage: 28 });
          } else {
            res = await window.UnsplashService.getEditorialPhotos({ page: 1, perPage: 28 });
          }

          if (seq !== photoSeq) return;

          const photos = res.results || [];
          renderUnsplashPhotoGrid(photos);
        } catch (err) {
          if (seq !== photoSeq) return;
          console.error('[Unsplash batch]', err);
          photoGrid.innerHTML = `
            <div style="grid-column: 1 / -1; padding: 40px 20px; text-align: center; color: rgba(255,255,255,0.55); font-size: 13px;">
              Não foi possível carregar as fotos do Unsplash. Verifique sua conexão ou tente outro termo.
            </div>
          `;
        } finally {
          photoLoading = false;
        }
      }

      function renderUnsplashPhotoGrid(photos) {
        if (!photoGrid) return;
        photoGrid.innerHTML = '';

        if (!photos || photos.length === 0) {
          photoGrid.innerHTML = `
            <div style="grid-column: 1 / -1; padding: 48px 20px; text-align: center; color: rgba(255,255,255,0.55); font-size: 13px;">
              Nenhuma foto encontrada para esta busca. Tente palavras em português ou inglês (ex: <em>café, minimalista, escritório, tecnologia</em>).
            </div>
          `;
          return;
        }

        photos.forEach(photo => {
          if (!photo || !photo.urls) return;
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'canvas-batch-photo-card';
          card.title = `${photo.description || 'Foto Unsplash'} por ${(photo.author && photo.author.name) || 'Unsplash'}`;

          const img = document.createElement('img');
          img.src = photo.urls.small || photo.urls.regular;
          img.alt = photo.description || 'Unsplash';
          img.loading = 'lazy';
          card.appendChild(img);

          const author = document.createElement('div');
          author.className = 'canvas-batch-photo-author';
          author.textContent = `📷 ${(photo.author && photo.author.name) || 'Unsplash'}`;
          card.appendChild(author);

          card.addEventListener('click', async () => {
            card.classList.add('is-busy');
            try {
              const photoData = await window.UnsplashService.downloadPhotoAsDataUrl(photo, 'regular', 1080);
              aplicarFotoNoTarget(photoData.dataUrl);
            } catch (e) {
              console.error('Falha ao baixar foto:', e);
              toast.error('Erro ao carregar foto do Unsplash.');
            } finally {
              card.classList.remove('is-busy');
            }
          });

          photoGrid.appendChild(card);
        });
      }

      // Preenchimento em Lote Inteligente para a Coluna Inteira
      if (photoBulkFillBtn) {
        photoBulkFillBtn.addEventListener('click', async () => {
          if (!currentPhotoTarget || !currentPhotoTarget.column) return;
          const colName = currentPhotoTarget.column;
          const count = batchData.records.length;
          photoBulkFillBtn.disabled = true;
          const originalText = photoBulkFillLabel ? photoBulkFillLabel.textContent : '';
          if (photoBulkFillLabel) photoBulkFillLabel.textContent = 'Baixando fotos…';

          try {
            if (!window.UnsplashService) throw new Error('UnsplashService ausente');
            let res;
            if (photoQuery) {
              res = await window.UnsplashService.searchPhotos(photoQuery, { page: 1, perPage: Math.max(count, 12) });
            } else {
              res = await window.UnsplashService.getEditorialPhotos({ page: 1, perPage: Math.max(count, 12) });
            }

            const photos = (res.results || []).slice(0, count);
            if (photos.length === 0) {
              toast.info('Nenhuma foto encontrada para preencher.');
              return;
            }

            // Baixa todas em paralelo
            const downloadedUrls = await Promise.all(
              photos.map(p => window.UnsplashService.downloadPhotoAsDataUrl(p, 'regular', 1080).then(d => d.dataUrl).catch(() => null))
            );

            downloadedUrls.forEach((url, idx) => {
              if (url && batchData.records[idx]) {
                batchData.records[idx][colName] = url;
                delete batchData.records[idx]['__hint_' + colName];
              }
            });

            renderBatchGrid();
            updateBatchFooter();
            closeBatchPhotoPickerModal();
            toast.success(`✓ ${downloadedUrls.filter(Boolean).length} fotos do Unsplash aplicadas na coluna {{${colName}}}!`);
          } catch (e) {
            console.error('Falha no preenchimento em lote do Unsplash:', e);
            toast.error('Não foi possível preencher as fotos em lote.');
          } finally {
            photoBulkFillBtn.disabled = false;
            if (photoBulkFillLabel) photoBulkFillLabel.textContent = originalText;
          }
        });
      }

      // Aplicar foto para a célula ou coluna
      function aplicarFotoNoTarget(dataUrl) {
        if (!currentPhotoTarget || !dataUrl) return;
        const target = currentPhotoTarget;

        if (target.column) {
          if (batchData.records.length > 0) {
            batchData.records[0][target.column] = dataUrl;
            delete batchData.records[0]['__hint_' + target.column];
          }
          toast.success(`Foto do Unsplash aplicada para a coluna {{${target.column}}}!`);
        } else {
          const rec = batchData.records[target.rowIndex];
          if (rec) {
            rec[target.bindName] = dataUrl;
            delete rec['__hint_' + target.bindName];
          }
          toast.success(`Foto do Unsplash aplicada para o Post #${target.rowIndex + 1}!`);
        }

        renderBatchGrid();
        updateBatchFooter();
        closeBatchPhotoPickerModal();
      }

      // Upload do Computador
      if (photoUploadTrigger) {
        photoUploadTrigger.addEventListener('click', () => {
          imagesInput.click();
          closeBatchPhotoPickerModal();
        });
      }

      if (photoDropzone) {
        photoDropzone.addEventListener('click', () => {
          imagesInput.click();
          closeBatchPhotoPickerModal();
        });
        photoDropzone.addEventListener('dragover', (e) => {
          e.preventDefault();
          photoDropzone.classList.add('is-dragover');
        });
        photoDropzone.addEventListener('dragleave', () => photoDropzone.classList.remove('is-dragover'));
        photoDropzone.addEventListener('drop', async (e) => {
          e.preventDefault();
          photoDropzone.classList.remove('is-dragover');
          const files = Array.from(e.dataTransfer && e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
          if (!files.length || !currentPhotoTarget) return;

          const target = currentPhotoTarget;
          if (target.column) {
            const urls = await Promise.all(files.map(readFileAsDataURL));
            const binds = getCanvasBinds();
            urls.forEach((url, i) => {
              if (!url) return;
              while (batchData.records.length <= i) batchData.records.push(blankRecord(binds));
              batchData.records[i][target.column] = url;
              delete batchData.records[i]['__hint_' + target.column];
            });
            toast.success(`✓ ${urls.length} fotos do computador carregadas!`);
          } else {
            const url = await readFileAsDataURL(files[0]);
            const rec = batchData.records[target.rowIndex];
            if (url && rec) {
              rec[target.bindName] = url;
              delete rec['__hint_' + target.bindName];
            }
            toast.success('Foto carregada do computador!');
          }

          renderBatchGrid();
          updateBatchFooter();
          closeBatchPhotoPickerModal();
        });
      }

      // Inserção por URL Direta
      if (photoUrlApply && photoUrlInput) {
        photoUrlApply.addEventListener('click', () => {
          const url = photoUrlInput.value.trim();
          if (!url) {
            toast.info('Cole uma URL de imagem válida.');
            return;
          }
          aplicarFotoNoTarget(url);
          photoUrlInput.value = '';
        });
        photoUrlInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            photoUrlApply.click();
          }
        });
      }

      function handleCSVFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          handleTableText(e.target.result, file.name, true);
        };
        reader.readAsText(file, 'UTF-8');
      }

      /* Repontar uma coluna reescreve só ela: o que foi digitado nas outras fica. */
      function fillColumnFromCSV(bind) {
        if (!batchData.csv) return;
        const col = batchData.csvPick[bind.name];
        batchData.csv.rows.forEach((row, i) => {
          const rec = batchData.records[i];
          if (!rec) return;
          const raw = col ? String(row[col] !== undefined ? row[col] : '') : '';
          if (bind.type === 'image') {
            rec[bind.name] = isImageSrcValue(raw) ? raw : (rec[bind.name] || '');
            if (raw && !isImageSrcValue(raw)) rec['__hint_' + bind.name] = raw;
            else delete rec['__hint_' + bind.name];
          } else {
            rec[bind.name] = raw;
          }
        });
      }

      function renderStep1BindsStatus() {
        if (!bindsStatusWrap) return;
        const binds = getCanvasBinds();
        const anchor = selectedFrame() || frames[0];
        bindsStatusWrap.innerHTML = '';

        if (binds.length > 0) {
          const count = binds.length;
          const card = document.createElement('div');
          card.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding: 0 4px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: #10B981; color: #FFF; font-size: 11px; font-weight: bold;">✓</span>
                <strong style="font-size: 13.5px; color: #FFF;">${count} ${count === 1 ? 'variável identificada' : 'variáveis identificadas'} no template</strong>
              </div>
              <span style="font-size: 11.5px; color: rgba(255,255,255,0.5);">Pronto para preencher posts</span>
            </div>
            <div class="canvas-batch-var-list">
              ${binds.map(b => `
                <div class="canvas-batch-var-card">
                  <div class="canvas-batch-var-card-icon ${b.type === 'image' ? 'is-img' : ''}">
                    ${b.type === 'image' ? '🖼️' : 'T'}
                  </div>
                  <div class="canvas-batch-var-card-info">
                    <div class="canvas-batch-var-card-name">{{${b.name}}}</div>
                    <div class="canvas-batch-var-card-sub">${b.type === 'image' ? (b.isBackground ? 'Fundo do post' : 'Imagem / Foto') : 'Texto dinâmico'}</div>
                  </div>
                </div>
              `).join('')}
            </div>
            <div style="margin-top: 14px; padding: 12px 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; font-size: 12px; color: rgba(255,255,255,0.65); line-height: 1.45;">
              💡 <strong>Como funciona:</strong> No próximo passo, cada linha da tabela preencherá essas variáveis automaticamente para criar um novo post.
            </div>
          `;
          bindsStatusWrap.appendChild(card);
        } else {
          // Assistente quando ainda não há variáveis
          const noBinds = document.createElement('div');
          noBinds.className = 'canvas-batch-no-binds-card';

          const currentChildren = (anchor && anchor.children) ? anchor.children : [];
          const textChildren = currentChildren.filter(c => c.type === 'text');

          let elementsListHtml = '';
          if (textChildren.length > 0) {
            elementsListHtml = `
              <div style="font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.7); margin-top: 4px;">
                Textos encontrados no seu design atual:
              </div>
              <div class="canvas-batch-elements-detect-list">
                ${textChildren.map((c, i) => `
                  <div class="canvas-batch-elem-row">
                    <div class="canvas-batch-elem-row-info">
                      <span style="color: rgba(255,255,255,0.4); font-weight: 600;">T</span>
                      <span>"${(c.text || 'Texto vazio').slice(0, 45)}${(c.text || '').length > 45 ? '…' : ''}"</span>
                    </div>
                    <button type="button" class="canvas-batch-elem-connect-btn" data-child-id="${c.id}">
                      ✨ Conectar
                    </button>
                  </div>
                `).join('')}
              </div>
              <button type="button" class="canvas-batch-auto-connect-all-btn" id="canvas-batch-auto-connect-all">
                <i data-lucide="sparkles" style="width: 15px; height: 15px;"></i>
                <span>Conectar todos os textos automaticamente</span>
              </button>
            `;
          } else {
            elementsListHtml = `
              <div style="font-size: 12px; color: rgba(255,255,255,0.6); line-height: 1.5;">
                Adicione textos ou fotos ao seu post no canvas e clique no botão <code>{}</code> na barra de ferramentas para torná-los variáveis dinâmicas.
              </div>
            `;
          }

          noBinds.innerHTML = `
            <div class="canvas-batch-no-binds-head">
              <div class="canvas-batch-no-binds-head-icon">
                <i data-lucide="sparkles" style="width: 20px; height: 20px;"></i>
              </div>
              <div>
                <div class="canvas-batch-no-binds-title">O que deve mudar em cada post?</div>
                <div class="canvas-batch-no-binds-sub">Escolha quais frases ou imagens do seu post devem mudar para cada post gerado.</div>
              </div>
            </div>
            ${elementsListHtml}
          `;
          bindsStatusWrap.appendChild(noBinds);

          noBinds.querySelectorAll('.canvas-batch-elem-connect-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              const childId = Number(btn.dataset.childId);
              const child = (anchor.children || []).find(c => c.id === childId);
              if (child) {
                if (window.openBindModal) {
                  window.openBindModal({ type: 'child', child });
                } else {
                  child.bind = slugifyBind(child.text) || 'titulo';
                  renderStep1BindsStatus();
                }
              }
            });
          });

          const autoBtn = noBinds.querySelector('#canvas-batch-auto-connect-all');
          if (autoBtn) {
            autoBtn.addEventListener('click', () => {
              textChildren.forEach((c, idx) => {
                if (!c.bind) {
                  const defaultName = idx === 0 ? 'titulo' : idx === 1 ? 'subtitulo' : `texto_${idx + 1}`;
                  c.bind = slugifyBind(c.text) || defaultName;
                  const el = nodeElement(c.id);
                  if (el) paintBind(c, el);
                }
              });
              updateTextToolbar();
              save();
              toast.success('Textos conectados como variáveis!');
              renderStep1BindsStatus();
            });
          }
        }
        if (window.lucide) lucide.createIcons();
      }

      function renderStep3Summary() {
        if (!summaryHero) return;
        const total = batchData.records.length;
        const anchor = selectedFrame() || frames[0];
        let slides = 1;
        if (anchor) {
          const chain = computePosts().find(c => c.includes(anchor.id)) || [anchor.id];
          slides = chain.length;
        }
        summaryHero.innerHTML = `
          <i data-lucide="package-check" style="width: 18px; height: 18px; color: #60A5FA; flex-shrink: 0;"></i>
          <span>Você vai gerar <strong>${total} ${total === 1 ? 'post' : 'posts'}</strong> (${slides > 1 ? `${total * slides} slides no total` : `${total} imagens PNG`}) a partir deste modelo.</span>
        `;
        if (window.lucide) lucide.createIcons();
      }

      function renderBatchGrid() {
        if (!grid) return;
        const binds = getCanvasBinds();
        batchData.binds = binds;
        grid.innerHTML = '';

        if (binds.length === 0) {
          grid.style.gridTemplateColumns = '1fr';
          const empty = document.createElement('div');
          empty.className = 'canvas-batch-empty-guide';
          empty.innerHTML = `
            <div class="canvas-batch-guide-icon">
              <i data-lucide="sparkles" style="width: 24px; height: 24px;"></i>
            </div>
            <h3 class="canvas-batch-guide-title">Nenhuma variável conectada ainda</h3>
            <p class="canvas-batch-guide-sub">Volte ao Passo 1 ou clique num texto e aperte <code>{}</code> para marcar o que muda.</p>
          `;
          grid.appendChild(empty);
          if (window.lucide) lucide.createIcons();
          return;
        }

        // Mantém o que já foi digitado quando os binds do canvas mudam
        batchData.records = batchData.records.map(rec => {
          const next = {};
          binds.forEach(b => {
            next[b.name] = rec[b.name] !== undefined ? rec[b.name] : '';
            if (rec['__hint_' + b.name]) next['__hint_' + b.name] = rec['__hint_' + b.name];
          });
          return next;
        });
        if (batchData.records.length === 0) batchData.records.push(blankRecord(binds));

        grid.style.gridTemplateColumns = `36px repeat(${binds.length}, minmax(170px, 1fr)) 34px`;

        // Cabeçalho
        const idxHead = document.createElement('div');
        idxHead.className = 'canvas-batch-cell-oa is-head is-idx';
        idxHead.textContent = '#';
        grid.appendChild(idxHead);

        binds.forEach(b => {
          const cell = document.createElement('div');
          cell.className = 'canvas-batch-cell-oa is-head';

          const top = document.createElement('div');
          top.className = 'canvas-batch-headtop-oa';
          const label = document.createElement('div');
          label.className = `canvas-batch-var-tag ${b.type === 'image' ? 'is-img' : 'is-txt'}`;
          label.innerHTML = `<span class="canvas-batch-var-icon">${b.type === 'image' ? '🖼' : 'T'}</span><span class="canvas-batch-var-name">{{${b.name}}}</span>`;
          top.appendChild(label);
          if (b.type === 'image') {
            const fill = document.createElement('button');
            fill.type = 'button';
            fill.className = 'canvas-batch-colfill-oa';
            fill.title = 'Preencher coluna com fotos do Unsplash ou do Computador';
            fill.innerHTML = '<i data-lucide="images" style="width:13px;height:13px;"></i>';
            fill.addEventListener('click', () => {
              openBatchPhotoPickerModal({ column: b.name });
            });
            top.appendChild(fill);
          }
          cell.appendChild(top);

          /* Só aparece depois de um import: é o que substitui o antigo passo de
             "mapear colunas", agora no lugar onde a coluna já está. */
          if (batchData.csv) {
            const sel = document.createElement('select');
            sel.className = 'canvas-batch-headsel-oa';
            const none = document.createElement('option');
            none.value = '';
            none.textContent = '— sem coluna —';
            sel.appendChild(none);
            batchData.csv.headers.forEach(h => {
              const o = document.createElement('option');
              o.value = h;
              o.textContent = h;
              sel.appendChild(o);
            });
            sel.value = batchData.csvPick[b.name] || '';
            sel.addEventListener('change', () => {
              batchData.csvPick[b.name] = sel.value;
              fillColumnFromCSV(b);
              renderBatchGrid();
              updateBatchFooter();
            });
            cell.appendChild(sel);
          }

          grid.appendChild(cell);
        });

        const actHead = document.createElement('div');
        actHead.className = 'canvas-batch-cell-oa is-head is-act';
        grid.appendChild(actHead);

        // Linhas
        batchData.records.forEach((rec, rowIndex) => {
          const idx = document.createElement('div');
          idx.className = 'canvas-batch-cell-oa is-idx';
          idx.textContent = rowIndex + 1;
          grid.appendChild(idx);

          binds.forEach(b => {
            const cell = document.createElement('div');
            cell.className = 'canvas-batch-cell-oa';
            if (b.type === 'image') {
              cell.appendChild(buildImageCell(rec, rowIndex, b.name));
            } else {
              const ta = document.createElement('textarea');
              ta.className = 'canvas-batch-input-oa';
              ta.rows = 1;
              ta.placeholder = b.name;
              ta.value = rec[b.name] || '';
              const autoGrow = () => {
                ta.style.height = 'auto';
                ta.style.height = Math.min(ta.scrollHeight, 66) + 'px';
              };
              ta.addEventListener('input', () => {
                rec[b.name] = ta.value;
                autoGrow();
              });
              cell.appendChild(ta);
              requestAnimationFrame(autoGrow);
            }
            grid.appendChild(cell);
          });

          const delCell = document.createElement('div');
          delCell.className = 'canvas-batch-cell-oa is-act';
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'canvas-batch-rowdel-oa';
          delBtn.title = 'Remover linha';
          delBtn.innerHTML = '<i data-lucide="x" style="width:12px;height:12px;"></i>';
          delBtn.addEventListener('click', () => {
            batchData.records.splice(rowIndex, 1);
            if (batchData.records.length === 0) batchData.records.push(blankRecord(binds));
            renderBatchGrid();
            updateBatchFooter();
          });
          delCell.appendChild(delBtn);
          grid.appendChild(delCell);
        });

        if (window.lucide) lucide.createIcons();
      }

      function buildImageCell(rec, rowIndex, bindName) {
        const wrap = document.createElement('div');
        wrap.className = 'canvas-batch-imgcell-oa';

        const val = rec[bindName] || '';
        const hint = rec['__hint_' + bindName] || '';

        if (val) {
          const thumb = document.createElement('img');
          thumb.className = 'canvas-batch-thumb-oa';
          thumb.src = val;
          thumb.title = 'Clique para trocar esta foto (Unsplash / PC)';
          thumb.style.cursor = 'pointer';
          thumb.addEventListener('click', () => {
            openBatchPhotoPickerModal({ rowIndex, bindName, currentVal: val });
          });
          wrap.appendChild(thumb);

          const changeBtn = document.createElement('button');
          changeBtn.type = 'button';
          changeBtn.className = 'canvas-batch-imgbtn-oa has-img';
          changeBtn.title = 'Trocar foto';
          changeBtn.innerHTML = '<i data-lucide="sparkles" style="width:11px;height:11px;"></i><span>Trocar</span>';
          changeBtn.addEventListener('click', () => {
            openBatchPhotoPickerModal({ rowIndex, bindName, currentVal: val });
          });
          wrap.appendChild(changeBtn);

          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'canvas-batch-imgbtn-oa';
          del.style.flex = '0 0 24px';
          del.title = 'Remover foto';
          del.innerHTML = '<i data-lucide="x" style="width:11px;height:11px;"></i>';
          del.addEventListener('click', (e) => {
            e.stopPropagation();
            rec[bindName] = '';
            renderBatchGrid();
            updateBatchFooter();
          });
          wrap.appendChild(del);
        } else {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'canvas-batch-imgbtn-oa';
          btn.title = hint ? `Arquivo sugerido no CSV: ${hint}` : 'Escolher foto do Unsplash ou computador';
          btn.innerHTML = hint
            ? `<i data-lucide="image" style="width:12px;height:12px;"></i><span>${hint}</span>`
            : '<i data-lucide="image-plus" style="width:12px;height:12px;"></i><span>Escolher Foto</span>';
          btn.addEventListener('click', () => {
            openBatchPhotoPickerModal({ rowIndex, bindName, currentVal: val });
          });
          wrap.appendChild(btn);
        }
        return wrap;
      }

      function isImageSrcValue(val) {
        if (!val || typeof val !== 'string') return false;
        const v = val.trim().toLowerCase();
        return v.startsWith('data:image/') || v.startsWith('http://') || v.startsWith('https://') || v.startsWith('blob:');
      }

      function getCanvasBinds() {
        const bindsMap = new Map();
        frames.forEach(f => {
          if (f.bgBind) {
            bindsMap.set(f.bgBind, {
              name: f.bgBind,
              type: 'image',
              frameId: f.id,
              isBackground: true
            });
          }
          (f.children || []).forEach(c => {
            if (c.bind) {
              bindsMap.set(c.bind, {
                name: c.bind,
                type: c.type,
                frameId: f.id,
                childId: c.id
              });
            }
          });
        });
        return Array.from(bindsMap.values());
      }

      // ----------------------------------------------------
      // MOTOR DE RENDERIZAÇÃO HIGH-DPI (ATÉ 4K) & EXPORTAÇÃO
      // ----------------------------------------------------
      const exportImageCache = new Map();
      const exportImageFailures = [];

      function loadExportImage(src) {
        if (!src) return Promise.resolve(null);
        if (exportImageCache.has(src)) return Promise.resolve(exportImageCache.get(src));
        return new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            exportImageCache.set(src, img);
            resolve(img);
          };
          img.onerror = () => resolve(null);
          img.src = src;
        });
      }

      async function resolveChildImageSrc(child, overrides = {}) {
        /* Um override só substitui o pixel se for de fato uma imagem. Valor de
           texto num {{bind}} de imagem não pode virar src: o load falha e o nó
           some do PNG sem ninguém avisar. Nesse caso cai no asset original. */
        if (child.bind && isImageSrcValue(overrides[child.bind])) {
          return String(overrides[child.bind]).trim();
        }
        if (child.src) return child.src;
        if (child.assetId) {
          if (assetCache.has(child.assetId)) return assetCache.get(child.assetId);
          return await getAsset(child.assetId);
        }
        return null;
      }

      function wrapTextForCanvas(ctx, text, maxWidth) {
        const lines = [];
        const paragraphs = String(text).split('\n');
        paragraphs.forEach(para => {
          const words = para.split(' ');
          let currentLine = '';
          for (let n = 0; n < words.length; n++) {
            const testLine = currentLine ? `${currentLine} ${words[n]}` : words[n];
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && currentLine) {
              lines.push(currentLine);
              currentLine = words[n];
            } else {
              currentLine = testLine;
            }
          }
          lines.push(currentLine);
        });
        return lines;
      }

      function computeAdjustedTextPositions(frame, overrides, ctx) {
        const adjustedYMap = new Map();
        if (!frame || !frame.children) return adjustedYMap;
        const textChildren = frame.children.filter(c => c.type === 'text');
        if (textChildren.length <= 1) return adjustedYMap;

        const sorted = [...textChildren].sort((a, b) => a.y - b.y);
        let accumulatedDelta = 0;

        for (let i = 0; i < sorted.length; i++) {
          const c = sorted[i];
          const origH = getExactTextHeight(c);
          
          let overrideText = '';
          if (c.bind && overrides[c.bind] !== undefined) {
            overrideText = String(overrides[c.bind]);
          } else if (c.text !== undefined && c.text !== '') {
            overrideText = c.text;
          } else if (c.html) {
            const temp = document.createElement('div');
            temp.innerHTML = c.html.replace(/<br\s*[\/]?>/gi, '\n');
            overrideText = temp.textContent || temp.innerText || '';
          }

          const overrideChild = { ...c, text: overrideText, html: null };
          const newH = getExactTextHeight(overrideChild);
          const delta = Math.max(0, newH - origH);

          adjustedYMap.set(c.id, Math.round(c.y + accumulatedDelta));
          accumulatedDelta += delta;
        }

        return adjustedYMap;
      }

      async function renderFrameToCanvas(frame, options = {}) {
        const scale = options.scale || 2;
        const overrides = options.overrides || {};
        const frameW = frame.w || 1080;
        const frameH = frame.h || 1350;

        // Garante que todas as fontes usadas neste frame estejam carregadas e prontas antes de desenhar
        for (const child of (frame.children || [])) {
          if (child.type === 'text' && child.fontFamily) {
            try {
              const fontObj = fontOf(child);
              const weight = child.fontWeight || 400;
              await document.fonts.load(`${weight} 16px ${fontObj.name}`);
            } catch (e) {
              console.warn('[export] aviso ao carregar fonte:', child.fontFamily, e);
            }
          }
        }

        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(frameW * scale);
        canvas.height = Math.round(frameH * scale);
        const ctx = canvas.getContext('2d');

        ctx.scale(scale, scale);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // 1. Fundo do Frame (Cor, Gradiente ou Imagem com Blur & Overlay - com suporte a bgBind no batch export)
        let bgOverride = (frame.bgBind && overrides[frame.bgBind]) ? String(overrides[frame.bgBind]).trim() : null;
        let bgSrc = null;
        if (bgOverride && isImageSrcValue(bgOverride)) {
          bgSrc = bgOverride;
        } else if (hasFrameBg(frame)) {
          bgSrc = frame.bgImage || (frame.bgAssetId ? await getAsset(frame.bgAssetId) : null);
        }

        if (bgSrc) {
          const bgImg = await loadExportImage(bgSrc);
          if (bgImg) {
            ctx.save();
            const blurPx = frame.bgBlur || 0;
            if (blurPx > 0 && 'filter' in ctx) {
              ctx.filter = `blur(${blurPx}px)`;
            }

            // Cover fit com suporte a bgPosX, bgPosY e bgZoom
            const imgAspect = (bgImg.naturalWidth || bgImg.width) / (bgImg.naturalHeight || bgImg.height);
            const frameAspect = frameW / frameH;
            const zoom = (frame.bgZoom || 100) / 100;
            const posX = (frame.bgPosX != null ? frame.bgPosX : 50) / 100;
            const posY = (frame.bgPosY != null ? frame.bgPosY : 50) / 100;

            let baseW, baseH;
            if (imgAspect > frameAspect) {
              baseH = frameH;
              baseW = frameH * imgAspect;
            } else {
              baseW = frameW;
              baseH = frameW / imgAspect;
            }

            const drawW = baseW * zoom;
            const drawH = baseH * zoom;
            const excessX = drawW - frameW;
            const excessY = drawH - frameH;
            const drawX = -excessX * posX;
            const drawY = -excessY * posY;

            ctx.drawImage(bgImg, drawX, drawY, drawW, drawH);
            ctx.restore();

            // Overlay escuro
            const defaultOverlay = frame.bgRecipe ? 0 : 35;
            const overlayAlpha = (frame.bgOverlay != null ? frame.bgOverlay : defaultOverlay) / 100;
            if (overlayAlpha > 0) {
              ctx.fillStyle = `rgba(0, 0, 0, ${overlayAlpha})`;
              ctx.fillRect(0, 0, frameW, frameH);
            }
          }
        } else if (bgOverride && (bgOverride.startsWith('#') || bgOverride.startsWith('rgb'))) {
          ctx.fillStyle = bgOverride;
          ctx.fillRect(0, 0, frameW, frameH);
        } else if (frame.bg && frame.bg.includes('gradient')) {
          const hexes = frame.bg.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/g);
          const c1 = (hexes && hexes[0]) || '#18181B';
          const c2 = (hexes && hexes[1]) || '#09090B';

          let grad;
          if (frame.bg.includes('radial')) {
            const cx = frameW / 2;
            const cy = frameH / 2;
            const radius = Math.max(frameW, frameH) / 1.35;
            grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
          } else if (frame.bg.includes('90deg')) {
            grad = ctx.createLinearGradient(0, 0, frameW, 0);
          } else if (frame.bg.includes('135deg')) {
            grad = ctx.createLinearGradient(0, 0, frameW, frameH);
          } else if (frame.bg.includes('0deg')) {
            grad = ctx.createLinearGradient(0, frameH, 0, 0);
          } else {
            grad = ctx.createLinearGradient(0, 0, 0, frameH);
          }

          grad.addColorStop(0, c1);
          grad.addColorStop(1, c2);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, frameW, frameH);
        } else {
          ctx.fillStyle = frame.bg || '#FFFFFF';
          ctx.fillRect(0, 0, frameW, frameH);
        }

        // 2. Nós filhos
        const adjustedTextYMap = computeAdjustedTextPositions(frame, overrides, ctx);
        const children = frame.children || [];
        for (const child of children) {
          if (child.type === 'image') {
            const src = await resolveChildImageSrc(child, overrides);
            const img = await loadExportImage(src);
            if (!img) {
              /* Slide em branco sem aviso é pior que slide errado: registra a
                 falha para o lote poder reclamar no fim. */
              exportImageFailures.push({ frameId: frame.id, childId: child.id, src: src ? String(src).slice(0, 80) : null });
              console.warn('[export] imagem não carregou', { frame: frame.id, child: child.id, src: src ? String(src).slice(0, 80) : null });
            }
            if (img) {
              ctx.save();
              ctx.globalAlpha = (child.opacity != null ? child.opacity : 100) / 100;

              if (child.rotation) {
                const centerX = child.x + child.w / 2;
                const centerY = child.y + child.h / 2;
                ctx.translate(centerX, centerY);
                ctx.rotate((child.rotation * Math.PI) / 180);
                ctx.translate(-centerX, -centerY);
              }

              if (child.shadow) {
                ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
                ctx.shadowBlur = 24;
                ctx.shadowOffsetY = 8;
              }

              ctx.beginPath();
              if (child.borderRadius && ctx.roundRect) {
                ctx.roundRect(child.x, child.y, child.w, child.h, child.borderRadius);
              } else {
                ctx.rect(child.x, child.y, child.w, child.h);
              }
              ctx.clip();

              const natW = img.naturalWidth || img.width;
              const natH = img.naturalHeight || img.height;
              const newAspect = (natW && natH) ? (natW / natH) : 1;
              const maskAspect = child.w / child.h;

              let imgX = child.x + (child.imgX || 0);
              let imgY = child.y + (child.imgY || 0);
              let imgW = child.imgW || child.w;
              let imgH = child.imgH || child.h;

              if (natW && natH && Math.abs((imgW / imgH) - newAspect) > 0.02) {
                if (newAspect > maskAspect) {
                  imgH = child.h;
                  imgW = Math.round(child.h * newAspect);
                  imgX = child.x + Math.round((child.w - imgW) / 2);
                  imgY = child.y;
                } else {
                  imgW = child.w;
                  imgH = Math.round(child.w / newAspect);
                  imgX = child.x;
                  imgY = child.y + Math.round((child.h - imgH) / 2);
                }
              }

              ctx.drawImage(img, imgX, imgY, imgW, imgH);
              ctx.restore();
            }
          } else if (child.type === 'text') {
            let text = '';
            if (child.bind && overrides[child.bind] !== undefined) {
              text = String(overrides[child.bind]);
            } else if (child.text !== undefined && child.text !== '') {
              text = child.text;
            } else if (child.html) {
              const temp = document.createElement('div');
              temp.innerHTML = child.html.replace(/<br\s*[\/]?>/gi, '\n');
              text = temp.textContent || temp.innerText || '';
            }

            if (!text) continue;

            ctx.save();
            ctx.globalAlpha = (child.opacity != null ? child.opacity : 100) / 100;

            const fontSize = child.fontSize || 48;
            const fontWeight = child.fontWeight || 500;
            const fontStyle = child.italic ? 'italic ' : '';
            const fontFamily = child.fontFamily || '"Inter Tight", sans-serif';
            ctx.font = `${fontStyle}${fontWeight} ${fontSize}px ${fontFamily}`;
            ctx.fillStyle = child.color || '#000000';
            ctx.textBaseline = 'top';

            const align = child.align || 'left';
            ctx.textAlign = align;

            if ('letterSpacing' in ctx && child.letterSpacing != null) {
              ctx.letterSpacing = `${child.letterSpacing}em`;
            }

            const lines = wrapTextForCanvas(ctx, text, child.w);
            const lh = fontSize * (child.lineHeight || 1.15);
            const effectiveChildY = adjustedTextYMap.has(child.id) ? adjustedTextYMap.get(child.id) : child.y;
            const totalTextH = lines.length > 0 ? (lines.length - 1) * lh + fontSize : fontSize;

            if (child.rotation) {
              const centerX = child.x + child.w / 2;
              const centerY = effectiveChildY + totalTextH / 2;
              ctx.translate(centerX, centerY);
              ctx.rotate((child.rotation * Math.PI) / 180);
              ctx.translate(-centerX, -centerY);
            }

            if (child.shadow) {
              ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
              ctx.shadowBlur = 10;
              ctx.shadowOffsetY = 2;
            }

            lines.forEach((line, lineIdx) => {
              let lineX = child.x;
              if (align === 'center') lineX = child.x + child.w / 2;
              else if (align === 'right') lineX = child.x + child.w;

              const lineY = effectiveChildY + lineIdx * lh;

              if (child.bg && child.bg !== 'transparent') {
                const metrics = ctx.measureText(line);
                const bgPadX = 10;
                const bgPadY = 4;
                ctx.save();
                ctx.fillStyle = child.bg;
                if (ctx.roundRect) {
                  ctx.beginPath();
                  ctx.roundRect(lineX - (align === 'center' ? metrics.width / 2 : 0) - bgPadX, lineY - bgPadY, metrics.width + bgPadX * 2, fontSize + bgPadY * 2, 6);
                  ctx.fill();
                } else {
                  ctx.fillRect(lineX - (align === 'center' ? metrics.width / 2 : 0) - bgPadX, lineY - bgPadY, metrics.width + bgPadX * 2, fontSize + bgPadY * 2);
                }
                ctx.restore();
              }

              ctx.fillText(line, lineX, lineY);

              if (child.underline) {
                const metrics = ctx.measureText(line);
                let startX = lineX;
                if (align === 'center') startX = lineX - metrics.width / 2;
                else if (align === 'right') startX = lineX - metrics.width;
                ctx.beginPath();
                ctx.strokeStyle = child.color || '#000000';
                ctx.lineWidth = Math.max(1, fontSize / 16);
                ctx.moveTo(startX, lineY + fontSize * 1.05);
                ctx.lineTo(startX + metrics.width, lineY + fontSize * 1.05);
                ctx.stroke();
              }
            });

            ctx.restore();
          }
        }

        return canvas;
      }

      async function exportFrameToBlob(frame, options = {}) {
        const canvas = await renderFrameToCanvas(frame, options);
        const format = options.format || 'png';
        const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const quality = format === 'jpeg' ? 0.95 : undefined;
        return new Promise(resolve => canvas.toBlob(resolve, mime, quality));
      }

      /* Corta a faixa panorâmica nas fatias do tamanho da rede. Renderiza a
         faixa inteira uma única vez: é o mesmo desenho, só recortado, então a
         emenda entre um post e outro fecha no pixel. */
      function sliceCanvasIntoPosts(canvas, slices) {
        const parts = [];
        const sliceW = Math.round(canvas.width / slices);
        for (let i = 0; i < slices; i++) {
          const part = document.createElement('canvas');
          part.width = sliceW;
          part.height = canvas.height;
          const pctx = part.getContext('2d');
          pctx.imageSmoothingEnabled = false;
          pctx.drawImage(canvas, i * sliceW, 0, sliceW, canvas.height, 0, 0, sliceW, canvas.height);
          parts.push(part);
        }
        return parts;
      }

      /* Um frame comum vira 1 arquivo; uma faixa panorâmica vira N. */
      async function exportFrameToBlobs(frame, options = {}) {
        const canvas = await renderFrameToCanvas(frame, options);
        const format = options.format || 'png';
        const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const quality = format === 'jpeg' ? 0.95 : undefined;
        const slices = panoramicSliceCount(frame);
        const parts = slices > 1 ? sliceCanvasIntoPosts(canvas, slices) : [canvas];
        return Promise.all(parts.map(part =>
          new Promise(resolve => part.toBlob(resolve, mime, quality))
        ));
      }

      // Execução da Exportação em Lote
      if (startBtn) {
        startBtn.addEventListener('click', runBatchExport);
      }

      async function runBatchExport() {
        if (!window.JSZip) {
          toast.info('Biblioteca de exportação carregando, tente novamente em um instante.');
          return;
        }

        const totalRows = batchData.records.length;
        if (totalRows === 0) return;
        exportImageFailures.length = 0;

        const scale = Number(scaleSelect ? scaleSelect.value : 2);
        const format = formatSelect ? formatSelect.value : 'png';
        const ext = format === 'jpeg' ? 'jpg' : 'png';

        const anchor = selectedFrame() || frames[0];
        if (!anchor) return;

        /* O template não é o frame solto, é a cadeia inteira em que ele está:
           uma linha do CSV vira o post completo. Carrossel de 3 slides com 50
           linhas = 50 pastas de 3 arquivos, não 50 imagens avulsas. */
        const byId = new Map(frames.map(f => [f.id, f]));
        const chain = (computePosts().find(c => c.includes(anchor.id)) || [anchor.id])
          .map(id => byId.get(id))
          .filter(Boolean);
        const isCarousel = chain.length > 1;

        startBtn.disabled = true;
        if (progressBox) progressBox.style.display = 'flex';

        const zip = new JSZip();

        for (let i = 0; i < totalRows; i++) {
          const pct = Math.round(((i + 1) / totalRows) * 100);
          const postNum = String(i + 1).padStart(3, '0');

          if (progressPct) progressPct.textContent = `${pct}%`;
          if (progressFill) progressFill.style.width = `${pct}%`;

          /* A linha da tabela já é o override: chave = nome do bind. Só as dicas
             internas (__hint_) ficam de fora. */
          const record = batchData.records[i] || {};
          const overrides = {};
          Object.keys(record).forEach(key => {
            if (key.startsWith('__hint_')) return;
            if (record[key] !== '') overrides[key] = record[key];
          });

          // Todos os slides da linha recebem o mesmo `overrides`
          for (let s = 0; s < chain.length; s++) {
            if (progressText) {
              progressText.textContent = isCarousel
                ? `Gerando post ${i + 1} de ${totalRows} · slide ${s + 1}/${chain.length}...`
                : `Gerando post ${i + 1} de ${totalRows}...`;
            }
            /* Faixa panorâmica devolve várias fatias para o mesmo slide: cada
               uma entra como um post do carrossel. */
            const blobs = await exportFrameToBlobs(chain[s], { scale, format, overrides });
            blobs.forEach((blob, sliceIdx) => {
              const slideNum = blobs.length > 1 ? `${s + 1}-${sliceIdx + 1}` : `${s + 1}`;
              zip.file(isCarousel || blobs.length > 1
                ? `carrossel_${postNum}/slide_${slideNum}.${ext}`
                : `post_${postNum}.${ext}`, blob);
            });
          }

          // Permite que o navegador respire e renderize o progresso
          await new Promise(r => setTimeout(r, 10));
        }

        if (progressText) progressText.textContent = 'Empacotando arquivo .ZIP...';
        const zipBlob = await zip.generateAsync({ type: 'blob' });

        const downloadUrl = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `lote_posts_${totalRows}_${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);

        const falhas = exportImageFailures.length;
        if (progressText) {
          progressText.textContent = falhas
            ? `✓ ${totalRows} posts exportados — ${falhas} imagem${falhas === 1 ? '' : 'ns'} não carregou (veja o console)`
            : `✓ ${totalRows} posts exportados com sucesso!`;
        }
        startBtn.disabled = false;
        setTimeout(() => {
          closeBatchModal();
          if (progressBox) progressBox.style.display = 'none';
        }, falhas ? 3500 : 1200);
      }

      /* ----------------------------------------------------
         GERAÇÃO DO LOTE DIRETO NO INFINITE CANVAS
         Multiplica os frames na tela, injeta os dados e ajusta o zoom
         ---------------------------------------------------- */
      function zoomToFitFrames(targetFrames) {
        if (!targetFrames || targetFrames.length === 0) return;
        const padX = 100;
        const padTop = 130;
        const padBottom = 160;
        const availW = innerWidth - padX * 2;
        const availH = innerHeight - padTop - padBottom;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        targetFrames.forEach(f => {
          minX = Math.min(minX, f.x);
          minY = Math.min(minY, f.y);
          maxX = Math.max(maxX, f.x + f.w);
          maxY = Math.max(maxY, f.y + f.h);
        });

        const totalW = maxX - minX;
        const totalH = maxY - minY;

        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(availW / totalW, availH / totalH)));
        cam.scale = scale;
        cam.x = padX + (availW - totalW * scale) / 2 - minX * scale;
        cam.y = padTop + (availH - totalH * scale) / 2 - minY * scale;
        applyCamera();
      }

      /* Todo pixel clonado vira asset no IndexedDB e o frame guarda só o id.
         Data URL dentro de `frames` é multiplicado por post no localStorage e
         estoura a cota já no quinto post — em silêncio, porque save() engole o
         erro. Data URLs iguais compartilham um único asset. */
      async function assetIdForDataUrl(dataUrl, cache) {
        if (!isImageSrcValue(dataUrl)) return null;
        if (cache.has(dataUrl)) return cache.get(dataUrl);
        const id = 'asset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        assetCache.set(id, dataUrl);
        await saveAsset(id, dataUrl);
        cache.set(dataUrl, id);
        return id;
      }

      async function generateBatchOnCanvas() {
        const records = (batchData.records || []).filter(rec => {
          return Object.keys(rec).some(k => !k.startsWith('__') && rec[k] && String(rec[k]).trim() !== '');
        });

        if (records.length === 0) {
          toast.error('Preencha ou cole pelo menos uma linha de dados na tabela.');
          return;
        }

        const anchor = selectedFrame() || frames[0];
        if (!anchor) {
          toast.error('Nenhum template encontrado no Canvas. Crie pelo menos um post antes de gerar.');
          return;
        }

        const dataUrlAssets = new Map();
        const byId = new Map(frames.map(f => [f.id, f]));
        const chain = (computePosts().find(c => c.includes(anchor.id)) || [anchor.id])
          .map(id => byId.get(id))
          .filter(Boolean);

        const isCarousel = chain.length > 1;

        let maxX = -Infinity;
        frames.forEach(f => {
          maxX = Math.max(maxX, f.x + f.w);
        });

        const POST_GAP = isCarousel ? 240 : FRAME_GAP;
        let nextPostX = maxX + POST_GAP;
        const postStartY = anchor.y;

        const newCreatedFrames = [];

        for (let rowIndex = 0; rowIndex < records.length; rowIndex++) {
          const row = records[rowIndex];
          const postNum = rowIndex + 1;
          const postStartX = nextPostX;
          const clonedSlideIds = [];
          let curX = postStartX;

          for (let slideIdx = 0; slideIdx < chain.length; slideIdx++) {
            const srcSlide = chain[slideIdx];
            const children = [];

            for (const child of (srcSlide.children || [])) {
              const ch = { ...JSON.parse(JSON.stringify(child)), id: childSeq++ };
              if (ch.type === 'text' && ch.bind && row[ch.bind] !== undefined && row[ch.bind] !== '') {
                ch.text = String(row[ch.bind]);
                delete ch.html;
              }
              if (ch.type === 'image') {
                ensureImageProps(ch);
                if (ch.bind && isImageSrcValue(row[ch.bind])) {
                  const newId = await assetIdForDataUrl(String(row[ch.bind]), dataUrlAssets);
                  if (newId) { ch.assetId = newId; delete ch.src; }
                } else if (ch.assetId) {
                  /* Sem foto na linha: o asset do template já serve, não copia nada. */
                  delete ch.src;
                } else if (isImageSrcValue(ch.src)) {
                  const newId = await assetIdForDataUrl(ch.src, dataUrlAssets);
                  if (newId) { ch.assetId = newId; delete ch.src; }
                }
              }
              /* Clone é post concreto, não template: sem bind ele não é
                 recapturado como variável na próxima geração. */
              delete ch.bind;
              children.push(ch);
            }

            // Calcula o ajuste de fluxo vertical preservando a distância exata em pixels do template
            const srcTextNodes = (srcSlide.children || []).filter(c => c.type === 'text').sort((a, b) => a.y - b.y);
            let accumulatedDelta = 0;
            for (let tIdx = 0; tIdx < srcTextNodes.length; tIdx++) {
              const srcNode = srcTextNodes[tIdx];
              const clonedNode = children.find(c => c.type === 'text' && c.x === srcNode.x && Math.abs(c.y - srcNode.y) <= 1);
              if (!clonedNode) continue;

              const origH = getExactTextHeight(srcNode);
              const newH = getExactTextHeight(clonedNode);
              const delta = Math.max(0, newH - origH);

              clonedNode.y = Math.round(srcNode.y + accumulatedDelta);
              accumulatedDelta += delta;
            }

            const clonedFrame = {
              ...JSON.parse(JSON.stringify(srcSlide)),
              id: frameSeq++,
              name: isCarousel ? `Post ${postNum} · Slide ${slideIdx + 1}` : `Post ${postNum}`,
              x: curX,
              y: postStartY,
              children
            };

            if (srcSlide.bgBind && row[srcSlide.bgBind]) {
              const bgVal = String(row[srcSlide.bgBind]).trim();
              if (isImageSrcValue(bgVal)) {
                const bgId = await assetIdForDataUrl(bgVal, dataUrlAssets);
                if (bgId) {
                  clonedFrame.bgAssetId = bgId;
                  clonedFrame.bgImage = null;
                } else {
                  clonedFrame.bgImage = bgVal;
                }
              } else if (bgVal.startsWith('#') || bgVal.startsWith('rgb') || bgVal.includes('gradient')) {
                clonedFrame.bg = bgVal;
                clonedFrame.bgImage = null;
                clonedFrame.bgAssetId = null;
              }
            } else if (clonedFrame.bgImage) {
              const bgId = await assetIdForDataUrl(clonedFrame.bgImage, dataUrlAssets);
              if (bgId) {
                clonedFrame.bgAssetId = bgId;
                clonedFrame.bgImage = null;
              }
            }
            delete clonedFrame.bgBind;

            frames.push(clonedFrame);
            renderFrame(clonedFrame);
            newCreatedFrames.push(clonedFrame);
            clonedSlideIds.push(clonedFrame.id);

            curX += srcSlide.w + FRAME_GAP;
          }

          if (clonedSlideIds.length > 1) {
            for (let s = 0; s < clonedSlideIds.length - 1; s++) {
              links.push({
                id: linkSeq++,
                from: clonedSlideIds[s],
                to: clonedSlideIds[s + 1]
              });
            }
          }

          nextPostX = curX - FRAME_GAP + POST_GAP;
        }

        renderLinks();
        updateFrameMeta();
        wakeRopes();

        if (newCreatedFrames.length > 0) {
          selectedFrameIds = new Set([newCreatedFrames[0].id]);
          selectedId = newCreatedFrames[0].id;
          world.querySelectorAll('.canvas-frame').forEach((el) => {
            const fId = Number(el.dataset.id);
            el.classList.toggle('is-selected', selectedFrameIds.has(fId));
          });
          updateTopbar();
        }

        // Enquadra o que acabou de nascer, não o canvas inteiro
        zoomToFitFrames(newCreatedFrames.length ? newCreatedFrames : [...frames]);
        save();
        closeBatchModal();

        const topbarLabel = document.getElementById('canvas-topbar-label');
        if (topbarLabel) {
          topbarLabel.textContent = `✓ ${records.length} ${records.length === 1 ? 'post gerado' : 'posts gerados'} no Canvas!`;
          setTimeout(() => { updateTopbar(); }, 3500);
        }
      }

      if (btnGenCanvas) {
        btnGenCanvas.addEventListener('click', generateBatchOnCanvas);
      }

      function updateBatchFooter() {
        const total = batchData.records.length;
        const binds = getCanvasBinds();
        const ok = total > 0 && binds.length > 0;

        const anchor = selectedFrame() || frames[0];
        let slides = 1;
        if (anchor) {
          const chain = computePosts().find(c => c.includes(anchor.id)) || [anchor.id];
          slides = chain.length;
        }

        if (startBtn) {
          startBtn.disabled = !ok;
          if (startLabel) startLabel.textContent = ok ? `Baixar .ZIP (${total * slides})` : 'Baixar .ZIP';
        }
        if (btnGenCanvas) {
          btnGenCanvas.disabled = !ok;
          if (labelGenCanvas) {
            labelGenCanvas.textContent = ok
              ? `Criar ${total} ${total === 1 ? 'Post' : 'Posts'} no Canvas`
              : 'Criar no Canvas';
          }
        }
        if (summaryBox) {
          if (total > 0 && binds.length > 0) {
            summaryBox.innerHTML = `<span>📦 <strong>${total}</strong> ${total === 1 ? 'post' : 'posts'} × <strong>${slides}</strong> ${slides === 1 ? 'slide' : 'slides'} = <strong>${total * slides}</strong> ${total * slides === 1 ? 'PNG' : 'PNGs'}</span>`;
          } else {
            summaryBox.innerHTML = '';
          }
        }
        if (footInfo) {
          footInfo.textContent = total > 0
            ? `${total} ${total === 1 ? 'post na tabela' : 'posts na tabela'}`
            : '';
        }
      }

      function openBatchModal() {
        document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
        modal.classList.add('open');
        const binds = getCanvasBinds();
        if (binds.length > 0 && batchData.records.length > 0) {
          setBatchStep(2);
        } else {
          setBatchStep(1);
        }
        if (progressBox) progressBox.style.display = 'none';
        if (window.lucide) lucide.createIcons();
      }

      function closeBatchModal() {
        modal.classList.remove('open');
        if (progressBox) progressBox.style.display = 'none';
      }

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) {
          closeBatchModal();
        }
      });

      window.closeBatchModal = closeBatchModal;
      window.openBatchModal = openBatchModal;
      window.renderStep1BindsStatus = renderStep1BindsStatus;
      window.exportFrameToBlob = exportFrameToBlob;
      window.exportFrameToBlobs = exportFrameToBlobs;
      window.renderFrameToCanvas = renderFrameToCanvas;
      window.selectFrame = selectFrame;
      window.addTextToSelectedFrame = addTextToSelectedFrame;
      window.FONTS = FONTS;
      window.renderAll = renderAll;
    }

    // --------------------------------------------------
    // MODAL DE EXPORTAÇÃO INDIVIDUAL / CARROSSEL (CANVA STYLE)
    // --------------------------------------------------
    /* --------------------------------------------------
       BIBLIOTECA DE ÍCONES E STICKERS (API DO ICONIFY)

       O SVG é baixado como TEXTO e reembalado num data URI nosso antes de
       virar <img>. Carregar direto da URL do Iconify contaminaria o canvas e
       o toDataURL/toBlob do export quebraria. Depois rasterizamos pra PNG:
       assim o mesmo pixel vale pra tela e pra exportação, e o ícone entra
       pelo caminho de imagem que os dois renderizadores já sabem desenhar.
       -------------------------------------------------- */
    const ICONIFY_API = 'https://api.iconify.design';
    const STICKER_PREFIXES = 'twemoji,noto,fluent-emoji-flat,openmoji';
    const RASTER_SIZE = 512;

    const SUGESTOES_ICONES = [
      'mdi:heart', 'mdi:cross', 'ph:hands-praying-fill', 'mdi:book-open-page-variant',
      'solar:star-bold', 'ph:sun-bold', 'ph:moon-stars-fill', 'mdi:leaf',
      'ph:quotes-fill', 'mdi:arrow-right-thin', 'ph:sparkle-fill', 'fa7-solid:dove',
      'ph:flower-lotus-fill', 'mdi:hand-heart', 'ph:butterfly-fill', 'mdi:candle',
      'ph:cloud-fill', 'mdi:water', 'ph:mountains-fill', 'mdi:infinity',
      'mdi:church', 'mdi:dove', 'ph:crown-fill', 'mdi:star-four-points',
      'ph:plant-fill', 'mdi:flame', 'ph:drop-fill', 'mdi:white-balance-sunny',
      'ph:fish-fill', 'mdi:shield-cross', 'ph:tree-fill', 'mdi:weather-sunny',
      'ph:sun-horizon-fill', 'mdi:ladybug', 'ph:flower-fill', 'mdi:gift',
      'ph:heart-fill', 'mdi:star-circle', 'ph:lightning-fill', 'mdi:pine-tree',
      'ph:moon-fill', 'mdi:cross-bones', 'ph:waves-fill', 'mdi:teddy-bear',
      'ph:angel-fill', 'mdi:baby-face', 'ph:cloud-sun-fill', 'mdi:weather-night',
      'ph:chat-circle-text-fill', 'mdi:music-note', 'ph:airplane-fill', 'mdi:earth',
      'ph:book-open-text-fill', 'mdi:hand-peace', 'ph:star-fill', 'mdi:ring',
      'ph:compass-fill', 'mdi:key', 'ph:map-pin-fill', 'mdi:bell'
    ];
    const SUGESTOES_STICKERS = [
      'twemoji:folded-hands', 'twemoji:red-heart', 'noto:dove', 'twemoji:latin-cross',
      'noto:sparkles', 'twemoji:sun-with-face', 'noto:crescent-moon', 'twemoji:herb',
      'fluent-emoji-flat:star', 'noto:cherry-blossom', 'twemoji:butterfly', 'noto:rainbow',
      'twemoji:candle', 'noto:open-book', 'fluent-emoji-flat:fire', 'twemoji:sunrise',
      'noto:four-leaf-clover', 'twemoji:glowing-star', 'noto:rose', 'twemoji:rainbow',
      'twemoji:smiling-face-with-halo', 'noto:prayer-beads', 'noto:folded-hands', 'noto:sun',
      'twemoji:cloud', 'noto:tulip', 'twemoji:seedling', 'noto:sunflower',
      'fluent-emoji-flat:prayer-beads', 'twemoji:baby-angel', 'noto:heart-with-arrow',
      'twemoji:sparkling-heart', 'fluent-emoji-flat:dove', 'twemoji:star-struck',
      'noto:hatching-chick', 'twemoji:hibiscus', 'noto:bouquet', 'twemoji:full-moon-face',
      'fluent-emoji-flat:sad-but-relieved-face', 'twemoji:christmas-tree', 'noto:cross-mark',
      'twemoji:hot-face', 'noto:blowfish', 'twemoji:sunrise-over-mountains', 'noto:star-of-david',
      'twemoji:person-in-lotus-position', 'noto:woman-with-headscarf', 'twemoji:raising-hands', 'noto:baby-angel',
      'twemoji:sleeping-face', 'noto:santa-claus', 'twemoji:heart-with-ribbon', 'noto:balloon',
      'twemoji:party-popper', 'noto:compass', 'twemoji:fire', 'noto:spiral-shell', 'twemoji:whale', 'noto:cat-face'
    ];

    /* Presets curados de Mesh Gradient */
    const MESH_PRESETS = [
      { name: 'Aurora Sunset', colors: ['#FF5E7E', '#FF9966', '#FFD166', '#6B5B95'], seed: 12 },
      { name: 'Deep Cyberpunk', colors: ['#7928CA', '#FF0080', '#00DFD8', '#111827'], seed: 45 },
      { name: 'Oceano Místico', colors: ['#007CF0', '#00DFD8', '#7928CA', '#0A192F'], seed: 88 },
      { name: 'Esmeralda & Ouro', colors: ['#059669', '#10B981', '#F59E0B', '#064E3B'], seed: 33 },
      { name: 'Lavanda Suave', colors: ['#C4B5FD', '#DDD6FE', '#F3E8FF', '#8B5CF6'], seed: 21 },
      { name: 'Pêssego & Creme', colors: ['#FCA5A5', '#FDBA74', '#FEF08A', '#FFF7ED'], seed: 67 },
      { name: 'Dark Slate Neon', colors: ['#1E293B', '#334155', '#38BDF8', '#0F172A'], seed: 99 },
      { name: 'Devocional Warm', colors: ['#78350F', '#B45309', '#FDE68A', '#451A03'], seed: 14 },
      { name: 'Alvorada Celestial', colors: ['#38BDF8', '#818CF8', '#C084FC', '#1E1B4B'], seed: 56 },
      { name: 'Papel Vintage', colors: ['#E7E5E4', '#D6D3D1', '#A8A29E', '#78716C'], seed: 77 }
    ];

    let MeshGradientModule = null;
    async function loadMeshGradientLib() {
      if (MeshGradientModule) return MeshGradientModule;
      try {
        const mod = await import('https://esm.sh/@mesh-gradient/core@2.0.2');
        MeshGradientModule = mod.MeshGradient;
        return MeshGradientModule;
      } catch (err) {
        console.error('[mesh-gradient] Falha ao carregar @mesh-gradient/core:', err);
        throw err;
      }
    }

    async function renderMeshGradientToDataUrl(colors, seed, w = 1080, h = 1350) {
      const MeshGradClass = await loadMeshGradientLib();
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.style.position = 'fixed';
      canvas.style.left = '-9999px';
      canvas.style.top = '-9999px';
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      document.body.appendChild(canvas);

      try {
        const mg = new MeshGradClass();
        await mg.init(canvas, {
          colors: colors,
          seed: Number(seed) || 42,
          isStatic: true,
          webglContextAttributes: { preserveDrawingBuffer: true }
        });

        if (typeof mg.animateFrame === 'function') {
          mg.animateFrame();
        }

        const dataUrl = canvas.toDataURL('image/png');
        try {
          if (typeof mg.destroy === 'function') mg.destroy();
        } catch {}

        return dataUrl;
      } finally {
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
    }

    /* Gerenciamento de Fontes Customizadas (Fontsource e Locais) */
    const CUSTOM_FONTS_STORAGE = 'oa_custom_fonts';

    function parseFontFilename(filename) {
      const base = filename.replace(/\.[^/.]+$/, '').trim();

      const weightMap = [
        { pattern: /(?:^|[-_ ])(thin|hairline)(?:[-_ ]|$)/i, weight: 100 },
        { pattern: /(?:^|[-_ ])(extralight|ultralight)(?:[-_ ]|$)/i, weight: 200 },
        { pattern: /(?:^|[-_ ])(light)(?:[-_ ]|$)/i, weight: 300 },
        { pattern: /(?:^|[-_ ])(regular|normal|book)(?:[-_ ]|$)/i, weight: 400 },
        { pattern: /(?:^|[-_ ])(medium)(?:[-_ ]|$)/i, weight: 500 },
        { pattern: /(?:^|[-_ ])(semibold|demibold)(?:[-_ ]|$)/i, weight: 600 },
        { pattern: /(?:^|[-_ ])(extrabold|ultrabold)(?:[-_ ]|$)/i, weight: 800 },
        { pattern: /(?:^|[-_ ])(black|heavy)(?:[-_ ]|$)/i, weight: 900 },
        { pattern: /(?:^|[-_ ])(bold)(?:[-_ ]|$)/i, weight: 700 }
      ];

      let weight = 400;
      let isItalic = /italic|oblique/i.test(base);

      for (const w of weightMap) {
        if (w.pattern.test(base)) {
          weight = w.weight;
          break;
        }
      }

      let cleanFamily = base
        .replace(/[-_](thin|hairline|extralight|ultralight|light|regular|normal|book|medium|semibold|demibold|extrabold|ultrabold|black|heavy|bold)/gi, '')
        .replace(/(thin|hairline|extralight|ultralight|light|regular|normal|book|medium|semibold|demibold|extrabold|ultrabold|black|heavy|bold)/gi, '')
        .replace(/[-_]?(italic|oblique)/gi, '')
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!cleanFamily) cleanFamily = base.replace(/[-_]/g, ' ').trim();

      cleanFamily = cleanFamily.split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      return {
        family: cleanFamily,
        weight,
        style: isItalic ? 'italic' : 'normal'
      };
    }

    function saveCustomFontMetadata(fontObj) {
      try {
        const raw = localStorage.getItem(CUSTOM_FONTS_STORAGE);
        let list = raw ? JSON.parse(raw) : [];
        const idx = list.findIndex(f => f.name.toLowerCase() === fontObj.name.toLowerCase());
        const dataToSave = {
          name: fontObj.name,
          family: fontObj.name,
          css: fontObj.css,
          weights: fontObj.weights || [400],
          category: fontObj.category || 'sans-serif',
          assetId: fontObj.assetId,
          assetMap: fontObj.assetMap || { [fontObj.weights && fontObj.weights[0] ? fontObj.weights[0] : 400]: fontObj.assetId }
        };

        if (idx >= 0) {
          list[idx] = {
            ...list[idx],
            ...dataToSave,
            weights: Array.from(new Set([...(list[idx].weights || []), ...(dataToSave.weights || [])])).sort((a, b) => a - b),
            assetMap: { ...(list[idx].assetMap || {}), ...(dataToSave.assetMap || {}) }
          };
        } else {
          list.push(dataToSave);
        }
        localStorage.setItem(CUSTOM_FONTS_STORAGE, JSON.stringify(list));
      } catch (e) {
        console.error('[fonts] erro ao salvar metadata de fonte:', e);
      }
    }

    async function initCustomFonts() {
      try {
        const raw = localStorage.getItem(CUSTOM_FONTS_STORAGE);
        if (!raw) return;
        const customFonts = JSON.parse(raw);
        if (!Array.isArray(customFonts)) return;

        for (const item of customFonts) {
          if (!item.name) continue;
          const weights = Array.isArray(item.weights) && item.weights.length > 0 ? item.weights : [400];
          const assetMap = item.assetMap || (item.assetId ? { 400: item.assetId } : {});

          for (const [wStr, assetId] of Object.entries(assetMap)) {
            if (!assetId) continue;
            let dataUrl = assetCache.get(assetId);
            if (!dataUrl) {
              dataUrl = await getAsset(assetId);
              if (dataUrl) assetCache.set(assetId, dataUrl);
            }
            if (dataUrl) {
              try {
                const base64 = String(dataUrl).split(',')[1];
                if (!base64) continue;
                const binaryStr = atob(base64);
                const len = binaryStr.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                  bytes[i] = binaryStr.charCodeAt(i);
                }
                const fontFace = new FontFace(item.name, bytes.buffer, {
                  weight: String(wStr),
                  style: 'normal'
                });
                await fontFace.load();
                document.fonts.add(fontFace);
              } catch (err) {
                console.warn('[fonts] Falha ao re-hidratar peso da fonte:', item.name, wStr, err);
              }
            }
          }

          if (!FONTS.some(f => f.name.toLowerCase() === item.name.toLowerCase())) {
            FONTS.push({
              css: item.css || `"${item.name}", sans-serif`,
              name: item.name,
              weights: weights.sort((a, b) => a - b),
              category: item.category || 'sans-serif',
              custom: true,
              assetId: item.assetId || (Object.values(assetMap)[0] || null),
              assetMap
            });
          }
        }
        refreshFontSelect();
      } catch (e) {
        console.error('[fonts] erro ao carregar fontes customizadas:', e);
      }
    }

    function iconPreviewUrl(iconId, color) {
      const [prefix, ...rest] = iconId.split(':');
      const base = `${ICONIFY_API}/${prefix}/${rest.join(':')}.svg?height=64`;
      return color ? `${base}&color=${encodeURIComponent(color)}` : base;
    }

    /* Mapa de termos comuns em Português -> Inglês para o acervo do Iconify */
    const PT_EN_MAP = {
      'coracao': 'heart', 'coração': 'heart', 'amor': 'love', 'cruz': 'cross',
      'igreja': 'church', 'oracao': 'praying', 'oração': 'praying', 'rezar': 'pray',
      'biblia': 'book', 'bíblia': 'book', 'livro': 'book', 'livros': 'books',
      'sol': 'sun', 'lua': 'moon', 'estrela': 'star', 'estrelas': 'stars',
      'brilho': 'sparkle', 'brilhos': 'sparkles', 'folha': 'leaf', 'planta': 'plant',
      'fogo': 'fire', 'chama': 'flame', 'seta': 'arrow', 'setas': 'arrows',
      'flecha': 'arrow', 'pomba': 'dove', 'passaro': 'bird', 'pássaro': 'bird',
      'vela': 'candle', 'agua': 'water', 'água': 'water', 'gota': 'drop',
      'montanha': 'mountain', 'montanhas': 'mountains', 'flor': 'flower', 'flores': 'flowers',
      'borboleta': 'butterfly', 'infinito': 'infinity', 'musica': 'music', 'música': 'music',
      'fone': 'headphones', 'ouvir': 'listen', 'usuario': 'user', 'usuário': 'user',
      'perfil': 'user', 'pessoa': 'person', 'pessoas': 'people', 'grupo': 'users',
      'calendario': 'calendar', 'calendário': 'calendar', 'relogio': 'clock', 'relógio': 'clock',
      'tempo': 'time', 'casa': 'home', 'inicio': 'home', 'início': 'home',
      'mensagem': 'message', 'comentario': 'comment', 'comentário': 'comment',
      'busca': 'search', 'pesquisa': 'search', 'lupa': 'search',
      'check': 'check', 'confirmar': 'check', 'certo': 'check', 'correto': 'check',
      'alerta': 'alert', 'aviso': 'warning', 'erro': 'error', 'perigo': 'danger',
      'fechar': 'close', 'cancelar': 'cancel', 'olho': 'eye', 'ver': 'eye',
      'cadeado': 'lock', 'seguranca': 'security', 'segurança': 'security',
      'trofeu': 'trophy', 'troféu': 'trophy', 'premio': 'award', 'prêmio': 'award',
      'coroa': 'crown', 'rei': 'king', 'rainha': 'queen', 'paz': 'peace',
      'mao': 'hand', 'mão': 'hand', 'maos': 'hands', 'mãos': 'hands',
      'esperanca': 'hope', 'esperança': 'hope', 'fe': 'faith', 'fé': 'faith',
      'luz': 'light', 'lampada': 'lamp', 'lâmpada': 'bulb', 'ideia': 'idea',
      'ceu': 'sky', 'céu': 'sky', 'nuvem': 'cloud', 'nuvens': 'clouds',
      'chuva': 'rain', 'arco-iris': 'rainbow', 'arco iris': 'rainbow',
      'arvore': 'tree', 'árvore': 'tree', 'cafe': 'coffee', 'café': 'coffee',
      'foto': 'camera', 'camera': 'camera', 'câmera': 'camera', 'video': 'video',
      'vídeo': 'video', 'play': 'play', 'ajuda': 'help', 'duvida': 'help',
      'dúvida': 'help', 'compartilhar': 'share', 'salvar': 'bookmark', 'guardar': 'bookmark',
      'lixeira': 'trash', 'apagar': 'delete', 'deletar': 'delete',
      'editar': 'edit', 'lapis': 'pencil', 'lápis': 'pencil', 'caneta': 'pen',
      'link': 'link', 'conectar': 'connect', 'cadeia': 'chain', 'globo': 'globe',
      'mundo': 'world', 'terra': 'earth', 'mapa': 'map', 'local': 'location',
      'dinheiro': 'money', 'moeda': 'coin', 'presente': 'gift'
    };

    function translateIconQuery(term) {
      if (!term) return term;
      const clean = term.toLowerCase().trim();
      if (PT_EN_MAP[clean]) return PT_EN_MAP[clean];
      const unaccented = clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (PT_EN_MAP[unaccented]) return PT_EN_MAP[unaccented];
      return term;
    }

    /* SVG remoto -> data URI local -> PNG. Devolve dataUrl + dimensões reais. */
    async function rasterizeIcon(iconId, color) {
      const [prefix, ...rest] = iconId.split(':');
      let url = `${ICONIFY_API}/${prefix}/${rest.join(':')}.svg?height=${RASTER_SIZE}`;
      if (color) url += `&color=${encodeURIComponent(color)}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error('Iconify respondeu ' + res.status);
      const svgText = await res.text();
      if (!svgText.trim().startsWith('<svg')) throw new Error('Ícone não encontrado');

      const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => {
          try {
            const i2 = new Image();
            i2.onload = () => resolve(i2);
            i2.onerror = () => reject(new Error('SVG inválido'));
            i2.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
          } catch {
            reject(new Error('SVG inválido'));
          }
        };
        i.src = dataUri;
      });

      const w = img.naturalWidth || RASTER_SIZE;
      const h = img.naturalHeight || RASTER_SIZE;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      return { dataUrl: c.toDataURL('image/png'), w, h };
    }

    function initIconLibraryController() {
      const modal = document.getElementById('canvas-library-modal');
      const openBtn = document.getElementById('canvas-library-btn');
      const closeBtn = document.getElementById('canvas-library-close');
      const cancelBtn = document.getElementById('canvas-library-cancel');
      const controlsWrap = document.getElementById('canvas-library-controls');
      const searchInput = document.getElementById('canvas-library-search');
      const colorInput = document.getElementById('canvas-library-color');
      const colorWrap = document.getElementById('canvas-library-color-wrap');
      const grid = document.getElementById('canvas-library-grid');
      const viewContainer = document.getElementById('canvas-library-view');
      const hint = document.getElementById('canvas-library-hint');
      const tabs = [...document.querySelectorAll('.canvas-lib-tab-oa')];

      if (!modal || !openBtn || !grid) return;

      let tab = 'photos';
      let buscaSeq = 0;

      // Estado do Unsplash
      let photosState = {
        query: '',
        page: 1,
        totalPages: 1,
        loading: false,
        hasMore: true
      };
      let photosBuscaSeq = 0;

      function renderResultadosFotos(photos, append = false) {
        if (!append) {
          grid.innerHTML = '';
        }
        if (!photos || !photos.length) {
          if (!append) {
            grid.innerHTML = '<div class="canvas-lib-empty-oa">Nenhuma foto encontrada. Tente outro termo (ex: <strong>minimalista</strong>, <strong>café</strong>, <strong>arquitetura</strong>).</div>';
          }
          return;
        }

        photos.forEach(photo => {
          if (!photo || !photo.urls) return;
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'canvas-photo-card-oa';
          item.title = photo.description || 'Inserir foto no post';
          if (photo.color) item.style.backgroundColor = photo.color;

          const img = document.createElement('img');
          img.src = photo.urls.small || photo.urls.regular;
          img.alt = photo.description || 'Unsplash photo';
          img.loading = 'lazy';
          img.onerror = () => { item.style.display = 'none'; };

          item.appendChild(img);
          item.addEventListener('click', () => inserirFoto(photo, item));
          grid.appendChild(item);
        });
      }

      async function buscarFotos(termo, page = 1, append = false) {
        if (photosState.loading && append) return;
        const seq = ++photosBuscaSeq;
        const q = (termo !== undefined ? termo : (searchInput ? searchInput.value : '')).trim();

        photosState.loading = true;
        photosState.query = q;
        photosState.page = page;

        if (!append) {
          grid.innerHTML = '<div class="canvas-photos-loading-oa">Carregando fotos…</div>';
        }

        try {
          if (!window.UnsplashService) {
            throw new Error('Serviço Unsplash não inicializado.');
          }

          let res;
          if (q) {
            res = await window.UnsplashService.searchPhotos(q, { page, perPage: 24 });
          } else {
            res = await window.UnsplashService.getEditorialPhotos({ page, perPage: 24 });
          }

          if (seq !== photosBuscaSeq) return;

          photosState.totalPages = res.totalPages || 1;
          photosState.hasMore = page < photosState.totalPages;

          const loader = grid.querySelector('.canvas-photos-loading-oa');
          if (loader) loader.remove();

          renderResultadosFotos(res.results || [], append);

          if (hint) {
            hint.textContent = '';
          }
        } catch (err) {
          if (seq !== photosBuscaSeq) return;
          console.error('[unsplash] erro na busca:', err);
          if (!append) {
            if (err.message === 'UNSPLASH_KEY_MISSING' || err.message === 'UNSPLASH_UNAUTHORIZED') {
              grid.innerHTML = '<div class="canvas-lib-empty-oa">Chave do Unsplash inválida ou ausente.</div>';
            } else if (err.message === 'UNSPLASH_RATE_LIMIT') {
              grid.innerHTML = '<div class="canvas-lib-empty-oa">Limite de requisições por hora do Unsplash atingido. Tente novamente mais tarde.</div>';
            } else {
              grid.innerHTML = '<div class="canvas-lib-empty-oa">Não foi possível carregar as fotos. Verifique sua conexão.</div>';
            }
          }
        } finally {
          photosState.loading = false;
        }
      }

      async function inserirFoto(photo, itemEl) {
        const frame = selectedFrame() || frames[0];
        if (!frame) {
          toast.info('Selecione um frame antes de inserir.');
          return;
        }
        itemEl.classList.add('is-busy');
        try {
          const photoData = await window.UnsplashService.downloadPhotoAsDataUrl(photo, 'regular', 1080);
          const aspect = photoData.aspectRatio || (photoData.width / photoData.height) || 0.8;
          const MAX_W = Math.min(800, Math.round(frame.w * 0.75));
          let w = MAX_W;
          let h = Math.round(w / aspect);
          if (h > frame.h * 0.85) {
            h = Math.round(frame.h * 0.85);
            w = Math.round(h * aspect);
          }

          await addImageNode(frame, photoData.dataUrl, w, h);
          toast.success('Foto adicionada ao post!');
          closeLibrary();
        } catch (e) {
          console.error('[unsplash] falha ao inserir foto:', photo.id, e);
          toast.error('Não foi possível inserir a imagem. Tente novamente.');
        } finally {
          itemEl.classList.remove('is-busy');
        }
      }

      // Estado do Mesh Gradient
      let currentMeshColors = [...MESH_PRESETS[0].colors];
      let currentMeshSeed = MESH_PRESETS[0].seed;

      // Estado do Catálogo de Fontes
      let fontCatalog = [];
      let fontCategoryFilter = 'all';
      let fontCatalogLoading = false;

      const corAtual = () => (tab === 'icons' ? (colorInput ? colorInput.value : '#FFFFFF') : null);

      function renderResultadosIcones(ids) {
        grid.innerHTML = '';
        if (!ids.length) {
          grid.innerHTML = '<div class="canvas-lib-empty-oa">Nada encontrado. Tente em inglês (ex: <strong>heart</strong>, <strong>cross</strong>, <strong>arrow</strong>) ou confira a ortografia.</div>';
          return;
        }
        const color = corAtual();
        ids.forEach(id => {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'canvas-lib-item-oa';
          item.title = id;
          const img = document.createElement('img');
          img.src = iconPreviewUrl(id, color);
          img.alt = id;
          img.loading = 'lazy';
          img.onerror = () => { item.style.display = 'none'; };
          item.appendChild(img);
          item.addEventListener('click', () => inserirIcone(id, item));
          grid.appendChild(item);
        });
      }

      async function buscarIcones(termo) {
        const seq = ++buscaSeq;
        const q = (termo || '').trim();

        if (!q) {
          renderResultadosIcones(tab === 'icons' ? SUGESTOES_ICONES : SUGESTOES_STICKERS);
          if (hint) hint.textContent = 'Sugestões — digite pra buscar no acervo inteiro.';
          return;
        }

        if (hint) hint.textContent = 'Buscando…';
        const queryTerm = translateIconQuery(q);

        try {
          let url = `${ICONIFY_API}/search?query=${encodeURIComponent(queryTerm)}&limit=200`;
          if (tab === 'stickers') url += `&prefixes=${STICKER_PREFIXES}`;
          const res = await fetch(url);
          const data = await res.json();
          if (seq !== buscaSeq) return;
          let ids = data.icons || [];

          if (!ids.length && queryTerm !== q) {
            let url2 = `${ICONIFY_API}/search?query=${encodeURIComponent(q)}&limit=200`;
            if (tab === 'stickers') url2 += `&prefixes=${STICKER_PREFIXES}`;
            const res2 = await fetch(url2);
            const data2 = await res2.json();
            if (seq === buscaSeq) ids = data2.icons || [];
          }

          renderResultadosIcones(ids);
          if (hint) {
            if (ids.length) {
              const transNote = queryTerm !== q ? ` (buscado por "${queryTerm}")` : '';
              hint.textContent = `${ids.length} resultado${ids.length === 1 ? '' : 's'}${transNote}`;
            } else {
              hint.textContent = '';
            }
          }
        } catch (e) {
          if (seq !== buscaSeq) return;
          console.error('[biblioteca] busca falhou', e);
          grid.innerHTML = '<div class="canvas-lib-empty-oa">Não consegui falar com o Iconify. Confira a conexão e tente de novo.</div>';
          if (hint) hint.textContent = '';
        }
      }

      async function inserirIcone(iconId, itemEl) {
        const frame = selectedFrame() || frames[0];
        if (!frame) {
          toast.info('Selecione um frame antes de inserir.');
          return;
        }
        itemEl.classList.add('is-busy');
        try {
          const { dataUrl, w, h } = await rasterizeIcon(iconId, corAtual());
          const alvo = Math.round(frame.w * 0.28);
          const escala = alvo / Math.max(w, h);
          await addImageNode(frame, dataUrl, Math.round(w * escala), Math.round(h * escala));
          closeLibrary();
        } catch (e) {
          console.error('[biblioteca] falha ao inserir', iconId, e);
          if (hint) hint.innerHTML = `<span style="color:#EF4444;">Não deu pra inserir "${iconId}". Tente outro.</span>`;
        } finally {
          itemEl.classList.remove('is-busy');
        }
      }

      // --- ABA GRADIENTES STUDIO (INTERATIVO) ---
      let gradientStudioState = {
        type: 'mesh', // 'mesh' | 'linear' | 'radial' | 'conic'
        colors: ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B'],
        noise: 16,
        blur: 0,       // Desfoque / Fusão Real de Cores (sem comer as bordas)
        feather: 0,    // Suavizar Borda (esmaecimento da borda / vinheta)
        angle: 135,
        seed: 42
      };

      const HARMONIC_PALETTES = [
        ['#2563EB', '#7C3AED', '#DB2777', '#F59E0B'],
        ['#0F172A', '#1E293B', '#334155', '#475569'],
        ['#06B6D4', '#3B82F6', '#6366F1', '#A855F7'],
        ['#F43F5E', '#FB7185', '#FDA4AF', '#FFE4E6'],
        ['#10B981', '#059669', '#047857', '#065F46'],
        ['#F59E0B', '#EF4444', '#EC4899', '#8B5CF6'],
        ['#E2E8F0', '#CBD5E1', '#94A3B8', '#64748B'],
        ['#18181B', '#27272A', '#3F3F46', '#52525B']
      ];

      function pseudoRandom(s) {
        const x = Math.sin(s) * 10000;
        return x - Math.floor(x);
      }

      async function renderStudioGradientToCanvas(targetCanvas, state) {
        if (!targetCanvas) return;
        const ctx = targetCanvas.getContext('2d');
        const w = targetCanvas.width;
        const h = targetCanvas.height;

        ctx.clearRect(0, 0, w, h);
        ctx.save();

        const colors = state.colors && state.colors.length > 0 ? state.colors : ['#2563EB', '#7C3AED', '#DB2777', '#F59E0B'];
        const blurPx = Math.max(0, Number(state.blur) || 0);

        // Se tiver blur de cores, renderizamos num canvas expandido (overscan) para não desbotar as bordas
        const pad = blurPx > 0 ? Math.ceil(blurPx * 2.5) : 0;
        const drawW = w + pad * 2;
        const drawH = h + pad * 2;

        const drawCanvas = document.createElement('canvas');
        drawCanvas.width = drawW;
        drawCanvas.height = drawH;
        const dCtx = drawCanvas.getContext('2d');

        if (state.type === 'linear') {
          const rad = ((state.angle || 0) * Math.PI) / 180;
          const cx = drawW / 2;
          const cy = drawH / 2;
          const len = Math.sqrt(drawW * drawW + drawH * drawH) / 2;
          const x0 = cx - Math.cos(rad) * len;
          const y0 = cy - Math.sin(rad) * len;
          const x1 = cx + Math.cos(rad) * len;
          const y1 = cy + Math.sin(rad) * len;

          const grad = dCtx.createLinearGradient(x0, y0, x1, y1);
          const n = colors.length;
          colors.forEach((col, i) => {
            const start = i / n;
            const end = (i + 1) / n;
            grad.addColorStop(start, col);
            grad.addColorStop(end - 0.0001, col);
          });
          dCtx.fillStyle = grad;
          dCtx.fillRect(0, 0, drawW, drawH);
        } else if (state.type === 'radial') {
          const cx = drawW / 2;
          const cy = drawH / 2;
          const radius = Math.max(drawW, drawH) * 0.75;
          const grad = dCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
          const n = colors.length;
          colors.forEach((col, i) => {
            const start = i / n;
            const end = (i + 1) / n;
            grad.addColorStop(start, col);
            grad.addColorStop(end - 0.0001, col);
          });
          dCtx.fillStyle = grad;
          dCtx.fillRect(0, 0, drawW, drawH);
        } else if (state.type === 'conic') {
          const cx = drawW / 2;
          const cy = drawH / 2;
          const rad = ((state.angle || 0) * Math.PI) / 180;
          if (typeof dCtx.createConicGradient === 'function') {
            const grad = dCtx.createConicGradient(rad, cx, cy);
            const n = colors.length;
            colors.forEach((col, i) => {
              const start = i / n;
              const end = (i + 1) / n;
              grad.addColorStop(start, col);
              grad.addColorStop(end - 0.0001, col);
            });
            dCtx.fillStyle = grad;
            dCtx.fillRect(0, 0, drawW, drawH);
          } else {
            dCtx.fillStyle = colors[0];
            dCtx.fillRect(0, 0, drawW, drawH);
          }
        } else {
          // Mesh Fluido: Multi-ponto orgânico de alta saturação
          const baseSeed = Number(state.seed) || 42;
          const defaultPos = [
            [drawW * 0.85, drawH * 0.15],
            [drawW * 0.15, drawH * 0.85],
            [drawW * 0.85, drawH * 0.85],
            [drawW * 0.50, drawH * 0.45],
            [drawW * 0.15, drawH * 0.15],
            [drawW * 0.50, drawH * 0.90]
          ];

          dCtx.fillStyle = colors[0];
          dCtx.fillRect(0, 0, drawW, drawH);

          colors.slice(1).forEach((col, i) => {
            const def = defaultPos[i % defaultPos.length];
            const rx = (pseudoRandom(baseSeed + i * 17) - 0.5) * (drawW * 0.35);
            const ry = (pseudoRandom(baseSeed + i * 29) - 0.5) * (drawH * 0.35);
            const px = Math.max(0, Math.min(drawW, def[0] + rx));
            const py = Math.max(0, Math.min(drawH, def[1] + ry));
            const radius = Math.max(drawW, drawH) * (0.85 + pseudoRandom(baseSeed + i * 7) * 0.3);

            const g = dCtx.createRadialGradient(px, py, 0, px, py, radius);
            g.addColorStop(0, col);
            g.addColorStop(0.65, col + 'AA');
            g.addColorStop(1, 'transparent');
            dCtx.fillStyle = g;
            dCtx.fillRect(0, 0, drawW, drawH);
          });
        }

        // Aplica o Blur Real de Cores no canvas expandido
        if (blurPx > 0) {
          const blurredCanvas = document.createElement('canvas');
          blurredCanvas.width = drawW;
          blurredCanvas.height = drawH;
          const bCtx = blurredCanvas.getContext('2d');
          bCtx.filter = `blur(${blurPx}px)`;
          bCtx.drawImage(drawCanvas, 0, 0);
          // Recorta o centro exato para targetCanvas sem afetar as bordas
          ctx.drawImage(blurredCanvas, pad, pad, w, h, 0, 0, w, h);
        } else {
          ctx.drawImage(drawCanvas, pad, pad, w, h, 0, 0, w, h);
        }

        // 2. Esmaecer Bordas / Feather (se > 0)
        if (state.feather > 0) {
          const fCanvas = document.createElement('canvas');
          fCanvas.width = w;
          fCanvas.height = h;
          const fCtx = fCanvas.getContext('2d');
          fCtx.filter = `blur(${state.feather}px)`;
          fCtx.drawImage(targetCanvas, 0, 0, w, h);
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(fCanvas, 0, 0, w, h);
        }

        // 3. Aplica Ruído / Noise Grain (se > 0)
        if (state.noise > 0) {
          const noiseAmount = (state.noise / 100) * 0.45;
          const noiseTile = document.createElement('canvas');
          const tw = 256;
          const th = 256;
          noiseTile.width = tw;
          noiseTile.height = th;
          const nCtx = noiseTile.getContext('2d');
          const imgData = nCtx.createImageData(tw, th);
          const data = imgData.data;
          for (let i = 0; i < data.length; i += 4) {
            const v = (Math.random() * 255) | 0;
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
            data[i + 3] = (Math.random() * 255 * noiseAmount) | 0;
          }
          nCtx.putImageData(imgData, 0, 0);

          ctx.save();
          ctx.globalCompositeOperation = 'overlay';
          const pattern = ctx.createPattern(noiseTile, 'repeat');
          if (pattern) {
            ctx.fillStyle = pattern;
            ctx.fillRect(0, 0, w, h);
          }
          ctx.restore();
        }

        ctx.restore();
      }

      async function renderStudioGradientToDataUrl(state, w = 1080, h = 1350) {
        const offCanvas = document.createElement('canvas');
        offCanvas.width = w;
        offCanvas.height = h;
        await renderStudioGradientToCanvas(offCanvas, state);
        return offCanvas.toDataURL('image/png');
      }

      async function renderGradientsView() {
        if (!viewContainer) return;
        viewContainer.innerHTML = `
          <div class="canvas-grad-panel-oa">
            <!-- Coluna Esquerda: Preview ao Vivo + Ações -->
            <div class="canvas-grad-preview-col-oa">
              <canvas class="canvas-grad-canvas-oa" id="canvas-grad-live-preview" width="360" height="450"></canvas>
              
              <div class="canvas-grad-actions-oa">
                <button type="button" class="openpanel-btn-primary" id="canvas-grad-btn-apply-bg" style="width: 100%; justify-content: center;">
                  <i data-lucide="image" style="width: 14px; height: 14px;"></i>
                  <span>Aplicar como Fundo do Post</span>
                </button>
                <button type="button" class="openpanel-btn-secondary" id="canvas-grad-btn-insert-elem" style="width: 100%; justify-content: center;">
                  <i data-lucide="sparkles" style="width: 14px; height: 14px;"></i>
                  <span>Inserir como Card / Elemento</span>
                </button>
              </div>
            </div>

            <!-- Coluna Direita: Controles Interativos -->
            <div class="canvas-grad-controls-col-oa">
              <!-- Seletor de Tipo -->
              <div>
                <label class="canvas-grad-section-label-oa">Tipo de Gradiente:</label>
                <div class="canvas-grad-types-oa">
                  <button type="button" class="canvas-grad-type-btn-oa ${gradientStudioState.type === 'mesh' ? 'is-active' : ''}" data-type="mesh"><i data-lucide="waves" style="width: 13px; height: 13px;"></i><span>Mesh Fluido</span></button>
                  <button type="button" class="canvas-grad-type-btn-oa ${gradientStudioState.type === 'linear' ? 'is-active' : ''}" data-type="linear"><i data-lucide="arrow-up-right" style="width: 13px; height: 13px;"></i><span>Linear</span></button>
                  <button type="button" class="canvas-grad-type-btn-oa ${gradientStudioState.type === 'radial' ? 'is-active' : ''}" data-type="radial"><i data-lucide="circle" style="width: 13px; height: 13px;"></i><span>Radial</span></button>
                  <button type="button" class="canvas-grad-type-btn-oa ${gradientStudioState.type === 'conic' ? 'is-active' : ''}" data-type="conic"><i data-lucide="clock" style="width: 13px; height: 13px;"></i><span>Cônico</span></button>
                </div>
              </div>

              <!-- Cores -->
              <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; gap: 6px; flex-wrap: wrap;">
                  <label class="canvas-grad-section-label-oa" id="canvas-grad-colors-title">Cores (${gradientStudioState.colors.length}):</label>
                  <div style="display: flex; gap: 4px; align-items: center;">
                    <button type="button" class="canvas-font-chip-oa" id="canvas-grad-btn-invert-palette" title="Inverter a ordem das cores"><i data-lucide="arrow-left-right" style="width: 12px; height: 12px;"></i> Inverter</button>
                    <button type="button" class="canvas-font-chip-oa" id="canvas-grad-btn-rotate-palette" title="Girar/deslocar a posição das cores"><i data-lucide="rotate-cw" style="width: 12px; height: 12px;"></i> Girar</button>
                    <button type="button" class="canvas-font-chip-oa" id="canvas-grad-btn-random-palette" title="Sortear nova paleta"><i data-lucide="dices" style="width: 12px; height: 12px;"></i> Sortear</button>
                  </div>
                </div>
                <div class="canvas-grad-colors-grid-oa" id="canvas-grad-colors-container"></div>
              </div>

              <!-- Slider Ruído / Grain -->
              <div class="canvas-grad-slider-group-oa">
                <div class="canvas-grad-slider-header-oa">
                  <span>Textura de Ruído (Grain)</span>
                  <span class="canvas-grad-slider-val-oa" id="canvas-grad-noise-val">${gradientStudioState.noise}%</span>
                </div>
                <input type="range" class="canvas-grad-range-input-oa" id="canvas-grad-noise-input" min="0" max="50" value="${gradientStudioState.noise}">
              </div>

              <!-- Slider Blur Real (Desfoque de Cores) -->
              <div class="canvas-grad-slider-group-oa">
                <div class="canvas-grad-slider-header-oa">
                  <span>Desfoque de Cores (Blur)</span>
                  <span class="canvas-grad-slider-val-oa" id="canvas-grad-blur-val">${gradientStudioState.blur}px</span>
                </div>
                <input type="range" class="canvas-grad-range-input-oa" id="canvas-grad-blur-input" min="0" max="80" value="${gradientStudioState.blur}">
              </div>

              <!-- Slider Feather (Suavizar Bordas) -->
              <div class="canvas-grad-slider-group-oa">
                <div class="canvas-grad-slider-header-oa">
                  <span>Esmaecer Bordas (Feather)</span>
                  <span class="canvas-grad-slider-val-oa" id="canvas-grad-feather-val">${gradientStudioState.feather}px</span>
                </div>
                <input type="range" class="canvas-grad-range-input-oa" id="canvas-grad-feather-input" min="0" max="60" value="${gradientStudioState.feather}">
              </div>

              <!-- Slider Ângulo (visível se linear/conic) -->
              <div class="canvas-grad-slider-group-oa" id="canvas-grad-angle-group" style="${gradientStudioState.type === 'linear' || gradientStudioState.type === 'conic' ? 'display: flex;' : 'display: none;'}">
                <div class="canvas-grad-slider-header-oa">
                  <span>Ângulo de Direção</span>
                  <span class="canvas-grad-slider-val-oa" id="canvas-grad-angle-val">${gradientStudioState.angle}°</span>
                </div>
                <input type="range" class="canvas-grad-range-input-oa" id="canvas-grad-angle-input" min="0" max="360" value="${gradientStudioState.angle}">
              </div>

              <!-- Botão Distorção Mesh (visível se mesh) -->
              <div id="canvas-grad-seed-group" style="${gradientStudioState.type === 'mesh' ? 'display: block;' : 'display: none;'}">
                <button type="button" class="openpanel-btn-secondary" id="canvas-grad-btn-seed" style="width: 100%; justify-content: center;">
                  <i data-lucide="dices" style="width: 14px; height: 14px;"></i>
                  <span>Nova Variação / Distorção</span>
                </button>
              </div>
            </div>
          </div>
        `;

        if (window.lucide) lucide.createIcons();

        // Seletor de Tipo
        viewContainer.querySelectorAll('.canvas-grad-type-btn-oa').forEach(btn => {
          btn.addEventListener('click', () => {
            gradientStudioState.type = btn.dataset.type;
            viewContainer.querySelectorAll('.canvas-grad-type-btn-oa').forEach(b => b.classList.toggle('is-active', b === btn));
            
            const angleGroup = document.getElementById('canvas-grad-angle-group');
            if (angleGroup) angleGroup.style.display = (gradientStudioState.type === 'linear' || gradientStudioState.type === 'conic') ? 'flex' : 'none';

            const seedGroup = document.getElementById('canvas-grad-seed-group');
            if (seedGroup) seedGroup.style.display = (gradientStudioState.type === 'mesh') ? 'block' : 'none';

            updateLiveStudioPreview();
          });
        });

        // Cores
        renderStudioColorPickers();

        // Inverter Cores
        const invertPalBtn = document.getElementById('canvas-grad-btn-invert-palette');
        if (invertPalBtn) {
          invertPalBtn.addEventListener('click', () => {
            gradientStudioState.colors.reverse();
            renderStudioColorPickers();
            updateLiveStudioPreview();
          });
        }

        // Girar/Deslocar Cores
        const rotatePalBtn = document.getElementById('canvas-grad-btn-rotate-palette');
        if (rotatePalBtn) {
          rotatePalBtn.addEventListener('click', () => {
            if (gradientStudioState.colors.length > 1) {
              const first = gradientStudioState.colors.shift();
              gradientStudioState.colors.push(first);
              renderStudioColorPickers();
              updateLiveStudioPreview();
            }
          });
        }

        // Sortear Paleta
        const randPalBtn = document.getElementById('canvas-grad-btn-random-palette');
        if (randPalBtn) {
          randPalBtn.addEventListener('click', () => {
            const pal = HARMONIC_PALETTES[Math.floor(Math.random() * HARMONIC_PALETTES.length)];
            gradientStudioState.colors = [...pal];
            renderStudioColorPickers();
            updateLiveStudioPreview();
          });
        }

        // Ruído Input
        const noiseInput = document.getElementById('canvas-grad-noise-input');
        const noiseVal = document.getElementById('canvas-grad-noise-val');
        if (noiseInput && noiseVal) {
          noiseInput.addEventListener('input', (e) => {
            gradientStudioState.noise = Number(e.target.value);
            noiseVal.textContent = `${gradientStudioState.noise}%`;
            updateLiveStudioPreview();
          });
        }

        // Blur Input (Desfoque de Cores)
        const blurInput = document.getElementById('canvas-grad-blur-input');
        const blurVal = document.getElementById('canvas-grad-blur-val');
        if (blurInput && blurVal) {
          blurInput.addEventListener('input', (e) => {
            gradientStudioState.blur = Number(e.target.value);
            blurVal.textContent = `${gradientStudioState.blur}px`;
            updateLiveStudioPreview();
          });
        }

        // Feather Input (Esmaecer Bordas)
        const featherInput = document.getElementById('canvas-grad-feather-input');
        const featherVal = document.getElementById('canvas-grad-feather-val');
        if (featherInput && featherVal) {
          featherInput.addEventListener('input', (e) => {
            gradientStudioState.feather = Number(e.target.value);
            featherVal.textContent = `${gradientStudioState.feather}px`;
            updateLiveStudioPreview();
          });
        }

        // Ângulo Input
        const angleInput = document.getElementById('canvas-grad-angle-input');
        const angleVal = document.getElementById('canvas-grad-angle-val');
        if (angleInput && angleVal) {
          angleInput.addEventListener('input', (e) => {
            gradientStudioState.angle = Number(e.target.value);
            angleVal.textContent = `${gradientStudioState.angle}°`;
            updateLiveStudioPreview();
          });
        }

        // Seed Botão
        const seedBtn = document.getElementById('canvas-grad-btn-seed');
        if (seedBtn) {
          seedBtn.addEventListener('click', () => {
            gradientStudioState.seed = Math.floor(Math.random() * 1000) + 1;
            updateLiveStudioPreview();
          });
        }

        // Botão Aplicar como Fundo
        const applyBgBtn = document.getElementById('canvas-grad-btn-apply-bg');
        if (applyBgBtn) {
          applyBgBtn.addEventListener('click', async () => {
            const frame = selectedFrame() || frames[0];
            if (!frame) {
              toast.info('Selecione um post no canvas primeiro.');
              return;
            }
            applyBgBtn.disabled = true;
            applyBgBtn.innerHTML = '<i data-lucide="loader" class="oa-spin" style="width: 14px; height: 14px;"></i><span>Aplicando…</span>';
            if (window.lucide) lucide.createIcons({ root: applyBgBtn });
            try {
              const dataUrl = await renderStudioGradientToDataUrl(gradientStudioState, frame.w || 1080, frame.h || 1350);
              const assetId = 'asset_grad_bg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
              assetCache.set(assetId, dataUrl);
              await saveAsset(assetId, dataUrl);

              frame.bgAssetId = assetId;
              frame.bgImage = null;
              frame.bg = null;
              frame.bgRecipe = { ...gradientStudioState };
              frame.bgOverlay = 0;
              frame.bgBlur = 0;

              applyFrameBackground(frame);
              save();
              updateTextToolbar();
              closeLibrary();
              toast.success('Fundo do post atualizado com sucesso!');
            } catch (err) {
              console.error('[gradient-studio] falha ao aplicar fundo:', err);
              toast.error('Falha ao renderizar gradiente.');
            } finally {
              applyBgBtn.disabled = false;
              applyBgBtn.innerHTML = '<i data-lucide="image" style="width: 14px; height: 14px;"></i><span>Aplicar como Fundo do Post</span>';
              if (window.lucide) lucide.createIcons({ root: applyBgBtn });
            }
          });
        }

        // Botão Inserir como Elemento
        const insertElemBtn = document.getElementById('canvas-grad-btn-insert-elem');
        if (insertElemBtn) {
          insertElemBtn.addEventListener('click', async () => {
            const frame = selectedFrame() || frames[0];
            if (!frame) {
              toast.info('Selecione um post no canvas primeiro.');
              return;
            }
            insertElemBtn.disabled = true;
            insertElemBtn.innerHTML = '<i data-lucide="loader" class="oa-spin" style="width: 14px; height: 14px;"></i><span>Inserindo…</span>';
            if (window.lucide) lucide.createIcons({ root: insertElemBtn });
            try {
              const dataUrl = await renderStudioGradientToDataUrl(gradientStudioState, 600, 600);
              addImageNode(frame, dataUrl, 600, 600);
              closeLibrary();
              toast.success('Card gradiente inserido no post!');
            } catch (err) {
              console.error('[gradient-studio] falha ao inserir elemento:', err);
              toast.error('Falha ao criar elemento de gradiente.');
            } finally {
              insertElemBtn.disabled = false;
              insertElemBtn.innerHTML = '<i data-lucide="sparkles" style="width: 14px; height: 14px;"></i><span>Inserir como Card / Elemento</span>';
              if (window.lucide) lucide.createIcons({ root: insertElemBtn });
            }
          });
        }

        updateLiveStudioPreview();
      }

      let studioDragIdx = null;

      function renderStudioColorPickers() {
        const container = document.getElementById('canvas-grad-colors-container');
        if (!container) return;
        container.innerHTML = '';

        const title = document.getElementById('canvas-grad-colors-title');
        if (title) title.textContent = `Cores (${gradientStudioState.colors.length}):`;

        gradientStudioState.colors.forEach((col, idx) => {
          const item = document.createElement('div');
          item.className = 'canvas-grad-color-item-oa';
          item.draggable = true;
          item.dataset.idx = String(idx);
          item.title = 'Arraste para reposicionar ou use as setas';

          item.innerHTML = `
            <span class="canvas-grad-color-handle-oa" title="Arraste para trocar ordem">⋮⋮</span>
            <input type="color" class="canvas-grad-color-pick-oa" value="${col}" data-idx="${idx}">
            <span class="canvas-grad-color-hex-oa">${col.toUpperCase()}</span>
            <div class="canvas-grad-color-arrows-oa">
              ${idx > 0 ? `<button type="button" class="canvas-grad-color-arrow-oa" data-action="prev" title="Mover para esquerda">‹</button>` : ''}
              ${idx < gradientStudioState.colors.length - 1 ? `<button type="button" class="canvas-grad-color-arrow-oa" data-action="next" title="Mover para direita">›</button>` : ''}
            </div>
            ${gradientStudioState.colors.length > 2 ? `<button type="button" class="canvas-grad-color-del-oa" data-idx="${idx}" title="Remover cor">✕</button>` : ''}
          `;

          const pick = item.querySelector('.canvas-grad-color-pick-oa');
          if (pick) {
            pick.addEventListener('input', (e) => {
              gradientStudioState.colors[idx] = e.target.value;
              const label = item.querySelector('.canvas-grad-color-hex-oa');
              if (label) label.textContent = e.target.value.toUpperCase();
              updateLiveStudioPreview();
            });
          }

          // Setas de troca rápida
          item.querySelectorAll('.canvas-grad-color-arrow-oa').forEach(arrowBtn => {
            arrowBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const action = arrowBtn.dataset.action;
              const targetIdx = action === 'prev' ? idx - 1 : idx + 1;
              if (targetIdx >= 0 && targetIdx < gradientStudioState.colors.length) {
                const temp = gradientStudioState.colors[idx];
                gradientStudioState.colors[idx] = gradientStudioState.colors[targetIdx];
                gradientStudioState.colors[targetIdx] = temp;
                renderStudioColorPickers();
                updateLiveStudioPreview();
              }
            });
          });

          // Arrastar e soltar para trocar cores
          item.addEventListener('dragstart', (e) => {
            studioDragIdx = idx;
            item.classList.add('is-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(idx));
          });

          item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            item.classList.add('is-dragover');
          });

          item.addEventListener('dragleave', () => {
            item.classList.remove('is-dragover');
          });

          item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.classList.remove('is-dragover');
            if (studioDragIdx !== null && studioDragIdx !== idx) {
              const movedColor = gradientStudioState.colors.splice(studioDragIdx, 1)[0];
              gradientStudioState.colors.splice(idx, 0, movedColor);
              studioDragIdx = null;
              renderStudioColorPickers();
              updateLiveStudioPreview();
            }
          });

          item.addEventListener('dragend', () => {
            item.classList.remove('is-dragging', 'is-dragover');
            studioDragIdx = null;
          });

          const delBtn = item.querySelector('.canvas-grad-color-del-oa');
          if (delBtn) {
            delBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              gradientStudioState.colors.splice(idx, 1);
              renderStudioColorPickers();
              updateLiveStudioPreview();
            });
          }

          container.appendChild(item);
        });

        if (gradientStudioState.colors.length < 6) {
          const addBtn = document.createElement('button');
          addBtn.type = 'button';
          addBtn.className = 'canvas-grad-add-color-btn-oa';
          addBtn.textContent = '+ Cor';
          addBtn.addEventListener('click', () => {
            const randomColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
            gradientStudioState.colors.push(randomColor);
            renderStudioColorPickers();
            updateLiveStudioPreview();
          });
          container.appendChild(addBtn);
        }
      }

      let studioPreviewDebounce = null;
      function updateLiveStudioPreview() {
        if (studioPreviewDebounce) clearTimeout(studioPreviewDebounce);
        studioPreviewDebounce = setTimeout(async () => {
          const canvas = document.getElementById('canvas-grad-live-preview');
          if (!canvas) return;
          await renderStudioGradientToCanvas(canvas, gradientStudioState);
        }, 16);
      }

      // --- ABA FONTES & TIPOGRAFIA ---
      async function loadFontCatalog() {
        if (fontCatalog.length > 0) return fontCatalog;
        if (fontCatalogLoading) return [];
        fontCatalogLoading = true;
        try {
          if (hint) hint.textContent = 'Carregando catálogo de fontes do Fontsource…';
          const res = await fetch('https://api.fontsource.org/v1/fonts');
          const data = await res.json();
          fontCatalog = Array.isArray(data) ? data : [];
          if (hint) hint.textContent = `${fontCatalog.length} famílias disponíveis`;
          return fontCatalog;
        } catch (e) {
          console.error('[fonts] falha ao carregar catálogo Fontsource:', e);
          if (hint) hint.textContent = 'Não foi possível carregar o catálogo de fontes online.';
          return [];
        } finally {
          fontCatalogLoading = false;
        }
      }

      async function renderFontsView() {
        if (!viewContainer) return;
        viewContainer.innerHTML = `
          <!-- Filtro de Categorias -->
          <div class="canvas-font-chips-oa">
            <button type="button" class="canvas-font-chip-oa ${fontCategoryFilter === 'all' ? 'is-active' : ''}" data-cat="all">Todas</button>
            <button type="button" class="canvas-font-chip-oa ${fontCategoryFilter === 'custom' ? 'is-active' : ''}" data-cat="custom">⭐ Minhas Fontes</button>
            <button type="button" class="canvas-font-chip-oa ${fontCategoryFilter === 'sans-serif' ? 'is-active' : ''}" data-cat="sans-serif">Sans-Serif</button>
            <button type="button" class="canvas-font-chip-oa ${fontCategoryFilter === 'serif' ? 'is-active' : ''}" data-cat="serif">Serif</button>
            <button type="button" class="canvas-font-chip-oa ${fontCategoryFilter === 'display' ? 'is-active' : ''}" data-cat="display">Display</button>
            <button type="button" class="canvas-font-chip-oa ${fontCategoryFilter === 'handwriting' ? 'is-active' : ''}" data-cat="handwriting">Handwriting</button>
            <button type="button" class="canvas-font-chip-oa ${fontCategoryFilter === 'monospace' ? 'is-active' : ''}" data-cat="monospace">Monospace</button>
          </div>

          <!-- Dropzone de Arquivo Local -->
          <div class="canvas-font-dropzone-oa" id="canvas-font-dropzone">
            <i data-lucide="upload" style="width: 14px; height: 14px;"></i>
            <span>Arraste seu arquivo <strong>.zip</strong>, <strong>.ttf</strong>, <strong>.otf</strong> ou <strong>.woff2</strong> aqui ou clique para importar</span>
            <input type="file" id="canvas-font-file-input" accept=".zip,.ttf,.otf,.woff,.woff2,application/zip,application/x-zip-compressed" multiple style="display: none;">
          </div>

          <!-- Lista de Fontes -->
          <div class="canvas-font-list-oa" id="canvas-font-list"></div>
        `;

        if (window.lucide) lucide.createIcons();

        // Filtro por categoria
        viewContainer.querySelectorAll('.canvas-font-chip-oa').forEach(chip => {
          chip.addEventListener('click', () => {
            fontCategoryFilter = chip.dataset.cat;
            viewContainer.querySelectorAll('.canvas-font-chip-oa').forEach(c => c.classList.toggle('is-active', c === chip));
            filterAndRenderFontList();
          });
        });

        // Configura Dropzone e Importação de Arquivos Locais
        const dropzone = document.getElementById('canvas-font-dropzone');
        const fileInput = document.getElementById('canvas-font-file-input');
        if (dropzone && fileInput) {
          dropzone.addEventListener('click', () => fileInput.click());
          dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('is-dragover');
          });
          dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
          dropzone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropzone.classList.remove('is-dragover');
            const files = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : null;
            if (files && files.length > 0) await importLocalFontFile(files);
          });
          fileInput.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (files && files.length > 0) await importLocalFontFile(files);
            fileInput.value = '';
          });
        }

        if (fontCatalog.length === 0) {
          await loadFontCatalog();
        }
        filterAndRenderFontList();
      }

      const loadedPreviewFonts = new Set();
      let fontPreviewObserver = null;

      function setupFontPreviewObserver(listEl) {
        if (fontPreviewObserver) fontPreviewObserver.disconnect();
        fontPreviewObserver = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              const card = entry.target;
              const fontId = card.dataset.fontId;
              const fontFamily = card.dataset.fontFamily;
              const fontSub = card.dataset.fontSub || 'latin';
              const fontWeight = card.dataset.fontWeight || '400';
              if (fontPreviewObserver) fontPreviewObserver.unobserve(card);

              if (!fontId || loadedPreviewFonts.has(fontId)) return;
              loadedPreviewFonts.add(fontId);

              const fontUrl = `https://cdn.jsdelivr.net/fontsource/fonts/${fontId}@latest/${fontSub}-${fontWeight}-normal.woff2`;
              const previewFace = new FontFace(fontFamily, `url(${fontUrl}) format('woff2')`);
              previewFace.load().then(loaded => {
                document.fonts.add(loaded);
                const previewEl = card.querySelector('.canvas-font-preview-text-oa');
                if (previewEl) previewEl.style.fontFamily = `"${fontFamily}", sans-serif`;
              }).catch(() => {
                const fallbackFace = new FontFace(fontFamily, `url(https://cdn.jsdelivr.net/fontsource/fonts/${fontId}@latest/latin-400-normal.woff2) format('woff2')`);
                fallbackFace.load().then(l => {
                  document.fonts.add(l);
                  const previewEl = card.querySelector('.canvas-font-preview-text-oa');
                  if (previewEl) previewEl.style.fontFamily = `"${fontFamily}", sans-serif`;
                }).catch(() => {});
              });
            }
          });
        }, { root: listEl, rootMargin: '150px' });
      }

      function filterAndRenderFontList() {
        const listEl = document.getElementById('canvas-font-list');
        if (!listEl) return;
        listEl.innerHTML = '';
        setupFontPreviewObserver(listEl);

        const q = (searchInput ? searchInput.value : '').toLowerCase().trim();
        let results = [];

        if (fontCategoryFilter === 'custom') {
          // Apenas fontes customizadas importadas pelo usuário
          const customList = FONTS.filter(fo => fo.custom).map(fo => ({
            id: fo.assetId || fo.name.toLowerCase().replace(/\s+/g, '-'),
            family: fo.name,
            category: 'Minhas Fontes',
            custom: true,
            assetId: fo.assetId,
            weights: fo.weights || [400, 700]
          }));
          results = customList;
        } else if (fontCategoryFilter !== 'all') {
          results = fontCatalog.filter(f => f.category === fontCategoryFilter);
        } else {
          // Em 'Todas', exibimos customizadas primeiro
          const customList = FONTS.filter(fo => fo.custom).map(fo => ({
            id: fo.assetId || fo.name.toLowerCase().replace(/\s+/g, '-'),
            family: fo.name,
            category: 'Minhas Fontes',
            custom: true,
            assetId: fo.assetId,
            weights: fo.weights || [400, 700]
          }));
          results = [...customList, ...fontCatalog];
        }

        if (q) {
          results = results.filter(f => f.family.toLowerCase().includes(q) || (f.id && f.id.toLowerCase().includes(q)));
        }

        if (results.length === 0) {
          if (fontCategoryFilter === 'custom') {
            listEl.innerHTML = `
              <div class="canvas-lib-empty-oa" style="padding: 32px 16px;">
                <div style="font-size: 14px; font-weight: 500; margin-bottom: 6px; color: #FFFFFF;">Você ainda não importou nenhuma fonte.</div>
                <div style="font-size: 12px; color: rgba(255, 255, 255, 0.5);">Arraste um arquivo <strong>.zip</strong>, <strong>.ttf</strong> ou <strong>.otf</strong> na área acima para importar suas fontes favoritas!</div>
              </div>
            `;
          } else {
            listEl.innerHTML = '<div class="canvas-lib-empty-oa">Nenhuma família encontrada com este filtro.</div>';
          }
          if (hint) hint.textContent = '0 fontes encontradas';
          return;
        }

        // Limita a 50 itens para máxima performance
        const displayList = results.slice(0, 50);

        displayList.forEach(f => {
          const isInstalled = f.custom || FONTS.some(fo => fo.name.toLowerCase() === f.family.toLowerCase());
          const card = document.createElement('div');
          card.className = 'canvas-font-card-oa';
          const weight = (f.weights && f.weights.includes(400)) ? '400' : (f.weights ? String(f.weights[0]) : '400');
          const subset = (f.subsets && f.subsets.includes('latin')) ? 'latin' : (f.defSubset || 'latin');
          card.dataset.fontId = f.id;
          card.dataset.fontFamily = f.family;
          card.dataset.fontSub = subset;
          card.dataset.fontWeight = weight;

          const weightBadge = f.custom
            ? `⭐ Minhas Fontes${f.weights && f.weights.length > 1 ? ` · ${f.weights.length} pesos (${f.weights.map(w => WEIGHT_NAMES[w] || w).join(', ')})` : ''}`
            : (f.category || 'font');

          card.innerHTML = `
            <div class="canvas-font-info-oa">
              <div class="canvas-font-header-row-oa">
                <span class="canvas-font-title-oa">${f.family}</span>
                <span class="canvas-font-badge-oa">${weightBadge}</span>
              </div>
              <div class="canvas-font-preview-text-oa" style="font-family: '${f.family}', sans-serif;">
                O amor é paciente e bondoso.
              </div>
            </div>
            <button type="button" class="canvas-font-action-btn-oa ${isInstalled ? 'is-installed' : ''}" data-id="${f.id}">
              ${isInstalled ? '✓ Usar' : '+ Adicionar'}
            </button>
          `;

          const btn = card.querySelector('.canvas-font-action-btn-oa');
          if (btn) {
            btn.addEventListener('click', () => {
              if (f.custom || isInstalled) {
                if (typeof applyTextToolbarAction === 'function') {
                  applyTextToolbarAction(c => {
                    c.fontFamily = `"${f.family}", sans-serif`;
                  });
                }
                toast.success(`Fonte "${f.family}" selecionada!`);
              } else {
                installFontsourceFont(f, btn);
              }
            });
          }

          listEl.appendChild(card);
          if (!f.custom && fontPreviewObserver) fontPreviewObserver.observe(card);
        });

        if (hint) {
          hint.textContent = `${results.length} fonte${results.length === 1 ? '' : 's'} encontrada${results.length === 1 ? '' : 's'}${results.length > 50 ? ' (mostrando 50 primeiras)' : ''}`;
        }
      }

      async function installFontsourceFont(fontItem, btnEl) {
        if (btnEl) {
          btnEl.disabled = true;
          btnEl.textContent = 'Baixando…';
        }
        try {
          const fontUrl = `https://cdn.jsdelivr.net/fontsource/fonts/${fontItem.id}@latest/latin-400-normal.woff2`;
          const res = await fetch(fontUrl);
          if (!res.ok) throw new Error('Falha ao baixar arquivo .woff2: ' + res.status);
          const buf = await res.arrayBuffer();

          // Converte arrayBuffer para base64 para armazenar no IndexedDB
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);
          const dataUrl = `data:font/woff2;base64,${base64}`;

          const assetId = `font_${fontItem.id}_400_${Date.now()}`;
          assetCache.set(assetId, dataUrl);
          await saveAsset(assetId, dataUrl);

          // Registra FontFace no navegador
          const fontFace = new FontFace(fontItem.family, buf);
          await fontFace.load();
          document.fonts.add(fontFace);

          // Adiciona ao array FONTS
          const fallbackCat = fontItem.category === 'serif' ? 'serif' : (fontItem.category === 'monospace' ? 'monospace' : (fontItem.category === 'handwriting' ? 'cursive' : 'sans-serif'));
          const fontObj = {
            css: `"${fontItem.family}", ${fallbackCat}`,
            name: fontItem.family,
            weights: [400, 700],
            category: fontItem.category || 'sans-serif',
            custom: true,
            assetId
          };

          if (!FONTS.some(f => f.name.toLowerCase() === fontItem.family.toLowerCase())) {
            FONTS.push(fontObj);
          }

          saveCustomFontMetadata(fontObj);
          refreshFontSelect();

          if (btnEl) {
            btnEl.className = 'canvas-font-action-btn-oa is-installed';
            btnEl.textContent = '✓ Instalada';
          }
        } catch (err) {
          console.error('[fonts] falha ao instalar fonte:', fontItem.family, err);
          toast.error('Não foi possível instalar a fonte ' + fontItem.family + '. Confira a conexão.');
          if (btnEl) {
            btnEl.disabled = false;
            btnEl.textContent = '+ Adicionar';
          }
        }
      }

      async function importLocalFontFile(fileOrFileList) {
        const files = fileOrFileList instanceof FileList || Array.isArray(fileOrFileList) 
          ? Array.from(fileOrFileList) 
          : [fileOrFileList];

        if (!files || files.length === 0) return;

        let totalImported = 0;
        const importedFamilies = new Set();
        const errors = [];

        for (const file of files) {
          if (!file) continue;
          const ext = file.name.split('.').pop().toLowerCase();

          if (ext === 'zip' || file.type.includes('zip')) {
            try {
              if (hint) hint.textContent = `Descompactando ${file.name}…`;
              if (!window.JSZip) {
                throw new Error('Biblioteca JSZip não encontrada.');
              }
              const zip = await JSZip.loadAsync(file);
              const fontEntries = [];

              zip.forEach((relativePath, zipEntry) => {
                if (zipEntry.dir) return;
                if (relativePath.includes('__MACOSX') || relativePath.split('/').pop().startsWith('._')) return;
                const entryExt = relativePath.split('.').pop().toLowerCase();
                if (['ttf', 'otf', 'woff', 'woff2'].includes(entryExt)) {
                  fontEntries.push({ path: relativePath, entry: zipEntry, ext: entryExt });
                }
              });

              if (fontEntries.length === 0) {
                throw new Error(`Nenhum arquivo de fonte (.ttf, .otf, .woff2) encontrado dentro de ${file.name}.`);
              }

              for (const item of fontEntries) {
                try {
                  const buf = await item.entry.async('arraybuffer');
                  const filename = item.path.split('/').pop();
                  const fObj = await registerAndSaveCustomFont(filename, buf, item.ext);
                  if (fObj) importedFamilies.add(fObj.name);
                  totalImported++;
                } catch (e) {
                  console.warn('[fonts] falha em item do zip:', item.path, e);
                }
              }
            } catch (err) {
              console.error('[fonts] falha ao extrair zip:', err);
              errors.push(`${file.name}: ${err.message}`);
            }
          } else if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) {
            try {
              if (hint) hint.textContent = `Importando ${file.name}…`;
              const buf = await file.arrayBuffer();
              const fObj = await registerAndSaveCustomFont(file.name, buf, ext);
              if (fObj) importedFamilies.add(fObj.name);
              totalImported++;
            } catch (err) {
              console.error('[fonts] falha ao importar fonte:', err);
              errors.push(`${file.name}: ${err.message}`);
            }
          } else {
            errors.push(`${file.name}: formato não suportado (use .zip, .ttf, .otf, .woff2)`);
          }
        }

        refreshFontSelect();
        filterAndRenderFontList();

        if (totalImported > 0) {
          const famCount = importedFamilies.size;
          toast.success(`${totalImported} arquivo(s) de fonte importado(s) em ${famCount} família(s)!`);
          if (hint) hint.textContent = `${famCount} família(s) de fontes pronta(s) para uso!`;
        }
        if (errors.length > 0 && totalImported === 0) {
          toast.error(errors[0]);
          if (hint) hint.textContent = errors[0];
        }
      }

      async function registerAndSaveCustomFont(rawFamilyOrFilename, buf, ext) {
        const parsed = parseFontFilename(rawFamilyOrFilename);
        const family = parsed.family;
        const weight = parsed.weight || 400;
        const style = parsed.style || 'normal';

        let mime = 'font/woff2';
        if (ext === 'ttf') mime = 'font/ttf';
        else if (ext === 'otf') mime = 'font/otf';
        else if (ext === 'woff') mime = 'font/woff';

        const bytes = new Uint8Array(buf);
        let binary = '';
        const len = bytes.byteLength;
        const chunkSize = 0x8000;
        for (let i = 0; i < len; i += chunkSize) {
          const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
          binary += String.fromCharCode.apply(null, chunk);
        }
        const base64 = btoa(binary);
        const dataUrl = `data:${mime};base64,${base64}`;

        const assetId = `font_local_${family.toLowerCase().replace(/\s+/g, '_')}_${weight}_${Date.now()}`;
        assetCache.set(assetId, dataUrl);
        await saveAsset(assetId, dataUrl);

        try {
          const fontFace = new FontFace(family, buf, {
            weight: String(weight),
            style: style
          });
          await fontFace.load();
          document.fonts.add(fontFace);
        } catch (e) {
          console.warn('[fonts] document.fonts.add falhou para ' + family + ' (' + weight + ')', e);
        }

        let fontObj = FONTS.find(f => f.name.toLowerCase() === family.toLowerCase());
        if (!fontObj) {
          fontObj = {
            css: `"${family}", sans-serif`,
            name: family,
            weights: [weight],
            category: 'custom',
            custom: true,
            assetId: assetId,
            assetMap: { [weight]: assetId }
          };
          FONTS.push(fontObj);
        } else {
          if (!fontObj.weights) fontObj.weights = [];
          if (!fontObj.weights.includes(weight)) fontObj.weights.push(weight);
          fontObj.weights.sort((a, b) => a - b);
          if (!fontObj.assetMap) fontObj.assetMap = {};
          fontObj.assetMap[weight] = assetId;
          if (weight === 400 || !fontObj.assetId) fontObj.assetId = assetId;
        }

        saveCustomFontMetadata(fontObj);
        return fontObj;
      }

      function switchTab(newTab) {
        tab = newTab;
        tabs.forEach(o => o.classList.toggle('is-active', o.dataset.tab === tab));

        if (tab === 'photos') {
          if (colorWrap) colorWrap.style.display = 'none';
          if (searchInput) {
            searchInput.style.display = 'block';
            searchInput.placeholder = 'Buscar fotos… (ex: minimalista, café, arquitetura)';
          }
          if (grid) {
            grid.style.display = 'grid';
            grid.className = 'canvas-photos-grid-oa';
          }
          if (viewContainer) viewContainer.style.display = 'none';
          if (hint) hint.textContent = '';
          buscarFotos(searchInput ? searchInput.value : '');
        } else if (tab === 'icons' || tab === 'stickers') {
          if (colorWrap) colorWrap.style.display = tab === 'icons' ? 'block' : 'none';
          if (searchInput) {
            searchInput.style.display = 'block';
            searchInput.placeholder = tab === 'icons'
              ? 'Buscar… (ex: coração, seta, cruz)'
              : 'Buscar sticker… (ex: praying, fire, star)';
          }
          if (grid) {
            grid.style.display = 'grid';
            grid.className = 'canvas-lib-grid-oa';
          }
          if (viewContainer) viewContainer.style.display = 'none';
          buscarIcones(searchInput ? searchInput.value : '');
        } else if (tab === 'gradients') {
          if (colorWrap) colorWrap.style.display = 'none';
          if (searchInput) searchInput.style.display = 'none';
          if (grid) grid.style.display = 'none';
          if (viewContainer) viewContainer.style.display = 'flex';
          if (hint) hint.textContent = '';
          renderGradientsView();
        } else if (tab === 'fonts') {
          if (colorWrap) colorWrap.style.display = 'none';
          if (searchInput) {
            searchInput.style.display = 'block';
            searchInput.placeholder = 'Buscar família de fontes (ex: Inter, Playfair, Lora, Oswald)…';
          }
          if (grid) grid.style.display = 'none';
          if (viewContainer) viewContainer.style.display = 'flex';
          renderFontsView();
        }
      }

      tabs.forEach(t => {
        t.addEventListener('click', () => switchTab(t.dataset.tab));
      });

      // Scroll infinito para a aba de Fotos
      if (grid) {
        grid.addEventListener('scroll', () => {
          if (tab !== 'photos' || photosState.loading || !photosState.hasMore) return;
          const scrollBottom = grid.scrollHeight - grid.scrollTop - grid.clientHeight;
          if (scrollBottom < 220) {
            buscarFotos(photosState.query, photosState.page + 1, true);
          }
        });
      }

      let debounce = null;
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            if (tab === 'photos') {
              buscarFotos(searchInput.value);
            } else if (tab === 'fonts') {
              filterAndRenderFontList();
            } else {
              buscarIcones(searchInput.value);
            }
          }, 320);
        });
      }
      if (colorInput) {
        colorInput.addEventListener('input', () => {
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            if (tab === 'icons') buscarIcones(searchInput ? searchInput.value : '');
          }, 200);
        });
      }

      function openLibrary(initialTab) {
        if (initialTab) tab = initialTab;
        document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
        modal.classList.add('open');
        switchTab(tab);
        if (searchInput && tab !== 'gradients') setTimeout(() => searchInput.focus(), 60);
        if (window.lucide) lucide.createIcons();
      }

      function closeLibrary() {
        modal.classList.remove('open');
      }

      openBtn.addEventListener('click', () => {
        modal.classList.contains('open') ? closeLibrary() : openLibrary();
      });
      if (closeBtn) closeBtn.addEventListener('click', closeLibrary);
      if (cancelBtn) cancelBtn.addEventListener('click', closeLibrary);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeLibrary();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) closeLibrary();
        const digitando = /^(INPUT|TEXTAREA)$/.test((e.target.tagName || '')) || e.target.isContentEditable;
        if (e.shiftKey && !digitando && (e.key === 'I' || e.key === 'i')) {
          e.preventDefault();
          modal.classList.contains('open') ? closeLibrary() : openLibrary();
        }
      });

      window.openIconLibrary = openLibrary;
    }

    function initCanvaExportController() {
      const exportBtn = document.getElementById('canvas-export-btn');
      const modal = document.getElementById('canvas-export-modal');
      const closeBtn = document.getElementById('canvas-export-close');
      const backBtn = document.getElementById('canvas-export-back-btn');
      const submitBtn = document.getElementById('canvas-export-submit-btn');
      const filenameInput = document.getElementById('canvas-export-filename');
      const formatSelect = document.getElementById('canvas-export-format');
      const scaleSelect = document.getElementById('canvas-export-scale');
      const scopeSelect = document.getElementById('canvas-export-scope');
      const progressBox = document.getElementById('canvas-export-progress');
      const progressText = document.getElementById('canvas-export-progress-text');
      const progressPct = document.getElementById('canvas-export-progress-pct');
      const progressFill = document.getElementById('canvas-export-progress-fill');

      // Novos controles visuais Canva
      const formatTrigger = document.getElementById('canvas-export-format-trigger');
      const formatDropdown = document.getElementById('canvas-export-format-dropdown');
      const formatNameDisplay = document.getElementById('canvas-format-name-display');
      const formatTagDisplay = document.getElementById('canvas-format-tag-display');
      const formatIconDisplay = document.getElementById('canvas-format-icon-display');
      const formatChevron = document.getElementById('canvas-format-chevron');
      const scaleSlider = document.getElementById('canvas-export-scale-slider');
      const scaleBadge = document.getElementById('canvas-export-scale-badge');
      const dimPreview = document.getElementById('canvas-export-dim-preview');
      const segmentedScope = document.getElementById('canvas-export-segmented-scope');
      const segCurrentBtn = document.getElementById('canvas-seg-current-btn');
      const customPagesList = document.getElementById('canvas-custom-pages-list');

      if (!exportBtn || !modal) return;

      function updateDimensionDisplay(scaleVal) {
        const scale = Number(scaleVal || scaleSlider?.value || 2);
        const currFrame = selectedFrame() || frames[0];
        const baseW = currFrame ? currFrame.w : 1080;
        const baseH = currFrame ? currFrame.h : 1350;
        const wScaled = (baseW * scale).toLocaleString('pt-BR');
        const hScaled = (baseH * scale).toLocaleString('pt-BR');
        if (dimPreview) dimPreview.textContent = `· ${wScaled} px × ${hScaled} px`;
        if (scaleBadge) scaleBadge.textContent = scale;
        if (scaleSlider) {
          const min = Number(scaleSlider.min) || 1;
          const max = Number(scaleSlider.max) || 4;
          const pct = ((scale - min) / (max - min)) * 100;
          scaleSlider.style.background = `linear-gradient(to right, #2563EB 0%, #2563EB ${pct}%, rgba(255, 255, 255, 0.12) ${pct}%, rgba(255, 255, 255, 0.12) 100%)`;
        }
      }

      function updateFormatDisplay(val) {
        const isPng = val === 'png';
        if (formatNameDisplay) formatNameDisplay.textContent = isPng ? 'PNG' : 'JPG';
        if (formatTagDisplay) {
          formatTagDisplay.textContent = isPng ? 'Sugestões' : 'Compacto';
          formatTagDisplay.className = isPng ? 'canva-format-tag' : 'canva-format-tag canva-format-tag--subtle';
        }
        if (formatIconDisplay) {
          formatIconDisplay.setAttribute('data-lucide', isPng ? 'image' : 'file-image');
        }
        if (formatDropdown) {
          formatDropdown.querySelectorAll('.canva-format-option').forEach(opt => {
            opt.classList.toggle('is-selected', opt.dataset.value === val);
          });
        }
        if (window.lucide) lucide.createIcons({ root: formatTrigger });
      }

      function populateCustomPagesList() {
        if (!customPagesList) return;
        const currFrame = selectedFrame() || frames[0];
        customPagesList.innerHTML = frames.map((f, i) => `
          <label class="canva-custom-page-item">
            <input type="checkbox" class="canva-custom-page-chk" value="${f.id}" ${f.id === currFrame?.id || frames.length === 1 ? 'checked' : ''}>
            <span>${escapeHtml(formatFrameDisplayName ? formatFrameDisplayName(f) : (f.name || `Post ${i + 1}`))}</span>
          </label>
        `).join('');
      }

      function openExportModal() {
        document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
        modal.classList.add('open');
        const currFrame = selectedFrame() || frames[0];
        const currIdx = currFrame ? frames.indexOf(currFrame) : 0;
        
        if (segCurrentBtn) {
          segCurrentBtn.textContent = `Esta página (${currIdx !== -1 ? currIdx + 1 : 1})`;
        }

        populateCustomPagesList();

        if (filenameInput && currFrame) {
          const currentScope = scopeSelect ? scopeSelect.value : 'current';
          if (currentScope === 'all' && frames.length > 1) {
            filenameInput.value = 'Carrossel';
            filenameInput.placeholder = 'Carrossel';
          } else {
            const defaultName = currFrame.name || `Post ${currIdx !== -1 ? currIdx + 1 : currFrame.id}`;
            filenameInput.value = defaultName;
            filenameInput.placeholder = defaultName;
          }
        }

        const currentScale = scaleSlider ? Number(scaleSlider.value) : 2;
        updateDimensionDisplay(currentScale);
        updateFormatDisplay(formatSelect ? formatSelect.value : 'png');

        if (window.lucide) lucide.createIcons();
      }

      exportBtn.addEventListener('click', () => {
        if (modal.classList.contains('open')) {
          closeExportModal();
        } else {
          openExportModal();
        }
      });

      function closeExportModal() {
        modal.classList.remove('open');
        if (formatDropdown) formatDropdown.style.display = 'none';
        if (progressBox) progressBox.style.display = 'none';
      }

      if (closeBtn) closeBtn.addEventListener('click', closeExportModal);
      if (backBtn) backBtn.addEventListener('click', closeExportModal);

      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeExportModal();
      });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) {
          closeExportModal();
        }
      });

      // Format Trigger & Dropdown Handlers
      if (formatTrigger && formatDropdown) {
        formatTrigger.addEventListener('click', (e) => {
          e.stopPropagation();
          const isOpen = formatDropdown.style.display === 'flex';
          formatDropdown.style.display = isOpen ? 'none' : 'flex';
          if (formatChevron) {
            formatChevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
          }
        });

        formatDropdown.querySelectorAll('.canva-format-option').forEach(opt => {
          opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const val = opt.dataset.value;
            if (formatSelect) formatSelect.value = val;
            updateFormatDisplay(val);
            formatDropdown.style.display = 'none';
            if (formatChevron) formatChevron.style.transform = 'rotate(0deg)';
          });
        });

        document.addEventListener('click', (e) => {
          if (formatDropdown && !formatTrigger.contains(e.target) && !formatDropdown.contains(e.target)) {
            formatDropdown.style.display = 'none';
            if (formatChevron) formatChevron.style.transform = 'rotate(0deg)';
          }
        });
      }

      // Slider Scale Handlers
      if (scaleSlider) {
        scaleSlider.addEventListener('input', () => {
          const val = Number(scaleSlider.value);
          if (scaleSelect) scaleSelect.value = val;
          updateDimensionDisplay(val);
        });
      }

      // Segmented Scope Handlers
      if (segmentedScope) {
        segmentedScope.querySelectorAll('.canva-seg-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            segmentedScope.querySelectorAll('.canva-seg-btn').forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            const scope = btn.dataset.scope;
            if (scopeSelect) scopeSelect.value = scope;

            if (customPagesList) {
              customPagesList.style.display = scope === 'custom' ? 'flex' : 'none';
            }

            if (filenameInput) {
              if (scope === 'all') {
                if (!filenameInput.value || filenameInput.value.startsWith('Post')) {
                  filenameInput.value = 'Carrossel';
                  filenameInput.placeholder = 'Carrossel';
                }
              } else {
                const currFrame = selectedFrame() || frames[0];
                if (currFrame) {
                  const defaultName = currFrame.name || `Post ${frames.indexOf(currFrame) !== -1 ? frames.indexOf(currFrame) + 1 : currFrame.id}`;
                  filenameInput.value = defaultName;
                  filenameInput.placeholder = defaultName;
                }
              }
            }
          });
        });
      }

      // Submit Download Handler
      if (submitBtn) {
        submitBtn.addEventListener('click', async () => {
          if (!window.exportFrameToBlob) return;

          const userFilename = filenameInput ? filenameInput.value.trim() : '';
          const format = formatSelect ? formatSelect.value : 'png';
          const scale = Number(scaleSlider ? scaleSlider.value : (scaleSelect ? scaleSelect.value : 2));
          const scope = scopeSelect ? scopeSelect.value : 'current';
          const ext = format === 'jpeg' ? 'jpg' : 'png';

          submitBtn.disabled = true;
          if (progressBox) progressBox.style.display = 'flex';

          let framesToExport = [];
          if (scope === 'all') {
            framesToExport = [...frames];
          } else if (scope === 'custom') {
            const checkedIds = customPagesList
              ? Array.from(customPagesList.querySelectorAll('.canva-custom-page-chk:checked')).map(chk => Number(chk.value))
              : [];
            framesToExport = frames.filter(f => checkedIds.includes(f.id));
            if (framesToExport.length === 0) {
              toast.error('Selecione pelo menos um post para baixar');
              submitBtn.disabled = false;
              if (progressBox) progressBox.style.display = 'none';
              return;
            }
          } else {
            const f = selectedFrame() || frames[0];
            if (f) framesToExport = [f];
          }

          if (framesToExport.length === 0) {
            toast.error('Nenhum post disponível para baixar');
            submitBtn.disabled = false;
            if (progressBox) progressBox.style.display = 'none';
            return;
          }

          /* Cada frame vira um arquivo — menos a faixa panorâmica, que vira
             um arquivo por post. Só depois de montar a lista é que se decide
             entre download direto e .zip. */
          const files = [];
          for (let i = 0; i < framesToExport.length; i++) {
            const f = framesToExport[i];
            const pct = Math.round(((i + 1) / framesToExport.length) * 100);
            if (progressText) {
              progressText.textContent = framesToExport.length > 1
                ? `Gerando ${i + 1} de ${framesToExport.length}...`
                : 'Gerando imagem em alta resolução...';
            }
            if (progressPct) progressPct.textContent = `${pct}%`;
            if (progressFill) progressFill.style.width = `${pct}%`;

            const blobs = await window.exportFrameToBlobs(f, { scale, format });
            const base = sanitizeFilename(userFilename) || sanitizeFilename(f.name) || `post_${f.id}`;
            const prefix = framesToExport.length > 1 ? `${i + 1}_` : '';
            blobs.forEach((blob, sliceIdx) => {
              const suffix = blobs.length > 1 ? `_${sliceIdx + 1}` : '';
              files.push({ blob, name: `${prefix}${base}${suffix}.${ext}` });
            });
            await new Promise(r => setTimeout(r, 10));
          }

          const saveBlob = (blob, filename) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          };

          if (files.length > 1) {
            if (!window.JSZip) {
              toast.info('Carregando biblioteca de exportação...');
              submitBtn.disabled = false;
              return;
            }
            if (progressText) progressText.textContent = 'Criando arquivo ZIP...';
            const zip = new JSZip();
            files.forEach(file => zip.file(file.name, file.blob));
            const zipBaseName = sanitizeFilename(userFilename) || 'carrossel';
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            saveBlob(zipBlob, `${zipBaseName}.zip`);
            toast.success(`${files.length} imagens exportadas: ${zipBaseName}.zip`);
          } else if (files.length === 1) {
            saveBlob(files[0].blob, files[0].name);
            toast.success(`Post exportado: ${files[0].name}`);
          }

          if (progressText) progressText.textContent = '✓ Download concluído!';
          submitBtn.disabled = false;
          setTimeout(closeExportModal, 800);
        });
      }
    }

    // --------------------------------------------------
    // CONTROLLER DA BARRA FLUTUANTE DE FUNDO DO FRAME
    // --------------------------------------------------
    function initFrameToolbarController() {
      const frameToolbar = document.getElementById('canvas-frame-toolbar');
      const btnModeSolid = document.getElementById('canvas-frame-mode-solid');
      const btnModeGrad = document.getElementById('canvas-frame-mode-gradient');
      const groupSolid = document.getElementById('canvas-frame-solid-group');
      const groupGrad = document.getElementById('canvas-frame-grad-group');
      const inputBgColor = document.getElementById('canvas-frame-bg-color');
      const inputGradC1 = document.getElementById('canvas-frame-grad-c1');
      const inputGradC2 = document.getElementById('canvas-frame-grad-c2');
      const selectGradDir = document.getElementById('canvas-frame-grad-dir');
      const selectGrad = document.getElementById('canvas-frame-gradient-select');
      const btnBgImg = document.getElementById('canvas-frame-bg-img-btn');
      const fileBgImg = document.getElementById('canvas-frame-bg-file');
      const btnMore = document.getElementById('canvas-frame-more');
      const advRow = document.getElementById('canvas-frame-advanced');
      const inputOverlay = document.getElementById('canvas-frame-overlay');
      const inputBlur = document.getElementById('canvas-frame-blur');
      const btnDelImg = document.getElementById('canvas-frame-del-img');
      const btnReset = document.getElementById('canvas-frame-bg-reset');

      if (!frameToolbar) return;

      if (window.lucide) lucide.createIcons();

      function buildGradientString(c1, c2, dir) {
        if (dir === 'radial') {
          return `radial-gradient(circle, ${c1} 0%, ${c2} 100%)`;
        }
        return `linear-gradient(${dir || '180deg'}, ${c1} 0%, ${c2} 100%)`;
      }

      function applyCustomGradient(frame) {
        if (!frame) return;
        const c1 = (inputGradC1 && inputGradC1.value) || '#18181B';
        const c2 = (inputGradC2 && inputGradC2.value) || '#09090B';
        const dir = (selectGradDir && selectGradDir.value) || '180deg';
        frame.bg = buildGradientString(c1, c2, dir);
        frame.bgImage = null;
        frame.bgAssetId = null;
        applyFrameBackground(frame);
        save();
      }

      if (btnModeSolid) {
        btnModeSolid.addEventListener('click', () => {
          const frame = selectedFrame();
          if (!frame) return;
          btnModeSolid.classList.add('is-active');
          if (btnModeGrad) btnModeGrad.classList.remove('is-active');
          if (groupSolid) groupSolid.style.display = 'inline-flex';
          if (groupGrad) groupGrad.style.display = 'none';

          frame.bg = (inputBgColor && inputBgColor.value) || '#FFFFFF';
          frame.bgImage = null;
        frame.bgAssetId = null;
          applyFrameBackground(frame);
          save();
        });
      }

      if (btnModeGrad) {
        btnModeGrad.addEventListener('click', () => {
          const frame = selectedFrame();
          if (!frame) return;
          btnModeGrad.classList.add('is-active');
          if (btnModeSolid) btnModeSolid.classList.remove('is-active');
          if (groupSolid) groupSolid.style.display = 'none';
          if (groupGrad) groupGrad.style.display = 'inline-flex';

          applyCustomGradient(frame);
        });
      }

      if (inputBgColor) {
        inputBgColor.addEventListener('input', (e) => {
          const frame = selectedFrame();
          if (!frame) return;
          frame.bg = e.target.value;
          frame.bgImage = null;
        frame.bgAssetId = null;
          if (selectGrad) selectGrad.value = '';
          applyFrameBackground(frame);
          save();
        });
      }

      if (inputGradC1) {
        inputGradC1.addEventListener('input', () => {
          const frame = selectedFrame();
          applyCustomGradient(frame);
        });
      }

      if (inputGradC2) {
        inputGradC2.addEventListener('input', () => {
          const frame = selectedFrame();
          applyCustomGradient(frame);
        });
      }

      if (selectGradDir) {
        selectGradDir.addEventListener('change', () => {
          const frame = selectedFrame();
          applyCustomGradient(frame);
        });
      }

      if (selectGrad) {
        selectGrad.addEventListener('change', (e) => {
          const frame = selectedFrame();
          if (!frame) return;
          const val = e.target.value;
          if (!val) return;

          const parts = val.split('|');
          if (parts.length >= 2) {
            const c1 = parts[0];
            const c2 = parts[1];
            const dir = parts[2] || '180deg';
            if (inputGradC1) inputGradC1.value = c1;
            if (inputGradC2) inputGradC2.value = c2;
            if (selectGradDir) selectGradDir.value = dir;

            if (btnModeGrad) btnModeGrad.classList.add('is-active');
            if (btnModeSolid) btnModeSolid.classList.remove('is-active');
            if (groupSolid) groupSolid.style.display = 'none';
            if (groupGrad) groupGrad.style.display = 'inline-flex';

            applyCustomGradient(frame);
          }
          selectGrad.value = '';
        });
      }

      if (btnBgImg && fileBgImg) {
        btnBgImg.addEventListener('click', () => fileBgImg.click());
        fileBgImg.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = async (ev) => {
            const frame = selectedFrame();
            if (!frame) return;
            // Pixel vai pro IndexedDB; o frame guarda só o id (cota do localStorage)
            const id = 'asset_bg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
            assetCache.set(id, ev.target.result);
            await saveAsset(id, ev.target.result);
            frame.bgImage = null;
            frame.bgAssetId = id;
            if (frame.bgOverlay == null) frame.bgOverlay = 35;
            applyFrameBackground(frame);
            save();
            updateTextToolbar();
          };
          reader.readAsDataURL(file);
        });
      }

      if (btnMore && advRow) {
        btnMore.addEventListener('click', () => {
          advRow.classList.toggle('is-open');
          btnMore.classList.toggle('is-active', advRow.classList.contains('is-open'));
          updateTextToolbar();
        });
      }

      if (inputOverlay) {
        inputOverlay.addEventListener('input', (e) => {
          const frame = selectedFrame();
          if (!frame) return;
          frame.bgOverlay = Number(e.target.value);
          applyFrameBackground(frame);
          save();
        });
      }

      if (inputBlur) {
        inputBlur.addEventListener('input', (e) => {
          const frame = selectedFrame();
          if (!frame) return;
          frame.bgBlur = Number(e.target.value);
          applyFrameBackground(frame);
          save();
        });
      }

      const btnReposition = document.getElementById('canvas-frame-reposition-btn');
      const inputFramePosY = document.getElementById('canvas-frame-pos-y');
      const inputFramePosX = document.getElementById('canvas-frame-pos-x');
      const inputFrameZoom = document.getElementById('canvas-frame-zoom');

      if (btnReposition) {
        btnReposition.addEventListener('click', () => {
          const frame = selectedFrame();
          if (frame && hasFrameBg(frame)) enterFrameBgRepositionMode(frame.id);
        });
      }

      if (inputFramePosY) {
        inputFramePosY.addEventListener('input', (e) => {
          const frame = selectedFrame();
          if (!frame) return;
          frame.bgPosY = Number(e.target.value);
          applyFrameBackground(frame);
          save();
        });
      }

      if (inputFramePosX) {
        inputFramePosX.addEventListener('input', (e) => {
          const frame = selectedFrame();
          if (!frame) return;
          frame.bgPosX = Number(e.target.value);
          applyFrameBackground(frame);
          save();
        });
      }

      if (inputFrameZoom) {
        inputFrameZoom.addEventListener('input', (e) => {
          const frame = selectedFrame();
          if (!frame) return;
          frame.bgZoom = Number(e.target.value);
          applyFrameBackground(frame);
          save();
        });
      }

      if (btnDelImg) {
        btnDelImg.addEventListener('click', () => {
          const frame = selectedFrame();
          if (!frame) return;
          frame.bgImage = null;
          frame.bgAssetId = null;
          frame.bgOverlay = 0;
          frame.bgBlur = 0;
          applyFrameBackground(frame);
          save();
          updateTextToolbar();
        });
      }

      if (btnReset) {
        btnReset.addEventListener('click', () => {
          const frame = selectedFrame();
          if (!frame) return;
          frame.bg = '#FFFFFF';
          frame.bgImage = null;
        frame.bgAssetId = null;
          frame.bgOverlay = 0;
          frame.bgBlur = 0;
          if (selectGrad) selectGrad.value = '';
          if (inputBgColor) inputBgColor.value = '#FFFFFF';
          if (btnModeSolid) btnModeSolid.classList.add('is-active');
          if (btnModeGrad) btnModeGrad.classList.remove('is-active');
          if (groupSolid) groupSolid.style.display = 'inline-flex';
          if (groupGrad) groupGrad.style.display = 'none';

          applyFrameBackground(frame);
          save();
          updateTextToolbar();
        });
      }

      const btnBgBind = document.getElementById('canvas-frame-bg-bind');
      if (btnBgBind) {
        btnBgBind.addEventListener('click', () => {
          const frame = selectedFrame();
          if (!frame) return;
          if (window.openBindModal) {
            window.openBindModal({ type: 'frame', frame });
          }
        });
      }
    }

    function initBindModalController() {
      const modal = document.getElementById('canvas-bind-modal');
      const closeBtn = document.getElementById('canvas-bind-close');
      const cancelBtn = document.getElementById('canvas-bind-cancel-btn');
      const saveBtn = document.getElementById('canvas-bind-save-btn');
      const deleteBtn = document.getElementById('canvas-bind-delete-btn');
      const input = document.getElementById('canvas-bind-input');
      const targetHint = document.getElementById('canvas-bind-target-hint');
      const titleEl = document.getElementById('canvas-bind-modal-title');

      if (!modal) return;

      let currentTarget = null;

      function closeBindModal() {
        modal.classList.remove('open');
        currentTarget = null;
      }

      function openBindModal(target) {
        if (!target) return;
        currentTarget = target;
        document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));

        let currentBind = '';
        let suggested = '';
        let hintText = '';

        if (target.type === 'child') {
          const child = target.child;
          currentBind = child.bind || '';
          if (child.type === 'image') {
            suggested = currentBind || 'foto';
            hintText = 'Imagem selecionada';
          } else {
            suggested = currentBind || slugifyBind(child.text) || 'titulo';
            const plainText = (child.text || '').trim();
            hintText = `Texto: "${plainText.slice(0, 26)}${plainText.length > 26 ? '…' : ''}"`;
          }
        } else if (target.type === 'frame') {
          const frame = target.frame;
          currentBind = frame.bgBind || '';
          suggested = currentBind || (hasFrameBg(frame) ? 'imagem_fundo' : 'fundo');
          hintText = `Fundo do Post #${frame.id}`;
        }

        if (titleEl) titleEl.textContent = currentBind ? 'Editar Variável' : 'Vincular Variável';
        if (targetHint) targetHint.textContent = hintText;
        if (input) {
          input.value = currentBind || suggested;
          setTimeout(() => {
            input.focus();
            input.select();
          }, 60);
        }

        if (deleteBtn) {
          deleteBtn.style.display = currentBind ? 'inline-flex' : 'none';
        }

        modal.classList.add('open');
        if (window.lucide) lucide.createIcons();
      }

      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (saveBtn) saveBtn.click();
          }
        });
      }

      if (closeBtn) closeBtn.addEventListener('click', closeBindModal);
      if (cancelBtn) cancelBtn.addEventListener('click', closeBindModal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeBindModal();
      });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) {
          closeBindModal();
        }
      });

      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          if (!currentTarget) return;
          const raw = input ? input.value.trim() : '';
          const name = slugifyBind(raw);
          if (!name || !BIND_RE.test(name)) {
            toast.error('Escolha um nome válido com letras ou números (ex: titulo)');
            return;
          }

          if (currentTarget.type === 'child') {
            const child = currentTarget.child;
            child.bind = name;
            const el = nodeElement(child.id);
            if (el) paintBind(child, el);
            updateTextToolbar();
            save();
            toast.success(`Variável {{${name}}} conectada!`);
          } else if (currentTarget.type === 'frame') {
            const frame = currentTarget.frame;
            frame.bgBind = name;
            applyFrameBackground(frame);
            updateFrameMeta();
            updateTextToolbar();
            save();
            toast.success(`Variável de fundo {{${name}}} conectada!`);
          }

          closeBindModal();
          if (window.renderStep1BindsStatus) window.renderStep1BindsStatus();
        });
      }

      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
          if (!currentTarget) return;
          if (currentTarget.type === 'child') {
            const child = currentTarget.child;
            const old = child.bind;
            delete child.bind;
            const el = nodeElement(child.id);
            if (el) paintBind(child, el);
            updateTextToolbar();
            save();
            toast.info(`Variável {{${old}}} desvinculada.`);
          } else if (currentTarget.type === 'frame') {
            const frame = currentTarget.frame;
            const old = frame.bgBind;
            delete frame.bgBind;
            applyFrameBackground(frame);
            updateFrameMeta();
            updateTextToolbar();
            save();
            toast.info(`Variável {{${old}}} desvinculada.`);
          }
          closeBindModal();
          if (window.renderStep1BindsStatus) window.renderStep1BindsStatus();
        });
      }

      window.openBindModal = openBindModal;
      window.closeBindModal = closeBindModal;
    }

    // --------------------------------------------------
    // CONTROLLER DO MODAL DE CARROSSEL PANORÂMICO
    // --------------------------------------------------
    function initPanoramicModalController() {
      const modal = document.getElementById('canvas-panoramic-modal');
      const closeBtn = document.getElementById('canvas-panoramic-close');
      const countBadge = document.getElementById('canvas-pano-count-badge');
      const pillsWrap = document.getElementById('canvas-pano-pills');
      const minusBtn = document.getElementById('canvas-pano-minus');
      const plusBtn = document.getElementById('canvas-pano-plus');
      const slider = document.getElementById('canvas-pano-slider');
      const ratioGroup = document.getElementById('canvas-pano-ratio-group');
      const totalDimDisplay = document.getElementById('canvas-pano-total-dim');
      const slicesPreview = document.getElementById('canvas-pano-slices-preview');
      const submitBtn = document.getElementById('canvas-pano-submit-btn');
      const submitLabel = document.getElementById('canvas-pano-submit-label');

      if (!modal) return;

      let currentCount = 5;
      let currentFormat = 'ig-feed';

      function updateUI() {
        if (countBadge) countBadge.textContent = `${currentCount} posts`;
        if (slider) {
          slider.value = currentCount;
          const min = Number(slider.min) || 2;
          const max = Number(slider.max) || 10;
          const pct = ((currentCount - min) / (max - min)) * 100;
          slider.style.background = `linear-gradient(to right, #2563EB 0%, #2563EB ${pct}%, rgba(255, 255, 255, 0.12) ${pct}%, rgba(255, 255, 255, 0.12) 100%)`;
        }
        if (pillsWrap) {
          pillsWrap.querySelectorAll('.canvas-pano-pill').forEach(p => {
            p.classList.toggle('is-active', Number(p.dataset.count) === currentCount);
          });
        }
        const fmt = FORMATS[currentFormat] || FORMATS['ig-feed'];
        const totalW = (currentCount * fmt.w).toLocaleString('pt-BR');
        const hStr = fmt.h.toLocaleString('pt-BR');
        if (totalDimDisplay) totalDimDisplay.textContent = `${totalW} px × ${hStr} px`;
        if (submitLabel) submitLabel.textContent = `Criar Carrossel Panorâmico (${currentCount} posts)`;

        if (slicesPreview) {
          slicesPreview.innerHTML = Array.from({ length: currentCount }, (_, i) => `
            <div class="canvas-slice-block" title="Post ${i + 1}">
              <span>${i + 1}</span>
            </div>
          `).join('');
        }
      }

      function openModal() {
        document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
        modal.classList.add('open');
        updateUI();
        if (window.lucide) lucide.createIcons();
      }

      function closeModal() {
        modal.classList.remove('open');
      }

      window.openPanoramicModal = openModal;
      window.closePanoramicModal = closeModal;

      if (closeBtn) closeBtn.addEventListener('click', closeModal);

      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) {
          closeModal();
        }
      });

      if (pillsWrap) {
        pillsWrap.querySelectorAll('.canvas-pano-pill').forEach(pill => {
          pill.addEventListener('click', () => {
            currentCount = Number(pill.dataset.count) || 5;
            updateUI();
          });
        });
      }

      if (slider) {
        slider.addEventListener('input', () => {
          currentCount = Number(slider.value) || 5;
          updateUI();
        });
      }

      if (minusBtn) {
        minusBtn.addEventListener('click', () => {
          currentCount = Math.max(2, currentCount - 1);
          updateUI();
        });
      }

      if (plusBtn) {
        plusBtn.addEventListener('click', () => {
          currentCount = Math.min(10, currentCount + 1);
          updateUI();
        });
      }

      if (ratioGroup) {
        ratioGroup.querySelectorAll('.canva-seg-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            ratioGroup.querySelectorAll('.canva-seg-btn').forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            currentFormat = btn.dataset.format || 'ig-feed';
            updateUI();
          });
        });
      }

      if (submitBtn) {
        submitBtn.addEventListener('click', () => {
          closeModal();
          createPanoramicCarousel(currentCount, currentFormat);
        });
      }
    }

    function initTemplatesModalController() {
      const modal = document.getElementById('canvas-templates-modal');
      const openBtn = document.getElementById('canvas-templates-btn');
      const closeBtn = document.getElementById('canvas-templates-close');
      const cancelBtn = document.getElementById('canvas-templates-cancel');
      const searchInput = document.getElementById('canvas-templates-search');
      const searchClearBtn = document.getElementById('canvas-templates-search-clear');
      const totalBadge = document.getElementById('canvas-templates-total-badge');
      const grid = document.getElementById('canvas-templates-grid');
      const chips = [...document.querySelectorAll('.canvas-tpl-chip-oa')];

      const catalogView = document.getElementById('canvas-templates-catalog-view');
      const previewView = document.getElementById('canvas-templates-preview-view');
      const previewBackBtn = document.getElementById('canvas-tpl-preview-back');
      const previewTitle = document.getElementById('canvas-tpl-preview-title');
      const previewBadge = document.getElementById('canvas-tpl-preview-badge');
      const previewCount = document.getElementById('canvas-tpl-preview-count');
      const previewApplyBtn = document.getElementById('canvas-tpl-preview-apply');
      const filmstrip = document.getElementById('canvas-tpl-filmstrip');

      if (!modal || !grid) return;

      let currentCategory = 'todos';
      let searchQuery = '';
      let activePreviewTemplate = null;

      function showCatalogView() {
        if (catalogView) catalogView.style.display = 'flex';
        if (previewView) previewView.style.display = 'none';
        activePreviewTemplate = null;
      }

      function showPreviewView(tpl) {
        if (!tpl || !previewView) return;
        activePreviewTemplate = tpl;
        if (catalogView) catalogView.style.display = 'none';
        previewView.style.display = 'flex';

        if (previewTitle) previewTitle.textContent = tpl.title;
        if (previewBadge) previewBadge.textContent = tpl.badge || tpl.categoryLabel || 'Carrossel';
        if (previewCount) previewCount.textContent = `${tpl.slideCount} slides · ${tpl.aspect}`;

        if (filmstrip && tpl.generateFrames) {
          filmstrip.innerHTML = '';
          const framesList = tpl.generateFrames();
          const deck = tpl.deck || {};
          const accent = deck.accentColor || '#38BDF8';

          framesList.forEach((f, idx) => {
            const slideEl = document.createElement('div');
            slideEl.className = 'canvas-tpl-film-slide';
            slideEl.style.background = f.bg || deck.coverBg || '#09090B';

            // Localiza textos principais do frame
            const texts = (f.children || []).filter(c => c.type === 'text');
            const topTag = texts[0]?.text || `SLIDE 0${idx + 1}`;
            const mainHeading = texts.length > 1 ? texts[1].text : (texts[0]?.text || '');
            const bodyDesc = texts.length > 2 ? texts[2].text : '';

            slideEl.innerHTML = `
              <div class="canvas-tpl-film-badge" style="color: ${accent};">
                ${escapeHtml(topTag.split('\n')[0].slice(0, 30))}
              </div>
              <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 8px;">
                <div class="canvas-tpl-film-headline" style="font-family: ${(texts[1]?.fontFamily) || 'Inter, sans-serif'};">
                  ${escapeHtml(mainHeading)}
                </div>
                ${bodyDesc ? `<div class="canvas-tpl-film-body">${escapeHtml(bodyDesc)}</div>` : ''}
              </div>
              <div class="canvas-tpl-film-foot">
                <span>Slide ${idx + 1} de ${framesList.length}</span>
                <span>${f.name || 'Post'}</span>
              </div>
            `;
            filmstrip.appendChild(slideEl);
          });
        }

        if (window.lucide) lucide.createIcons({ root: previewView });
      }

      function renderTemplatesGrid() {
        if (!window.CarouselTemplates) return;
        showCatalogView();
        grid.innerHTML = '';

        let templates = CarouselTemplates.getByCategory(currentCategory);
        if (searchQuery) {
          const q = searchQuery.toLowerCase().trim();
          templates = templates.filter(t => 
            t.title.toLowerCase().includes(q) || 
            t.description.toLowerCase().includes(q) || 
            t.category.toLowerCase().includes(q) ||
            (t.badge && t.badge.toLowerCase().includes(q))
          );
        }

        if (totalBadge) {
          totalBadge.innerHTML = `
            <span class="canvas-badge-dot"></span>
            <span>${templates.length} ${templates.length === 1 ? 'Coleção' : 'Coleções'}</span>
          `;
        }

        if (templates.length === 0) {
          grid.innerHTML = `
            <div class="canvas-lib-empty-oa" style="padding: 54px 16px; grid-column: 1 / -1; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px;">
              <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(255, 255, 255, 0.05); display: flex; align-items: center; justify-content: center; color: rgba(255, 255, 255, 0.4);">
                <i data-lucide="search-x" style="width: 22px; height: 22px;"></i>
              </div>
              <div style="font-size: 14px; font-weight: 600; color: #FFFFFF;">Nenhum template encontrado</div>
              <div style="font-size: 12px; color: rgba(255, 255, 255, 0.5); max-width: 320px;">Não encontramos nenhum modelo com o termo "${escapeHtml(searchQuery)}".</div>
              <button type="button" class="openpanel-btn-secondary" id="canvas-tpl-reset-search" style="margin-top: 4px; padding: 6px 14px; font-size: 12px;">Limpar busca</button>
            </div>
          `;
          const resetBtn = document.getElementById('canvas-tpl-reset-search');
          if (resetBtn) {
            resetBtn.addEventListener('click', () => {
              if (searchInput) searchInput.value = '';
              searchQuery = '';
              if (searchClearBtn) searchClearBtn.style.display = 'none';
              renderTemplatesGrid();
            });
          }
          if (window.lucide) lucide.createIcons({ root: grid });
          return;
        }

        templates.forEach(tpl => {
          const card = document.createElement('div');
          card.className = 'canvas-tpl-card-oa';
          card.tabIndex = 0;
          card.role = 'button';

          const deck = tpl.deck || {};
          const bg = deck.coverBg || '#09090B';
          const accent = deck.accentColor || '#38BDF8';
          const tag = deck.tag || 'CARROSSEL';
          const headline = deck.headline || tpl.title;
          const sub = deck.sub || tpl.description;
          const author = deck.author || '@seuperfil';

          // Micro tags de características
          const microTags = [
            `⚡ Lote Pronto`,
            `📐 ${tpl.aspect ? tpl.aspect.split(' ')[0] : '1080'}`,
            tpl.badge ? `✨ ${tpl.badge}` : null
          ].filter(Boolean);

          card.innerHTML = `
            <!-- 3D Cascading Deck -->
            <div class="canvas-tpl-deck-wrap">
              <!-- Slide 3 (Back) -->
              <div class="canvas-tpl-deck-layer canvas-tpl-slide-back" style="background: ${bg};">
                <div class="canvas-tpl-mini-tag" style="color: ${accent}; opacity: 0.7;">CTA · FINAL</div>
                <div class="canvas-tpl-mini-sub" style="color: rgba(255,255,255,0.7);">📌 Salve para consultar depois</div>
                <div class="canvas-tpl-mini-meta"><span>${tpl.slideCount}/${tpl.slideCount}</span><span>${author}</span></div>
              </div>

              <!-- Slide 2 (Mid) -->
              <div class="canvas-tpl-deck-layer canvas-tpl-slide-mid" style="background: ${bg};">
                <div class="canvas-tpl-mini-tag" style="color: ${accent};">PASSO 01</div>
                <div class="canvas-tpl-mini-headline" style="font-size: 10px;">Dica em Destaque</div>
                <div class="canvas-tpl-mini-sub">${escapeHtml(sub)}</div>
                <div class="canvas-tpl-mini-meta"><span>02/${tpl.slideCount}</span><span>→</span></div>
              </div>

              <!-- Slide 1 (Front / Capa) -->
              <div class="canvas-tpl-deck-layer canvas-tpl-slide-front" style="background: ${bg};">
                <div class="canvas-tpl-mini-tag" style="color: ${accent};">${escapeHtml(tag)}</div>
                <div class="canvas-tpl-mini-headline">${escapeHtml(headline)}</div>
                <div class="canvas-tpl-mini-meta"><span>01/${tpl.slideCount}</span><span>${escapeHtml(author)}</span></div>
              </div>

              <!-- Quick Action Overlay on Hover -->
              <div class="canvas-tpl-deck-actions">
                <button type="button" class="canvas-tpl-action-pill canvas-tpl-btn-preview" data-tpl-id="${tpl.id}">
                  <i data-lucide="eye" style="width: 12px; height: 12px;"></i>
                  <span>Ver Slides</span>
                </button>
              </div>
            </div>

            <!-- Informações do Template -->
            <div class="canvas-tpl-info-oa">
              <div class="canvas-tpl-title-row">
                <span class="canvas-tpl-name">${escapeHtml(tpl.title)}</span>
                <span class="canvas-tpl-badge-pill">${escapeHtml(tpl.badge || tpl.categoryLabel)}</span>
              </div>
              <div class="canvas-tpl-desc">${escapeHtml(tpl.description)}</div>
              <div class="canvas-tpl-tags-row">
                ${microTags.map(mt => `<span class="canvas-tpl-micro-tag">${escapeHtml(mt)}</span>`).join('')}
              </div>
              <div class="canvas-tpl-foot-row">
                <span class="canvas-tpl-count-meta">
                  <i data-lucide="layers" style="width: 12px; height: 12px;"></i>
                  <span>${tpl.slideCount} slides · ${tpl.aspect}</span>
                </span>
                <span class="canvas-tpl-use-btn">
                  <span>Usar Template</span>
                  <i data-lucide="arrow-right" style="width: 12px; height: 12px;"></i>
                </span>
              </div>
            </div>
          `;

          // Clique no botão "Ver Slides" abre o inspetor de slides
          const previewBtn = card.querySelector('.canvas-tpl-btn-preview');
          if (previewBtn) {
            previewBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              showPreviewView(tpl);
            });
          }

          // Clique geral no card aplica o template diretamente
          card.addEventListener('click', () => applyTemplateToCanvas(tpl));
          grid.appendChild(card);
        });

        if (window.lucide) lucide.createIcons({ root: grid });
      }

      function applyTemplateToCanvas(tpl) {
        if (!tpl || !tpl.generateFrames) return;
        const generated = tpl.generateFrames();
        if (!generated || !generated.length) return;

        let startX, startY;
        if (frames.length > 0) {
          const last = frames[frames.length - 1];
          startX = last.x + last.w + FRAME_GAP * 2;
          startY = last.y;
        } else {
          const center = screenToWorld(innerWidth / 2, innerHeight / 2);
          startX = Math.round(center.x - 540);
          startY = Math.round(center.y - 675);
        }

        const newFrames = [];
        let prevFrameId = null;

        generated.forEach((gFrame, idx) => {
          const fId = frameSeq++;
          const fmtKey = gFrame.format || 'ig-feed';
          const fmt = FORMATS[fmtKey] || FORMATS['ig-feed'];
          const x = startX + idx * (fmt.w + FRAME_GAP);
          const y = startY;

          const frameChildren = (gFrame.children || []).map(ch => {
            const childId = childSeq++;
            return {
              id: childId,
              type: ch.type || 'text',
              text: ch.text || '',
              x: ch.x || 100,
              y: ch.y || 100,
              w: ch.w || 880,
              h: ch.h || 'auto',
              fontSize: ch.fontSize || 32,
              fontWeight: ch.fontWeight || 400,
              fontFamily: ch.fontFamily || 'Inter, sans-serif',
              color: ch.color || '#FFFFFF',
              textAlign: ch.textAlign || 'left',
              lineHeight: ch.lineHeight || 1.2,
              letterSpacing: ch.letterSpacing || '0em',
              fontStyle: ch.fontStyle || 'normal',
              opacity: ch.opacity !== undefined ? ch.opacity : 100,
              bind: ch.bind || null
            };
          });

          const frameObj = {
            id: fId,
            name: `${tpl.title} (${idx + 1}/${generated.length})`,
            format: fmtKey,
            x,
            y,
            w: fmt.w,
            h: fmt.h,
            bg: gFrame.bg || '#09090B',
            bgImage: null,
            bgAssetId: null,
            children: frameChildren
          };

          newFrames.push(frameObj);
          frames.push(frameObj);

          if (prevFrameId !== null) {
            const linkObj = {
              id: linkSeq++,
              from: prevFrameId,
              to: fId
            };
            links.push(linkObj);
          }
          prevFrameId = fId;
        });

        renderAll();
        selectFrame(newFrames[0].id);
        zoomToFrame(newFrames[0]);
        save();
        toast.success(`Template "${tpl.title}" aplicado com ${newFrames.length} slides!`);
        closeTemplatesModal();
      }

      if (previewBackBtn) {
        previewBackBtn.addEventListener('click', showCatalogView);
      }

      if (previewApplyBtn) {
        previewApplyBtn.addEventListener('click', () => {
          if (activePreviewTemplate) {
            applyTemplateToCanvas(activePreviewTemplate);
          }
        });
      }

      function switchCategory(cat) {
        currentCategory = cat;
        chips.forEach(c => c.classList.toggle('is-active', c.dataset.cat === currentCategory));
        renderTemplatesGrid();
      }

      chips.forEach(c => {
        c.addEventListener('click', () => switchCategory(c.dataset.cat));
      });

      let debounce = null;
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          clearTimeout(debounce);
          if (searchClearBtn) {
            searchClearBtn.style.display = searchInput.value.length > 0 ? 'flex' : 'none';
          }
          debounce = setTimeout(() => {
            searchQuery = searchInput.value;
            renderTemplatesGrid();
          }, 180);
        });
      }

      if (searchClearBtn && searchInput) {
        searchClearBtn.addEventListener('click', () => {
          searchInput.value = '';
          searchQuery = '';
          searchClearBtn.style.display = 'none';
          searchInput.focus();
          renderTemplatesGrid();
        });
      }

      function openTemplatesModal() {
        document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
        modal.classList.add('open');
        showCatalogView();
        renderTemplatesGrid();
        if (searchInput) setTimeout(() => searchInput.focus(), 60);
        if (window.lucide) lucide.createIcons();
      }

      function closeTemplatesModal() {
        modal.classList.remove('open');
        showCatalogView();
      }

      if (openBtn) {
        openBtn.addEventListener('click', openTemplatesModal);
      }
      if (closeBtn) closeBtn.addEventListener('click', closeTemplatesModal);
      if (cancelBtn) cancelBtn.addEventListener('click', closeTemplatesModal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeTemplatesModal();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) {
          if (previewView && previewView.style.display !== 'none') {
            showCatalogView();
          } else {
            closeTemplatesModal();
          }
        }
      });

      window.openTemplatesModal = openTemplatesModal;
    }

    /* --------------------------------------------------
       BARRAS DE EDIÇÃO SOLTAS (arrastar pela alça)
       A barra nasce grudada no elemento. Arrastando a alça da ponta esquerda
       ela fica onde for largada — inclusive encostada num canto — e um clique
       na mesma alça devolve ela para junto do elemento.
       -------------------------------------------------- */
    const TOOLBAR_PIN_KEY = 'tcm_toolbar_pin';
    const TOOLBAR_IDS = [
      'canvas-text-toolbar',
      'canvas-image-toolbar',
      'canvas-frame-toolbar',
      'canvas-crop-toolbar',
      'canvas-bg-reposition-toolbar',
    ];
    let toolbarPin = null;

    function applyToolbarPin() {
      if (!view) return;
      const hudResetBtn = document.getElementById('canvas-hud-reset-toolbar');

      if (toolbarPin) {
        view.classList.add('is-toolbar-pinned');
        view.style.setProperty('--tb-x', `${toolbarPin.x}px`);
        view.style.setProperty('--tb-y', `${toolbarPin.y}px`);
        if (hudResetBtn) {
          hudResetBtn.classList.add('is-active');
          hudResetBtn.title = 'Barra de edição solta: clique para grudar no elemento de novo (⌥T)';
          hudResetBtn.innerHTML = '<i data-lucide="pin" style="width: 15px; height: 15px;"></i>';
        }
      } else {
        view.classList.remove('is-toolbar-pinned');
        if (hudResetBtn) {
          hudResetBtn.classList.remove('is-active');
          hudResetBtn.title = 'Barra fixada no elemento (Arraste pela alça para soltar onde quiser)';
          hudResetBtn.innerHTML = '<i data-lucide="pin-off" style="width: 15px; height: 15px;"></i>';
        }
      }
      document.querySelectorAll('.canvas-toolbar-grip').forEach(g => {
        g.classList.toggle('is-pinned', !!toolbarPin);
        g.title = toolbarPin
          ? 'Clique para grudar a barra no elemento de novo'
          : 'Arraste para soltar a barra onde quiser';
      });
      if (window.lucide) lucide.createIcons();
    }

    function setToolbarPin(pin) {
      toolbarPin = pin;
      try {
        if (pin) localStorage.setItem(TOOLBAR_PIN_KEY, JSON.stringify(pin));
        else localStorage.removeItem(TOOLBAR_PIN_KEY);
      } catch (e) {}
      applyToolbarPin();
    }

    function resetToolbarToElement(silent = false) {
      const hasNodeSelected = selectedChildNodes.length > 0 || (selectedTextNode && selectedTextNode.childId !== null);
      const hasFrameSelected = selectedFrameIds.size > 0 || selectedId !== null;
      const hasSelection = hasNodeSelected || hasFrameSelected;
      const wasPinned = !!toolbarPin;

      setToolbarPin(null);
      updateTextToolbar();
      if (window.lucide) lucide.createIcons();

      if (silent) return;

      if (!hasSelection) {
        if (wasPinned) {
          toast.info('Posição da barra resetada. Selecione um elemento ou post para editá-lo.');
        } else {
          toast.info('Nenhuma barra de edição aberta. Selecione um texto, imagem ou post.');
        }
      } else {
        if (wasPinned) {
          toast.success('Barra de edição centralizada e fixada no elemento!');
        } else {
          toast.info('A barra de edição já está fixada no elemento selecionado.');
        }
      }
    }
    window.resetToolbarToElement = resetToolbarToElement;

    function initToolbarGrips() {
      try {
        const raw = localStorage.getItem(TOOLBAR_PIN_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number') {
            const hostW = window.innerWidth || 1200;
            const hostH = window.innerHeight || 800;
            if (parsed.x < 10 || parsed.x > hostW - 60 || parsed.y < 10 || parsed.y > hostH - 60) {
              parsed.x = Math.max(10, Math.min(hostW - 320, parsed.x));
              parsed.y = Math.max(70, Math.min(hostH - 80, parsed.y));
            }
            toolbarPin = parsed;
          }
        }
      } catch (e) {
        toolbarPin = null;
      }

      const hudResetBtn = document.getElementById('canvas-hud-reset-toolbar');
      if (hudResetBtn) {
        hudResetBtn.addEventListener('click', () => resetToolbarToElement(false));
      }

      TOOLBAR_IDS.forEach(id => {
        const bar = document.getElementById(id);
        if (!bar || bar.querySelector('.canvas-toolbar-grip')) return;

        bar.classList.add('has-grip');
        const grip = document.createElement('button');
        grip.type = 'button';
        grip.className = 'canvas-toolbar-grip';
        grip.setAttribute('aria-label', 'Mover barra de edição');
        bar.prepend(grip);

        grip.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const rect = bar.getBoundingClientRect();
          const hostRect = view.getBoundingClientRect();
          const startX = e.clientX;
          const startY = e.clientY;
          // Sem o pin a barra está centrada por transform: parte da posição real
          const originX = rect.left - hostRect.left;
          const originY = rect.top - hostRect.top;
          let arrastou = false;

          const onMove = (ev) => {
            if (!arrastou && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 3) return;
            arrastou = true;
            grip.classList.add('is-grabbing');
            const maxX = hostRect.width - rect.width - 8;
            const maxY = hostRect.height - rect.height - 8;
            setToolbarPin({
              x: Math.round(Math.min(Math.max(8, originX + (ev.clientX - startX)), Math.max(8, maxX))),
              y: Math.round(Math.min(Math.max(8, originY + (ev.clientY - startY)), Math.max(8, maxY))),
            });
          };

          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            grip.classList.remove('is-grabbing');
            // Clique seco na alça devolve a barra para junto do elemento
            if (!arrastou) resetToolbarToElement(false);
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      });

      applyToolbarPin();
    }

    function initAuthAndCloudController() {
      const authBtn = document.getElementById('canvas-auth-btn');
      const authLabel = document.getElementById('canvas-auth-label');
      const cloudSaveBtn = document.getElementById('canvas-cloud-save-btn');
      const modal = document.getElementById('canvas-auth-modal');
      const closeBtn = document.getElementById('canvas-auth-close');
      const card = document.getElementById('canvas-auth-card');

      const form = document.getElementById('modal-auth-form');
      const title = document.getElementById('modal-auth-title');
      const subtitle = document.getElementById('modal-auth-subtitle');
      const inputEmail = document.getElementById('modal-input-email');
      const inputPassword = document.getElementById('modal-input-password');
      const inputName = document.getElementById('modal-input-name');
      const wrapName = document.getElementById('modal-wrap-name');
      const btnSubmit = document.getElementById('modal-btn-submit');
      const btnSubmitLabel = document.getElementById('modal-btn-submit-label');
      const btnSwitchMode = document.getElementById('modal-btn-switch-mode');
      const switchPrompt = document.getElementById('modal-switch-prompt');
      const notice = document.getElementById('modal-auth-notice');
      const btnTogglePw = document.getElementById('modal-btn-toggle-pw');
      const btnGoogle = document.getElementById('modal-btn-google');
      const btnMicrosoft = document.getElementById('modal-btn-microsoft');

      if (!modal) return;

      let authMode = 'signin'; // 'signin' | 'signup'

      function openAuthModal(initialNotice = '') {
        document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
        modal.classList.add('open');
        clearNotice();
        if (initialNotice) showNotice('info', initialNotice);
        if (inputEmail) setTimeout(() => inputEmail.focus(), 100);
      }

      function closeAuthModal() {
        modal.classList.remove('open');
        clearNotice();
      }

      if (closeBtn) closeBtn.addEventListener('click', closeAuthModal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeAuthModal();
      });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) {
          closeAuthModal();
        }
      });

      // Efeito Parallax Liquid Glass no card
      if (card) {
        card.addEventListener('mousemove', (e) => {
          const rect = card.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          card.style.setProperty('--mouse-x', `${x}px`);
          card.style.setProperty('--mouse-y', `${y}px`);
        });
      }

      function setAuthMode(mode) {
        authMode = mode;
        clearNotice();
        if (mode === 'signin') {
          if (title) title.textContent = 'Sign in with Twin';
          if (subtitle) subtitle.textContent = 'Welcome back. Let’s get back to work.';
          if (btnSubmitLabel) btnSubmitLabel.textContent = 'Sign In';
          if (switchPrompt) switchPrompt.textContent = "Don’t have an account yet?";
          if (btnSwitchMode) btnSwitchMode.textContent = 'Sign Up';
          if (wrapName) wrapName.style.display = 'none';
        } else {
          if (title) title.textContent = 'Create your account';
          if (subtitle) subtitle.textContent = 'Start creating high-converting carousels in seconds.';
          if (btnSubmitLabel) btnSubmitLabel.textContent = 'Create Account';
          if (switchPrompt) switchPrompt.textContent = 'Already have an account?';
          if (btnSwitchMode) btnSwitchMode.textContent = 'Sign In';
          if (wrapName) wrapName.style.display = 'block';
        }
      }

      if (btnSwitchMode) {
        btnSwitchMode.addEventListener('click', () => {
          setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
        });
      }

      if (btnTogglePw && inputPassword) {
        btnTogglePw.addEventListener('click', () => {
          const isPass = inputPassword.type === 'password';
          inputPassword.type = isPass ? 'text' : 'password';
          btnTogglePw.innerHTML = `<i data-lucide="${isPass ? 'eye-off' : 'eye'}" style="width: 15px; height: 15px;"></i>`;
          if (window.lucide) lucide.createIcons();
        });
      }

      function showNotice(type, msg) {
        if (!notice) return;
        notice.className = `auth-notice-strip is-${type}`;
        notice.textContent = msg;
      }

      function clearNotice() {
        if (!notice) return;
        notice.className = 'auth-notice-strip';
        notice.textContent = '';
      }

      // Atualiza UI com base no usuário logado
      function updateAuthUI(user) {
        if (user) {
          const displayName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuário';
          if (authLabel) authLabel.textContent = displayName.length > 10 ? displayName.slice(0, 8) + '…' : displayName;
          if (authBtn) {
            authBtn.title = `Conectado como ${user.email} (Clique para opções)`;
            authBtn.classList.add('is-active');
          }
        } else {
          if (authLabel) authLabel.textContent = 'Entrar';
          if (authBtn) {
            authBtn.title = 'Entrar na sua conta / Sincronizar';
            authBtn.classList.remove('is-active');
          }
        }
      }

      if (window.SupabaseAuth) {
        window.SupabaseAuth.onAuthStateChange(updateAuthUI);
      }

      // Clique no botão de Auth do Topbar
      if (authBtn) {
        authBtn.addEventListener('click', () => {
          const user = window.SupabaseAuth ? window.SupabaseAuth.getUser() : null;
          if (!user) {
            openAuthModal();
          } else {
            if (confirm(`Conectado como: ${user.email}\n\nDeseja salvar o projeto atual na nuvem ou desconectar? (OK para Salvar, Cancelar para Sair)`)) {
              handleCloudSave();
            } else {
              if (confirm('Deseja realmente sair da sua conta?')) {
                window.SupabaseAuth.signOut();
                toast.info('Sessão encerrada com sucesso.');
              }
            }
          }
        });
      }

      // Salvar na nuvem
      async function handleCloudSave() {
        if (!window.SupabaseAuth) {
          toast.error('Supabase Auth não inicializado.');
          return;
        }
        const user = window.SupabaseAuth.getUser();
        if (!user) {
          openAuthModal('Faça login para salvar seus projetos na nuvem.');
          return;
        }

        try {
          if (cloudSaveBtn) {
            cloudSaveBtn.disabled = true;
            cloudSaveBtn.classList.add('is-saving');
          }
          toast.info('Salvando projeto na nuvem…');

          // Serializar estado dos frames
          const projectData = {
            frames: frames.map(f => ({
              id: f.id,
              name: f.name,
              x: f.x,
              y: f.y,
              w: f.w,
              h: f.h,
              bg: f.bg,
              isPanoramic: f.isPanoramic || false,
              panoIndex: f.panoIndex || null,
              panoTotal: f.panoTotal || null,
              children: f.children || []
            })),
            links: Array.from(carouselLinks || [])
          };

          const firstFrameTitle = frames[0]?.name || 'Carrossel Sem Título';

          await window.SupabaseAuth.saveProject({
            title: firstFrameTitle,
            data: projectData
          });

          toast.success('✓ Carrossel salvo na nuvem com sucesso!');
        } catch (err) {
          console.error('Erro ao salvar na nuvem:', err);
          toast.error('Erro ao salvar na nuvem: ' + (err.message || 'Tente novamente.'));
        } finally {
          if (cloudSaveBtn) {
            cloudSaveBtn.disabled = false;
            cloudSaveBtn.classList.remove('is-saving');
          }
        }
      }

      if (cloudSaveBtn) {
        cloudSaveBtn.addEventListener('click', handleCloudSave);
      }

      // Submissão do Formulário de Login / Cadastro no Modal
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          clearNotice();

          const email = inputEmail.value.trim();
          const password = inputPassword.value;
          const name = inputName ? inputName.value.trim() : '';

          if (!email || !password) {
            showNotice('error', 'Por favor, preencha todos os campos obrigatórios.');
            return;
          }

          btnSubmit.disabled = true;
          const originalLabel = btnSubmitLabel.textContent;
          btnSubmitLabel.innerHTML = `<i data-lucide="loader-2" style="width: 14px; height: 14px; animation: spin 1s linear infinite;"></i> Processando…`;
          if (window.lucide) lucide.createIcons();

          try {
            if (!window.SupabaseAuth) throw new Error('Supabase Auth não inicializado.');

            if (authMode === 'signin') {
              await window.SupabaseAuth.signIn({ email, password });
              showNotice('success', '✓ Login realizado com sucesso!');
              toast.success(`Bem-vindo de volta!`);
              setTimeout(closeAuthModal, 600);
            } else {
              await window.SupabaseAuth.signUp({ email, password, metadata: { full_name: name } });
              showNotice('success', '✓ Conta criada com sucesso!');
              toast.success('Conta criada! Você já pode salvar projetos.');
              setTimeout(closeAuthModal, 600);
            }
          } catch (err) {
            console.error('Erro no auth:', err);
            const msg = err.message || 'Erro ao processar autenticação.';
            showNotice('error', msg.includes('Invalid login') ? 'E-mail ou senha incorretos.' : msg);
          } finally {
            btnSubmit.disabled = false;
            btnSubmitLabel.textContent = originalLabel;
          }
        });
      }

      // OAuth Social Buttons no Modal
      if (btnGoogle) {
        btnGoogle.addEventListener('click', async () => {
          try {
            if (window.SupabaseAuth) await window.SupabaseAuth.signInWithOAuth('google');
          } catch (e) {
            showNotice('error', 'Não foi possível conectar com o Google.');
          }
        });
      }

      if (btnMicrosoft) {
        btnMicrosoft.addEventListener('click', async () => {
          try {
            if (window.SupabaseAuth) await window.SupabaseAuth.signInWithOAuth('azure');
          } catch (e) {
            showNotice('error', 'Não foi possível conectar com a Microsoft.');
          }
        });
      }

      window.openAuthModal = openAuthModal;
    }

    initToolbarGrips();
    initTemplatesModalController();
    initIconLibraryController();
    initFrameToolbarController();
    initBindModalController();
    initBatchCreateController();
    initCanvaExportController();
    initPanoramicModalController();
    initAuthAndCloudController();
    load();
    renderAll();
    toggleCanvas(true);
    if (window.lucide) lucide.createIcons();
  })();
})();
