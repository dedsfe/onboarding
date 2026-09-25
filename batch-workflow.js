/**
 * Criar em lote — fluxo de pasta (inputs → DesiredOutput → out)
 *
 * A pasta do lote mora no computador do usuário e o app enxerga ela direto
 * (File System Access API, Chrome/Edge), como o painel de mídia de um editor
 * de vídeo. Estrutura:
 *
 *   carrossel-x/
 *     inputs/
 *       fotos/        → alimenta a variável {{fotos}} (uma imagem por carrossel)
 *       hooks.txt     → alimenta {{hooks}} (uma linha por carrossel)
 *       textos.csv    → cabeçalho = nomes das variáveis, uma linha por carrossel
 *     DesiredOutput/  → o carrossel modelo (o app grava os slides do design aqui)
 *     out/            → um carrossel pronto por linha, cada um na sua pasta
 *
 * Regra: nome da pasta/arquivo = nome da variável. Cada linha de texto vira um
 * carrossel e pega a próxima imagem do estoque (volta ao começo quando acaba).
 */
(function () {
  'use strict';

  var IMG_RE = /\.(png|jpe?g|webp|gif|avif)$/i;
  var TXT_RE = /\.(txt|md)$/i;
  var CSV_RE = /\.csv$/i;

  var state = {
    root: null,        // FileSystemDirectoryHandle da pasta do lote
    pendingRoot: null, // pasta lembrada que ainda precisa de permissão
    pools: [],         // estoques lidos de inputs/
    outCount: 0,
    binPath: [],       // caminho aberto no painel de mídia (nomes)
    running: false,
  };

  var thumbUrls = [];
  var el = {};

  /* ---------------------------------------------------------------- utils */
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (k) { if (k) n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return n;
  }

  function icon(name) {
    return '<i data-lucide="' + name + '"></i>';
  }

  function paintIcons() {
    if (window.lucide) window.lucide.createIcons();
  }

  // "Hooks Novos.txt" -> "hooks_novos": mesma regra do nome das variáveis
  function slug(raw) {
    return String(raw || '')
      .replace(/\.[^.]+$/, '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function fileSlug(text) {
    return slug(text).replace(/_/g, '-').slice(0, 40) || 'carrossel';
  }

  function toast(kind, msg) {
    var t = window.toast;
    if (t && t[kind]) t[kind](msg);
  }

  /* ------------------------------------------- pasta lembrada (IndexedDB) */
  function idb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('tcm-batch-workflow', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbSet(key, val) {
    return idb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    }).catch(function () {});
  }

  function idbGet(key) {
    return idb().then(function (db) {
      return new Promise(function (resolve) {
        var req = db.transaction('kv').objectStore('kv').get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  /* ------------------------------------------------------ sistema de arquivos */
  async function getDir(parent, name, create) {
    try { return await parent.getDirectoryHandle(name, { create: !!create }); }
    catch (e) { return null; }
  }

  async function listDir(dir) {
    var out = [];
    for await (var entry of dir.values()) {
      if (entry.name.charAt(0) === '.') continue; // .DS_Store e cia
      out.push(entry);
    }
    out.sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, 'pt-BR', { numeric: true });
    });
    return out;
  }

  async function writeFile(dir, name, data) {
    var fh = await dir.getFileHandle(name, { create: true });
    var w = await fh.createWritable();
    await w.write(data);
    await w.close();
  }

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(file);
    });
  }

  function linesOf(text) {
    return String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  }

  // CSV com vírgula ou ponto e vírgula, aspas opcionais
  function parseCsv(text) {
    var src = String(text || '').replace(/^﻿/, '');
    var firstLine = src.split(/\r?\n/)[0] || '';
    var sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < src.length; i++) {
      var c = src[i];
      if (q) {
        if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(cell.trim()); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && src[i + 1] === '\n') i++;
        row.push(cell.trim()); cell = '';
        if (row.some(Boolean)) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
    return rows;
  }

  /* Lê inputs/ e transforma em estoques. Cada estoque tem um nome de
     variável (slug do nome da pasta/arquivo/coluna) e uma lista de itens. */
  async function readPools() {
    var pools = [];
    var inputs = await getDir(state.root, 'inputs', false);
    if (!inputs) return pools;
    var entries = await listDir(inputs);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.kind === 'directory') {
        var files = (await listDir(e)).filter(function (f) { return f.kind === 'file' && IMG_RE.test(f.name); });
        pools.push({ kind: 'image', name: e.name, bind: slug(e.name), handles: files, count: files.length, path: ['inputs', e.name] });
      } else if (TXT_RE.test(e.name)) {
        var lines = linesOf(await (await e.getFile()).text());
        pools.push({ kind: 'text', name: e.name, bind: slug(e.name), items: lines, count: lines.length, path: ['inputs'], file: e.name });
      } else if (CSV_RE.test(e.name)) {
        var rows = parseCsv(await (await e.getFile()).text());
        if (!rows.length) continue;
        var modelBinds = currentBinds().map(function (b) { return b.name; });
        var header = rows[0].map(slug);
        var hasHeader = header.some(function (hname) { return modelBinds.indexOf(hname) !== -1; }) || rows[0].length > 1;
        if (hasHeader) {
          header.forEach(function (col, ci) {
            if (!col) return;
            var items = rows.slice(1).map(function (r) { return r[ci] || ''; });
            pools.push({ kind: 'text', name: e.name + ' · ' + rows[0][ci], bind: col, items: items, count: items.filter(Boolean).length, path: ['inputs'], file: e.name });
          });
        } else {
          var col1 = rows.map(function (r) { return r[0]; }).filter(Boolean);
          pools.push({ kind: 'text', name: e.name, bind: slug(e.name), items: col1, count: col1.length, path: ['inputs'], file: e.name });
        }
      }
    }
    return pools;
  }

  async function countOut() {
    var out = await getDir(state.root, 'out', false);
    if (!out) return 0;
    return (await listDir(out)).filter(function (e) { return e.kind === 'directory'; }).length;
  }

  /* ----------------------------------------------------------- modelo */
  function model() {
    var api = window.__tcmBatch;
    return api && api.modelo ? api.modelo() : null;
  }

  function currentBinds() {
    var m = model();
    return m ? m.binds : [];
  }

  function totalToMake() {
    var binds = currentBinds().map(function (b) { return b.name; });
    var used = state.pools.filter(function (p) { return binds.indexOf(p.bind) !== -1 && p.count > 0; });
    var text = used.filter(function (p) { return p.kind === 'text'; });
    // Texto manda: 20 hooks = 20 carrosséis. Só imagem: uma por carrossel.
    if (text.length) return Math.max.apply(null, text.map(function (p) { return p.count; }));
    if (used.length) return Math.max.apply(null, used.map(function (p) { return p.count; }));
    return 0;
  }

  /* ------------------------------------------------------- abrir pasta */
  async function pickFolder() {
    if (!window.showDirectoryPicker) {
      toast('error', 'Seu navegador não abre pastas do computador. Use o Chrome ou o Edge.');
      return;
    }
    try {
      var dir = await window.showDirectoryPicker({ id: 'tcm-lote', mode: 'readwrite' });
      await useFolder(dir);
    } catch (e) {
      if (e && e.name !== 'AbortError') toast('error', 'Não consegui abrir essa pasta.');
    }
  }

  /* Cria a estrutura completa dentro de uma pasta escolhida pelo usuário:
     carrossel-novo/inputs/fotos, inputs/hooks.txt, DesiredOutput, out. */
  async function createFolder() {
    if (!window.showDirectoryPicker) {
      toast('error', 'Seu navegador não abre pastas do computador. Use o Chrome ou o Edge.');
      return;
    }
    try {
      var parent = await window.showDirectoryPicker({ id: 'tcm-lote-pai', mode: 'readwrite' });
      var m = model();
      var base = fileSlug(m ? m.nome : 'carrossel');
      var name = base, n = 2;
      while (await getDir(parent, name, false)) name = base + '-' + (n++);
      var root = await parent.getDirectoryHandle(name, { create: true });
      var inputs = await root.getDirectoryHandle('inputs', { create: true });
      var binds = currentBinds();
      var imgBinds = binds.filter(function (b) { return b.type === 'image'; });
      var txtBinds = binds.filter(function (b) { return b.type !== 'image'; });
      // Já nasce com uma pasta/arquivo por variável do design
      if (!imgBinds.length) await inputs.getDirectoryHandle('fotos', { create: true });
      for (var i = 0; i < imgBinds.length; i++) await inputs.getDirectoryHandle(imgBinds[i].name, { create: true });
      if (!txtBinds.length) await writeFile(inputs, 'hooks.txt', '');
      for (var j = 0; j < txtBinds.length; j++) await writeFile(inputs, txtBinds[j].name + '.txt', '');
      await root.getDirectoryHandle('DesiredOutput', { create: true });
      await root.getDirectoryHandle('out', { create: true });
      await useFolder(root);
      toast('success', 'Pasta "' + name + '" criada. Coloque as fotos e os textos em inputs/.');
    } catch (e) {
      if (e && e.name !== 'AbortError') toast('error', 'Não consegui criar a pasta.');
    }
  }

  async function useFolder(dir) {
    state.root = dir;
    state.pendingRoot = null;
    state.binPath = ['inputs'];
    await idbSet('root', dir);
    await refresh();
  }

  async function restoreFolder() {
    var saved = await idbGet('root');
    if (!saved || !saved.queryPermission) return;
    var perm = await saved.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      state.root = saved;
      state.binPath = ['inputs'];
    } else {
      state.pendingRoot = saved; // o navegador só devolve o acesso com um clique
    }
  }

  async function reopenPending() {
    if (!state.pendingRoot) return;
    try {
      var perm = await state.pendingRoot.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') await useFolder(state.pendingRoot);
    } catch (e) {
      toast('error', 'Não consegui reabrir a pasta. Escolha de novo.');
    }
  }

  async function refresh() {
    if (!state.root) { render(); return; }
    try {
      state.pools = await readPools();
      state.outCount = await countOut();
    } catch (e) {
      console.error('[lote] falha ao ler a pasta', e);
      toast('error', 'Não consegui ler a pasta do lote.');
    }
    render();
  }

  /* --------------------------------------------------------------- UI */
  function build() {
    el.overlay = h('div', { class: 'bw-overlay', id: 'batch-workflow' });
    el.overlay.addEventListener('mousedown', function (e) { if (e.target === el.overlay) close(); });

    el.shell = h('div', { class: 'bw' });
    el.head = h('header', { class: 'bw-head' });
    el.body = h('div', { class: 'bw-body' });
    el.foot = h('footer', { class: 'bw-foot' });
    el.shell.appendChild(el.head);
    el.shell.appendChild(el.body);
    el.shell.appendChild(el.foot);
    el.overlay.appendChild(el.shell);
    document.body.appendChild(el.overlay);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && el.overlay.classList.contains('is-open') && !state.running) close();
    });
  }

  function render() {
    renderHead();
    el.body.innerHTML = '';
    el.foot.innerHTML = '';
    if (!state.root) renderEmpty();
    else renderFlow();
    paintIcons();
  }

  function renderHead() {
    el.head.innerHTML = '';
    var title = h('div', { class: 'bw-head__title' }, [
      h('span', { class: 'bw-head__name', text: 'Criar em lote' }),
    ]);
    if (state.root) {
      title.appendChild(h('button', {
        class: 'bw-chip', title: 'Trocar a pasta do lote',
        html: icon('folder') + '<span>' + escapeHtml(state.root.name) + '</span>' + icon('chevron-down'),
        onclick: pickFolder,
      }));
    }
    el.head.appendChild(title);
    var right = h('div', { class: 'bw-head__actions' });
    if (state.root) {
      right.appendChild(h('button', { class: 'bw-icon-btn', title: 'Ler a pasta de novo', html: icon('refresh-cw'), onclick: refresh }));
    }
    right.appendChild(h('button', {
      class: 'bw-link', text: 'Preencher à mão',
      title: 'Abre o preenchimento por cartões, sem pasta',
      onclick: function () { close(); if (window.openBatchModal) window.openBatchModal(); },
    }));
    right.appendChild(h('button', { class: 'bw-icon-btn', title: 'Fechar (Esc)', html: icon('x'), onclick: close }));
    el.head.appendChild(right);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function renderEmpty() {
    var tree = h('div', { class: 'bw-tree' }, [
      treeRow('folder', 'carrossel-dicas', 0),
      treeRow('folder-input', 'inputs', 1, 'fotos, textos'),
      treeRow('images', 'fotos/', 2, 'as imagens'),
      treeRow('file-text', 'hooks.txt', 2, 'um hook por linha'),
      treeRow('palette', 'DesiredOutput', 1, 'o carrossel modelo'),
      treeRow('package', 'out', 1, 'os carrosséis prontos'),
    ]);
    var actions = h('div', { class: 'bw-empty__actions' });
    if (state.pendingRoot) {
      actions.appendChild(h('button', {
        class: 'bw-btn bw-btn--primary',
        html: icon('folder-open') + '<span>Reabrir “' + escapeHtml(state.pendingRoot.name) + '”</span>',
        onclick: reopenPending,
      }));
      actions.appendChild(h('button', { class: 'bw-btn', html: icon('folder-search') + '<span>Outra pasta</span>', onclick: pickFolder }));
    } else {
      actions.appendChild(h('button', { class: 'bw-btn bw-btn--primary', html: icon('folder-plus') + '<span>Criar pasta do lote</span>', onclick: createFolder }));
      actions.appendChild(h('button', { class: 'bw-btn', html: icon('folder-open') + '<span>Abrir pasta que já existe</span>', onclick: pickFolder }));
    }
    var card = h('div', { class: 'bw-empty' }, [
      h('div', { class: 'bw-empty__art', html: icon('folder-tree') }),
      h('h3', { class: 'bw-empty__title', text: 'O lote mora numa pasta do seu computador' }),
      h('p', { class: 'bw-empty__text', text: 'Cada pasta dentro de inputs/ alimenta a variável de mesmo nome do design. Cada linha de texto vira um carrossel pronto em out/.' }),
      tree,
      actions,
    ]);
    el.body.appendChild(card);
  }

  function treeRow(ic, name, depth, note) {
    return h('div', { class: 'bw-tree__row', style: '--d:' + depth }, [
      h('span', { class: 'bw-tree__icon', html: icon(ic) }),
      h('span', { class: 'bw-tree__name', text: name }),
      note ? h('span', { class: 'bw-tree__note', text: note }) : null,
    ]);
  }

  /* ------------------------------------------------------ fluxo (nós) */
  function renderFlow() {
    var m = model();
    var binds = m ? m.binds : [];
    var bindNames = binds.map(function (b) { return b.name; });
    var total = totalToMake();

    var stage = h('div', { class: 'bw-stage' });
    var flow = h('div', { class: 'bw-flow' });
    var wires = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wires.setAttribute('class', 'bw-wires');
    stage.appendChild(wires);
    stage.appendChild(flow);

    // 1. inputs
    var poolsList = h('div', { class: 'bw-pools' });
    if (!state.pools.length) {
      poolsList.appendChild(h('div', { class: 'bw-node__empty', text: 'inputs/ está vazia. Crie uma pasta de fotos e um hooks.txt.' }));
    }
    state.pools.forEach(function (p) {
      var used = bindNames.indexOf(p.bind) !== -1;
      var row = h('button', {
        class: 'bw-pool' + (used ? ' is-used' : ''),
        title: used ? 'Alimenta {{' + p.bind + '}}' : 'Nenhuma variável {{' + p.bind + '}} no design',
        onclick: function () { openBin(p.path, p.file); },
      }, [
        h('span', { class: 'bw-pool__icon', html: icon(p.kind === 'image' ? 'folder' : 'file-text') }),
        h('span', { class: 'bw-pool__name', text: p.name }),
        h('span', { class: 'bw-pool__count', text: p.count + (p.kind === 'image' ? ' fotos' : ' linhas') }),
        h('span', { class: 'bw-pool__bind', text: used ? '{{' + p.bind + '}}' : 'sem variável' }),
      ]);
      poolsList.appendChild(row);
      if (p.kind === 'image' && p.handles.length) {
        var strip = h('div', { class: 'bw-strip' });
        p.handles.slice(0, 6).forEach(function (fh) { strip.appendChild(thumbImg(fh)); });
        if (p.handles.length > 6) strip.appendChild(h('span', { class: 'bw-strip__more', text: '+' + (p.handles.length - 6) }));
        poolsList.appendChild(strip);
      }
    });
    var nodeIn = node('in', 'folder-input', 'inputs', 'Estoque do lote', [poolsList], function () { openBin(['inputs']); });

    // 2. DesiredOutput
    var modelBody = [];
    if (!m) {
      modelBody.push(h('div', { class: 'bw-node__empty', text: 'Crie o carrossel no canvas e marque os textos e fotos com {} para virarem variáveis.' }));
    } else {
      var slides = h('div', { class: 'bw-slides' });
      m.frames.slice(0, 4).forEach(function (f) { slides.appendChild(slideThumb(f)); });
      modelBody.push(slides);
      modelBody.push(h('div', { class: 'bw-meta', text: m.nome + ' · ' + m.frames.length + (m.frames.length === 1 ? ' slide' : ' slides') }));
      var chips = h('div', { class: 'bw-binds' });
      if (!binds.length) chips.appendChild(h('div', { class: 'bw-node__empty', text: 'Nenhuma variável ainda. Selecione um texto ou foto e clique em {} no painel.' }));
      binds.forEach(function (b) {
        var fed = state.pools.some(function (p) { return p.bind === b.name && p.count > 0; });
        chips.appendChild(h('span', {
          class: 'bw-bind' + (fed ? ' is-fed' : ''),
          title: fed ? 'Recebe de inputs/' : 'Falta inputs/' + (b.type === 'image' ? b.name + '/' : b.name + '.txt'),
          html: icon(b.type === 'image' ? 'image' : 'type') + '<span>{{' + escapeHtml(b.name) + '}}</span>',
        }));
      });
      modelBody.push(chips);
    }
    var nodeModel = node('model', 'palette', 'DesiredOutput', 'Carrossel modelo', modelBody);

    // 3. out
    var outBody = [
      h('div', { class: 'bw-big', html: '<strong>' + total + '</strong><span>' + (total === 1 ? 'carrossel' : 'carrosséis') + '</span>' }),
      h('div', { class: 'bw-meta', text: m ? total * m.frames.length + ' imagens · PNG' : '' }),
    ];
    if (state.outCount) outBody.push(h('div', { class: 'bw-meta', text: state.outCount + ' já gerados na pasta' }));
    var nodeOut = node('out', 'package', 'out', 'Carrosséis prontos', outBody, function () { openBin(['out']); });

    flow.appendChild(nodeIn);
    flow.appendChild(nodeModel);
    flow.appendChild(nodeOut);

    el.bin = h('aside', { class: 'bw-bin' });
    el.body.appendChild(stage);
    el.body.appendChild(el.bin);
    renderBin();

    // Fios entre os nós (desenhados depois do layout)
    requestAnimationFrame(function () { drawWires(stage, wires, [nodeIn, nodeModel, nodeOut]); });
    el.stage = stage; el.wires = wires; el.nodes = [nodeIn, nodeModel, nodeOut];

    // Rodapé
    var status = h('div', { class: 'bw-foot__status' });
    var missing = binds.filter(function (b) { return !state.pools.some(function (p) { return p.bind === b.name && p.count > 0; }); });
    if (!m) status.textContent = 'Sem carrossel modelo no canvas.';
    else if (!total) status.textContent = 'Coloque fotos e textos em inputs/ com os nomes das variáveis.';
    else if (missing.length) status.innerHTML = icon('info') + '<span>' + missing.map(function (b) { return '{{' + escapeHtml(b.name) + '}}'; }).join(', ') + ' fica igual ao modelo (sem pasta em inputs/).</span>';
    else status.innerHTML = icon('check') + '<span>Tudo ligado.</span>';
    el.progress = h('div', { class: 'bw-progress' }, [h('div', { class: 'bw-progress__fill' })]);
    el.go = h('button', {
      class: 'bw-btn bw-btn--primary bw-go',
      html: icon('sparkles') + '<span>Gerar ' + total + ' ' + (total === 1 ? 'carrossel' : 'carrosséis') + '</span>',
      onclick: generate,
    });
    el.go.disabled = !m || !total;
    el.foot.appendChild(status);
    el.foot.appendChild(el.progress);
    el.foot.appendChild(el.go);
  }

  function node(key, ic, title, sub, body, onHead) {
    var head = h('div', { class: 'bw-node__head' + (onHead ? ' is-clickable' : '') }, [
      h('span', { class: 'bw-node__icon', html: icon(ic) }),
      h('div', { class: 'bw-node__titles' }, [
        h('span', { class: 'bw-node__title', text: title }),
        h('span', { class: 'bw-node__sub', text: sub }),
      ]),
    ]);
    if (onHead) head.addEventListener('click', onHead);
    return h('div', { class: 'bw-node bw-node--' + key }, [
      h('span', { class: 'bw-port bw-port--in' }),
      head,
      h('div', { class: 'bw-node__body' }, body),
      h('span', { class: 'bw-port bw-port--out' }),
    ]);
  }

  function drawWires(stage, svg, nodes) {
    var box = stage.getBoundingClientRect();
    svg.setAttribute('width', box.width);
    svg.setAttribute('height', box.height);
    svg.innerHTML = '';
    for (var i = 0; i < nodes.length - 1; i++) {
      var a = nodes[i].querySelector('.bw-port--out').getBoundingClientRect();
      var b = nodes[i + 1].querySelector('.bw-port--in').getBoundingClientRect();
      var x1 = a.left + a.width / 2 - box.left, y1 = a.top + a.height / 2 - box.top;
      var x2 = b.left + b.width / 2 - box.left, y2 = b.top + b.height / 2 - box.top;
      var dx = Math.max(40, (x2 - x1) / 2);
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2);
      path.setAttribute('class', 'bw-wire');
      svg.appendChild(path);
    }
  }

  function thumbImg(fileHandle) {
    var img = h('img', { class: 'bw-thumb', alt: fileHandle.name, loading: 'lazy', draggable: 'false' });
    fileHandle.getFile().then(function (f) {
      var url = URL.createObjectURL(f);
      thumbUrls.push(url);
      img.src = url;
    }).catch(function () {});
    return img;
  }

  function slideThumb(frame) {
    var img = h('img', { class: 'bw-slide', alt: frame.name || 'slide' });
    img.style.aspectRatio = frame.w + ' / ' + frame.h;
    if (window.renderFrameToCanvas) {
      window.renderFrameToCanvas(frame, { scale: Math.min(1, 240 / Math.max(frame.w, frame.h)), format: 'jpeg' })
        .then(function (c) { img.src = c.toDataURL('image/jpeg', 0.8); })
        .catch(function () {});
    }
    return img;
  }

  /* ------------------------------------------ painel de mídia (a pasta) */
  function openBin(path, focusFile) {
    state.binPath = path.slice();
    state.binFocus = focusFile || null;
    renderBin();
  }

  async function dirAt(path) {
    var d = state.root;
    for (var i = 0; i < path.length; i++) {
      d = await getDir(d, path[i], false);
      if (!d) return null;
    }
    return d;
  }

  async function renderBin() {
    if (!el.bin) return;
    var path = state.binPath || [];
    var bin = el.bin;
    bin.innerHTML = '';

    var crumbs = h('div', { class: 'bw-crumbs' });
    var all = [state.root.name].concat(path);
    all.forEach(function (name, i) {
      if (i) crumbs.appendChild(h('span', { class: 'bw-crumbs__sep', html: icon('chevron-right') }));
      crumbs.appendChild(h('button', {
        class: 'bw-crumbs__item' + (i === all.length - 1 ? ' is-current' : ''),
        text: name,
        onclick: function () { openBin(path.slice(0, i)); },
      }));
    });
    var tools = h('div', { class: 'bw-bin__tools' }, [
      h('button', { class: 'bw-icon-btn', title: 'Nova pasta aqui', html: icon('folder-plus'), onclick: newFolderHere }),
      h('label', { class: 'bw-icon-btn', title: 'Adicionar arquivos aqui', html: icon('upload') }, []),
    ]);
    var picker = h('input', { type: 'file', multiple: 'multiple', hidden: 'hidden' });
    picker.addEventListener('change', function () { addFiles(picker.files); picker.value = ''; });
    tools.lastChild.appendChild(picker);
    bin.appendChild(h('div', { class: 'bw-bin__head' }, [crumbs, tools]));

    var grid = h('div', { class: 'bw-grid' });
    bin.appendChild(grid);
    paintIcons();

    var dir = await dirAt(path);
    if (!dir) { grid.appendChild(h('div', { class: 'bw-node__empty', text: 'Essa pasta não existe mais.' })); return; }
    var entries = await listDir(dir);
    if (el.bin !== bin || state.binPath !== path) return; // trocou de pasta no meio

    if (!entries.length) {
      grid.appendChild(h('div', { class: 'bw-drop-hint', html: icon('image-plus') + '<span>Arraste fotos ou arquivos do Finder pra cá</span>' }));
    }
    entries.forEach(function (e) {
      if (e.kind === 'directory') {
        var art = h('span', { class: 'bw-tile__folder', html: icon('folder') });
        var tile = h('button', { class: 'bw-tile bw-tile--folder', title: e.name }, [
          art,
          h('span', { class: 'bw-tile__name', text: e.name }),
        ]);
        // Carrossel pronto em out/: mostra a capa, como um projeto num editor
        if (path[0] === 'out') coverOf(e).then(function (c) { if (c) art.replaceWith(c); });
        tile.addEventListener('dblclick', function () { openBin(path.concat(e.name)); });
        tile.addEventListener('click', function () { openBin(path.concat(e.name)); });
        grid.appendChild(tile);
      } else if (IMG_RE.test(e.name)) {
        grid.appendChild(h('div', { class: 'bw-tile bw-tile--img', title: e.name }, [
          thumbImg(e),
          h('span', { class: 'bw-tile__name', text: e.name }),
        ]));
      } else if (TXT_RE.test(e.name) || CSV_RE.test(e.name)) {
        var tt = h('button', { class: 'bw-tile bw-tile--text' + (state.binFocus === e.name ? ' is-focus' : ''), title: e.name }, [
          h('span', { class: 'bw-tile__doc', html: icon(CSV_RE.test(e.name) ? 'sheet' : 'file-text') }),
          h('span', { class: 'bw-tile__name', text: e.name }),
        ]);
        tt.addEventListener('click', function () { showText(e); });
        grid.appendChild(tt);
        if (state.binFocus === e.name) showText(e);
      } else {
        grid.appendChild(h('div', { class: 'bw-tile bw-tile--other', title: e.name }, [
          h('span', { class: 'bw-tile__doc', html: icon('file') }),
          h('span', { class: 'bw-tile__name', text: e.name }),
        ]));
      }
    });
    paintIcons();

    // Arrastar do Finder direto pro painel grava na pasta aberta
    bin.ondragover = function (ev) {
      if ([].indexOf.call(ev.dataTransfer.types || [], 'Files') === -1) return;
      ev.preventDefault(); ev.stopPropagation();
      bin.classList.add('is-drop');
    };
    bin.ondragleave = function () { bin.classList.remove('is-drop'); };
    bin.ondrop = function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      bin.classList.remove('is-drop');
      addFiles(ev.dataTransfer.files);
    };
  }

  async function coverOf(dir) {
    var slides = (await listDir(dir)).filter(function (f) { return f.kind === 'file' && IMG_RE.test(f.name); });
    if (!slides.length) return null;
    var cover = h('span', { class: 'bw-tile__cover' }, [thumbImg(slides[0])]);
    if (slides.length > 1) cover.appendChild(h('span', { class: 'bw-tile__badge', text: slides.length + ' slides' }));
    return cover;
  }

  async function showText(fileHandle) {
    var text = await (await fileHandle.getFile()).text();
    var lines = CSV_RE.test(fileHandle.name)
      ? parseCsv(text).map(function (r) { return r.join('  ·  '); })
      : linesOf(text);
    var old = el.bin.querySelector('.bw-lines');
    if (old) old.remove();
    var box = h('div', { class: 'bw-lines' }, [
      h('div', { class: 'bw-lines__head' }, [
        h('span', { html: icon('file-text') + '<span>' + escapeHtml(fileHandle.name) + '</span>' }),
        h('span', { class: 'bw-lines__count', text: lines.length + ' linhas' }),
      ]),
    ]);
    var list = h('ol', { class: 'bw-lines__list' });
    lines.forEach(function (l) { list.appendChild(h('li', { text: l })); });
    if (!lines.length) list.appendChild(h('li', { class: 'is-empty', text: 'Vazio. Escreva um texto por linha e clique em ler de novo.' }));
    box.appendChild(list);
    el.bin.appendChild(box);
    paintIcons();
  }

  async function newFolderHere() {
    var name = prompt('Nome da pasta (vira a variável de mesmo nome):', 'fotos');
    if (!name) return;
    var dir = await dirAt(state.binPath);
    if (!dir) return;
    await dir.getDirectoryHandle(name.trim(), { create: true });
    await refresh();
  }

  async function addFiles(fileList) {
    var files = [].slice.call(fileList || []);
    if (!files.length) return;
    var dir = await dirAt(state.binPath);
    if (!dir) return;
    for (var i = 0; i < files.length; i++) {
      await writeFile(dir, files[i].name, files[i]);
    }
    toast('success', files.length + (files.length === 1 ? ' arquivo adicionado' : ' arquivos adicionados') + ' em ' + (state.binPath.join('/') || state.root.name));
    await refresh();
  }

  /* ----------------------------------------------------------- gerar */
  async function generate() {
    var m = model();
    if (!m || state.running) return;
    var total = totalToMake();
    if (!total) return;
    var bindNames = m.binds.map(function (b) { return b.name; });
    var pools = state.pools.filter(function (p) { return bindNames.indexOf(p.bind) !== -1 && p.count > 0; });

    state.running = true;
    el.overlay.classList.add('is-running');
    el.go.disabled = true;
    var fill = el.progress.querySelector('.bw-progress__fill');
    var label = el.go.querySelector('span');

    try {
      // O modelo vai pra DesiredOutput/: a IA via MCP enxerga o que se quer
      var desired = await state.root.getDirectoryHandle('DesiredOutput', { create: true });
      for (var s = 0; s < m.frames.length; s++) {
        var mb = await window.exportFrameToBlobs(m.frames[s], { scale: 1, format: 'png' });
        for (var k = 0; k < mb.length; k++) await writeFile(desired, 'slide-' + (s + 1) + (mb.length > 1 ? '-' + (k + 1) : '') + '.png', mb[k]);
      }

      var out = await state.root.getDirectoryHandle('out', { create: true });
      var imageCache = new Map();
      var textPool = pools.filter(function (p) { return p.kind === 'text'; })[0];

      for (var i = 0; i < total; i++) {
        label.textContent = 'Gerando ' + (i + 1) + ' de ' + total + '…';
        fill.style.width = Math.round((i / total) * 100) + '%';

        var overrides = {};
        for (var p = 0; p < pools.length; p++) {
          var pool = pools[p];
          if (pool.kind === 'text') {
            var v = pool.items[i % pool.items.length];
            if (v) overrides[pool.bind] = v;
          } else {
            var fh = pool.handles[i % pool.handles.length];
            var key = pool.bind + '/' + fh.name;
            if (!imageCache.has(key)) imageCache.set(key, await readAsDataUrl(await fh.getFile()));
            overrides[pool.bind] = imageCache.get(key);
          }
        }

        var hook = textPool ? textPool.items[i % textPool.items.length] : '';
        var folderName = String(i + 1).padStart(2, '0') + (hook ? '-' + fileSlug(hook) : '');
        var dest = await out.getDirectoryHandle(folderName, { create: true });
        for (var sl = 0; sl < m.frames.length; sl++) {
          var blobs = await window.exportFrameToBlobs(m.frames[sl], { scale: 2, format: 'png', overrides: overrides });
          for (var b = 0; b < blobs.length; b++) {
            await writeFile(dest, 'slide-' + (sl + 1) + (blobs.length > 1 ? '-' + (b + 1) : '') + '.png', blobs[b]);
          }
        }
        await new Promise(function (r) { setTimeout(r, 0); });
      }
      fill.style.width = '100%';
      toast('success', total + (total === 1 ? ' carrossel pronto' : ' carrosséis prontos') + ' em ' + state.root.name + '/out');
    } catch (e) {
      console.error('[lote] falha ao gerar', e);
      toast('error', 'O lote parou no meio: ' + (e && e.message ? e.message : 'erro desconhecido'));
    } finally {
      state.running = false;
      el.overlay.classList.remove('is-running');
      await refresh();
      openBin(['out']);
    }
  }

  /* ------------------------------------------------------ abrir/fechar */
  async function open() {
    if (!el.overlay) build();
    el.overlay.classList.add('is-open');
    if (!state.root && !state.pendingRoot) await restoreFolder();
    await refresh();
  }

  function close() {
    if (!el.overlay) return;
    el.overlay.classList.remove('is-open');
    thumbUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    thumbUrls = [];
  }

  window.addEventListener('resize', function () {
    if (el.stage && el.overlay && el.overlay.classList.contains('is-open')) drawWires(el.stage, el.wires, el.nodes);
  });

  window.openBatchWorkflow = open;
  window.closeBatchWorkflow = close;
})();
