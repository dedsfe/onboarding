/**
 * Criar em lote — passo a passo
 *
 *   1. Fotos   → uma pasta do computador (cada carrossel usa uma foto)
 *   2. Textos  → um .txt (um texto por linha) ou .csv (coluna = variável)
 *   3. Saída   → a pasta onde os carrosséis prontos são gravados
 *
 * O "resultado desejado" é o carrossel modelo do canvas: as fotos entram na
 * variável de imagem dele e os textos na variável de texto. Cada linha de
 * texto vira um carrossel e pega a próxima foto (volta ao começo quando acaba).
 *
 * Chrome/Edge leem e gravam direto nas pastas (File System Access API).
 * Nos outros navegadores a pasta de fotos é lida para a memória e a saída
 * vira um .zip baixado.
 */
(function () {
  'use strict';

  var IMG_RE = /\.(png|jpe?g|webp|gif|avif)$/i;
  var CSV_RE = /\.csv$/i;
  var canWriteDisk = typeof window.showDirectoryPicker === 'function';

  var state = {
    photos: null,  // { name, files: [fileHandle|File], dir }
    texts: null,   // { name, columns: { bind: [linhas] } | null, lines: [..] }
    out: null,     // { name, dir } | { zip: true }
    photoBind: null,
    textBind: null,
    pendingPhotos: null, // pasta lembrada que precisa de um clique pra liberar
    pendingOut: null,
    running: false,
    // Pedido pra IA: o que escrever e quantos carrosséis. A IA lê pelo MCP.
    brief: { pedido: '', quantidade: '' },
    briefMode: false,
    // Resultado desejado: carrosséis de exemplo (referência para a IA)
    ref: null,        // { name, carousels: [{ name, files: [..] }], dir }
    refSkipped: false,
    pendingRef: null,
  };
  var el = {};
  var thumbUrls = [];

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
  function icon(name) { return '<i data-lucide="' + name + '"></i>'; }
  function paintIcons() { if (window.lucide) window.lucide.createIcons(); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function toast(kind, msg) { var t = window.toast; if (t && t[kind]) t[kind](msg); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // "Hooks Novos" -> "hooks_novos": mesma regra do nome das variáveis
  function slug(raw) {
    return String(raw || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }
  function fileSlug(text) { return slug(text).replace(/_/g, '-').slice(0, 40) || 'carrossel'; }

  function linesOf(text) {
    return String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  }

  // CSV com vírgula ou ponto e vírgula, aspas opcionais
  function parseCsv(text) {
    var src = String(text || '').replace(/^﻿/, '');
    var first = src.split(/\r?\n/)[0] || '';
    var sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
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

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(file);
    });
  }

  async function fileOf(item) { return item.getFile ? item.getFile() : item; }
  function nameOf(item) { return item.name; }

  async function writeFile(dir, name, data) {
    var fh = await dir.getFileHandle(name, { create: true });
    var w = await fh.createWritable();
    await w.write(data);
    await w.close();
  }

  /* ------------------------------------------- escolhas lembradas (IDB) */
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
        tx.oncomplete = resolve; tx.onerror = resolve;
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

  /* ----------------------------------------------------------- modelo */
  function model() {
    var api = window.__tcmBatch;
    return api && api.modelo ? api.modelo() : null;
  }
  function imageBinds(m) { return (m ? m.binds : []).filter(function (b) { return b.type === 'image'; }); }
  function textBinds(m) { return (m ? m.binds : []).filter(function (b) { return b.type !== 'image'; }); }

  /* Copy = todo texto do carrossel modelo, slide a slide, de cima pra baixo.
     Texto com {} usa o nome da variável; sem {}, vira "slideN_textoM". A IA
     reescreve todos; o export troca pelo id do texto ('#id'). */
  function copySlots(m) {
    var out = [];
    (m ? m.frames : []).forEach(function (f, si) {
      var texts = (f.children || []).filter(function (c) { return c.type === 'text' && !c.hidden; })
        .sort(function (a, b) { return a.y - b.y || a.x - b.x; });
      texts.forEach(function (c, ti) {
        var exemplo = (c.text || '').trim();
        if (!exemplo && c.html) { var d = document.createElement('div'); d.innerHTML = c.html; exemplo = d.textContent.trim(); }
        out.push({
          key: c.bind || ('slide' + (si + 1) + '_texto' + (ti + 1)),
          childId: c.id,
          bind: c.bind || null,
          slide: si + 1,
          exemplo: exemplo,
        });
      });
    });
    return out;
  }

  function overrideKeyOf(m, key) {
    var slot = copySlots(m).find(function (s) { return s.key === key; });
    if (slot) return slot.bind || ('#' + slot.childId);
    return key; // variável que não está entre os textos (raro): passa direto
  }

  // Cada escolha precisa de uma variável; sem escolha manual, pega a primeira
  function resolveBinds(m) {
    var ib = imageBinds(m).map(function (b) { return b.name; });
    var tb = textBinds(m).map(function (b) { return b.name; });
    if (ib.indexOf(state.photoBind) === -1) state.photoBind = ib[0] || null;
    if (tb.indexOf(state.textBind) === -1) state.textBind = tb[0] || null;
  }

  /* Os passos que valem para este modelo: sem variável de imagem não há
     passo de fotos, sem variável de texto não há passo de textos. */
  function steps(m) {
    var list = [];
    if (imageBinds(m).length) list.push('photos');
    list.push('ref');
    if (copySlots(m).length) list.push('texts');
    list.push('out');
    return list;
  }
  function isDone(step) {
    if (step === 'photos') return !!(state.photos && state.photos.files.length);
    if (step === 'ref') return !!(state.ref && state.ref.carousels.length) || state.refSkipped;
    if (step === 'texts') return !!(state.texts && textCount() > 0) || hasBrief();
    if (step === 'out') return !!state.out;
    return false;
  }
  function currentStep(m) {
    var s = steps(m);
    for (var i = 0; i < s.length; i++) if (!isDone(s[i])) return s[i];
    return 'ready';
  }

  function textCount() {
    if (!state.texts) return 0;
    if (state.texts.rows) return state.texts.rows.length;
    if (state.texts.columns) {
      var max = 0;
      Object.keys(state.texts.columns).forEach(function (k) { max = Math.max(max, state.texts.columns[k].length); });
      return max;
    }
    return state.texts.lines.length;
  }

  function hasBrief() { return !state.texts && state.briefMode && !!state.brief.pedido.trim(); }
  function waitingAi() { return hasBrief(); }

  // Quantos carrosséis o pedido quer: o número digitado ou um por foto
  function briefCount() {
    var q = parseInt(state.brief.quantidade, 10);
    if (q > 0) return Math.min(q, 200);
    return state.photos ? state.photos.files.length : 10;
  }

  function saveBrief() { idbSet('brief', { pedido: state.brief.pedido, quantidade: state.brief.quantidade, on: state.briefMode }); }

  function totalToMake(m) {
    if (waitingAi()) return briefCount();
    if (copySlots(m).length && state.texts) return textCount();
    if (state.photos) return state.photos.files.length;
    return 0;
  }

  /* ----------------------------------------------------- passo 1: fotos */
  async function photosFromDir(dir) {
    var files = [];
    for await (var e of dir.values()) {
      if (e.kind === 'file' && IMG_RE.test(e.name)) files.push(e);
    }
    files.sort(function (a, b) { return a.name.localeCompare(b.name, 'pt-BR', { numeric: true }); });
    return files;
  }

  async function setPhotosDir(dir) {
    var files = await photosFromDir(dir);
    if (!files.length) { toast('info', 'Essa pasta não tem fotos (png, jpg, webp).'); return; }
    state.photos = { name: dir.name, files: files, dir: dir };
    state.pendingPhotos = null;
    await idbSet('photos', dir);
    render();
  }

  function setPhotosFiles(fileList, folderName) {
    var files = [].filter.call(fileList || [], function (f) { return IMG_RE.test(f.name); });
    if (!files.length) { toast('info', 'Nenhuma foto nessa seleção (png, jpg, webp).'); return; }
    files.sort(function (a, b) { return a.name.localeCompare(b.name, 'pt-BR', { numeric: true }); });
    state.photos = { name: folderName || 'fotos', files: files };
    render();
  }

  async function pickPhotos() {
    if (canWriteDisk) {
      try { await setPhotosDir(await window.showDirectoryPicker({ id: 'tcm-fotos', mode: 'read' })); }
      catch (e) { if (e && e.name !== 'AbortError') toast('error', 'Não consegui abrir essa pasta.'); }
      return;
    }
    var input = h('input', { type: 'file' });
    input.webkitdirectory = true;
    input.multiple = true;
    input.addEventListener('change', function () {
      var first = input.files[0];
      var folder = first && first.webkitRelativePath ? first.webkitRelativePath.split('/')[0] : 'fotos';
      setPhotosFiles(input.files, folder);
    });
    input.click();
  }

  async function dropPhotos(ev) {
    var items = [].slice.call((ev.dataTransfer && ev.dataTransfer.items) || []);
    var first = items[0];
    try {
      if (first && first.getAsFileSystemHandle) {
        var hnd = await first.getAsFileSystemHandle();
        if (hnd && hnd.kind === 'directory') { await setPhotosDir(hnd); return; }
      }
      var entry = first && first.webkitGetAsEntry && first.webkitGetAsEntry();
      if (entry && entry.isDirectory) {
        var reader = entry.createReader(), all = [], batch;
        do {
          batch = await new Promise(function (res, rej) { reader.readEntries(res, rej); });
          all = all.concat(batch);
        } while (batch.length);
        var files = await Promise.all(all.filter(function (x) { return x.isFile; })
          .map(function (x) { return new Promise(function (res, rej) { x.file(res, rej); }); }));
        setPhotosFiles(files, entry.name);
        return;
      }
      // Várias fotos soltas também valem
      setPhotosFiles(ev.dataTransfer.files, 'fotos');
    } catch (e) {
      toast('error', 'Não consegui ler essa pasta.');
    }
  }

  /* ---------------------------------------- passo: resultado desejado
     Exemplos do que o usuário quer ver no fim. Pasta com subpastas = um
     carrossel por subpasta; fotos soltas = uma sequência só. É referência
     para a IA — quem monta as imagens continua sendo o modelo do canvas. */
  function byName(a, b) { return a.name.localeCompare(b.name, 'pt-BR', { numeric: true }); }

  async function refFromDir(dir) {
    var loose = [], carousels = [];
    for await (var e of dir.values()) {
      if (e.name.charAt(0) === '.') continue;
      if (e.kind === 'file' && IMG_RE.test(e.name)) loose.push(e);
      else if (e.kind === 'directory') {
        var files = [];
        for await (var f of e.values()) if (f.kind === 'file' && IMG_RE.test(f.name)) files.push(f);
        if (files.length) carousels.push({ name: e.name, files: files.sort(byName) });
      }
    }
    carousels.sort(byName);
    if (loose.length) carousels.unshift({ name: dir.name, files: loose.sort(byName) });
    return carousels;
  }

  async function setRefDir(dir) {
    var carousels = await refFromDir(dir);
    if (!carousels.length) { toast('info', 'Essa pasta não tem imagens de exemplo.'); return; }
    state.ref = { name: dir.name, carousels: carousels, dir: dir };
    state.refSkipped = false;
    state.pendingRef = null;
    await idbSet('ref', dir);
    render();
  }

  // Lista de arquivos (fotos escolhidas ou pasta lida sem acesso direto)
  function setRefFiles(fileList, rootName) {
    var groups = new Map();
    [].forEach.call(fileList || [], function (f) {
      if (!IMG_RE.test(f.name)) return;
      var parts = (f.webkitRelativePath || f.name).split('/');
      var key = parts.length > 2 ? parts[1] : (parts.length === 2 ? parts[0] : 'exemplo');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    });
    if (!groups.size) { toast('info', 'Nenhuma imagem nessa seleção.'); return; }
    var carousels = [];
    groups.forEach(function (files, name) { carousels.push({ name: name, files: files.sort(byName) }); });
    state.ref = { name: rootName || 'exemplos', carousels: carousels.sort(byName) };
    state.refSkipped = false;
    render();
  }

  async function pickRef() {
    if (canWriteDisk) {
      try { await setRefDir(await window.showDirectoryPicker({ id: 'tcm-ref', mode: 'read' })); }
      catch (e) { if (e && e.name !== 'AbortError') toast('error', 'Não consegui abrir essa pasta.'); }
      return;
    }
    var input = h('input', { type: 'file' });
    input.webkitdirectory = true;
    input.multiple = true;
    input.addEventListener('change', function () {
      var first = input.files[0];
      setRefFiles(input.files, first && first.webkitRelativePath ? first.webkitRelativePath.split('/')[0] : 'exemplos');
    });
    input.click();
  }

  function pickRefPhotos() {
    var input = h('input', { type: 'file', accept: 'image/*', multiple: 'multiple' });
    input.addEventListener('change', function () { setRefFiles(input.files, 'fotos escolhidas'); });
    input.click();
  }

  async function dropRef(ev) {
    var first = ev.dataTransfer && ev.dataTransfer.items && ev.dataTransfer.items[0];
    try {
      if (first && first.getAsFileSystemHandle) {
        var hnd = await first.getAsFileSystemHandle();
        if (hnd && hnd.kind === 'directory') { await setRefDir(hnd); return; }
      }
    } catch (e) {}
    setRefFiles(ev.dataTransfer.files, 'fotos escolhidas');
  }

  /* ---------------------------------------------------- passo 2: textos */
  function setTextsFromString(name, text) {
    var m = model();
    var tb = textBinds(m).map(function (b) { return b.name; });
    var texts = { name: name, lines: [], columns: null };
    if (CSV_RE.test(name)) {
      var rows = parseCsv(text);
      var header = (rows[0] || []).map(slug);
      var hits = header.filter(function (c) { return tb.indexOf(c) !== -1; });
      if (hits.length) {
        // Cabeçalho com nomes de variáveis: cada coluna alimenta a sua
        texts.columns = {};
        header.forEach(function (col, ci) {
          if (tb.indexOf(col) === -1) return;
          texts.columns[col] = rows.slice(1).map(function (r) { return r[ci] || ''; });
        });
        texts.lines = rows.slice(1).map(function (r) { return r.filter(Boolean).join(' · '); });
      } else {
        texts.lines = rows.map(function (r) { return r[0]; }).filter(Boolean);
      }
    } else {
      texts.lines = linesOf(text);
    }
    if (!texts.lines.length) { toast('info', 'Esse arquivo está vazio. Escreva um texto por linha.'); return; }
    state.texts = texts;
    idbSet('texts', { name: name, text: text });
    render();
  }

  function pickTexts() {
    var input = h('input', { type: 'file', accept: '.txt,.csv,.md,text/plain,text/csv' });
    input.addEventListener('change', async function () {
      var f = input.files[0];
      if (f) setTextsFromString(f.name, await f.text());
    });
    input.click();
  }

  async function dropTexts(ev) {
    var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) setTextsFromString(f.name, await f.text());
  }

  function aiPrompt() {
    return 'Veja meu pedido de lote no Carousel Maker e gere os carrosséis.';
  }

  async function copyPrompt(m, btn) {
    try {
      await navigator.clipboard.writeText(aiPrompt(m));
      btn.querySelector('span').textContent = 'Copiado!';
      setTimeout(function () { btn.querySelector('span').textContent = 'Copiar frase'; }, 1600);
    } catch (e) {
      toast('error', 'Não consegui copiar. Selecione o texto e copie à mão.');
    }
  }

  /* ----------------------------------------------------- passo 3: saída */
  async function pickOut() {
    if (!canWriteDisk) { state.out = { zip: true, name: 'arquivo .zip' }; render(); return; }
    try {
      var dir = await window.showDirectoryPicker({ id: 'tcm-saida', mode: 'readwrite' });
      state.out = { name: dir.name, dir: dir };
      state.pendingOut = null;
      await idbSet('out', dir);
      render();
    } catch (e) {
      if (e && e.name !== 'AbortError') toast('error', 'Não consegui abrir essa pasta.');
    }
  }

  async function reopen(kind) {
    if (kind === 'ref') {
      try {
        if ((await state.pendingRef.requestPermission({ mode: 'read' })) === 'granted') await setRefDir(state.pendingRef);
      } catch (e) { toast('error', 'Não consegui reabrir a pasta. Escolha de novo.'); }
      return;
    }
    var hnd = kind === 'photos' ? state.pendingPhotos : state.pendingOut;
    if (!hnd) return;
    try {
      var perm = await hnd.requestPermission({ mode: kind === 'photos' ? 'read' : 'readwrite' });
      if (perm !== 'granted') return;
      if (kind === 'photos') await setPhotosDir(hnd);
      else { state.out = { name: hnd.name, dir: hnd }; state.pendingOut = null; render(); }
    } catch (e) {
      toast('error', 'Não consegui reabrir a pasta. Escolha de novo.');
    }
  }

  // Lê as escolhas guardadas uma vez por sessão: depois o estado em memória manda
  var restored = false;
  async function restore() {
    if (restored) return;
    restored = true;
    var br = await idbGet('brief');
    if (br) { state.brief = { pedido: br.pedido || '', quantidade: br.quantidade || '' }; state.briefMode = !!br.on; }
    if (!canWriteDisk) return;
    var p = await idbGet('photos');
    if (p && p.queryPermission && !state.photos) {
      if ((await p.queryPermission({ mode: 'read' })) === 'granted') {
        try { var files = await photosFromDir(p); if (files.length) state.photos = { name: p.name, files: files, dir: p }; } catch (e) {}
      } else state.pendingPhotos = p;
    }
    var rf = await idbGet('ref');
    if (rf && rf.queryPermission && !state.ref) {
      if ((await rf.queryPermission({ mode: 'read' })) === 'granted') {
        try { var cs = await refFromDir(rf); if (cs.length) state.ref = { name: rf.name, carousels: cs, dir: rf }; } catch (e) {}
      } else state.pendingRef = rf;
    }
    var t = await idbGet('texts');
    if (t && !state.texts) setTextsFromString(t.name, t.text);
    var o = await idbGet('out');
    if (o && o.queryPermission && !state.out) {
      if ((await o.queryPermission({ mode: 'readwrite' })) === 'granted') state.out = { name: o.name, dir: o };
      else state.pendingOut = o;
    }
  }

  /* --------------------------------------------------------------- UI */
  var STEP_INFO = {
    photos: { n: 'Fotos', title: 'Escolha a pasta com as fotos', sub: 'Cada carrossel vai usar uma foto dessa pasta, na ordem dos nomes.' },
    ref: { n: 'Resultado desejado', title: 'Mostre o resultado que você quer', sub: 'Uma pasta com carrosséis de exemplo (uma subpasta por carrossel) ou algumas fotos em sequência. A IA usa como referência.' },
    texts: { n: 'Copy', title: 'Agora a copy: peça pra IA ou escolha um arquivo', sub: 'A IA escreve o texto de todos os slides de cada carrossel, a partir do seu pedido.' },
    out: { n: 'Saída', title: 'Por último, onde salvar os carrosséis', sub: 'Cada carrossel pronto vira uma pasta com os slides em PNG.' },
    ready: { title: 'Tudo pronto', sub: '' },
  };

  function build() {
    el.overlay = h('div', { class: 'bw-overlay', id: 'batch-workflow' });
    el.overlay.addEventListener('mousedown', function (e) { if (e.target === el.overlay && !state.running) close(); });
    el.shell = h('div', { class: 'bw' });
    el.overlay.appendChild(el.shell);
    document.body.appendChild(el.overlay);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && el.overlay.classList.contains('is-open') && !state.running) close();
    });
  }

  function render() {
    var m = model();
    resolveBinds(m);
    var list = steps(m);
    var cur = currentStep(m);
    var total = totalToMake(m);

    el.shell.innerHTML = '';

    // Cabeçalho com os passos
    var stepper = h('ol', { class: 'bw-steps' });
    list.forEach(function (s, i) {
      var done = isDone(s);
      stepper.appendChild(h('li', {
        class: 'bw-steps__item' + (done ? ' is-done' : '') + (s === cur ? ' is-current' : ''),
        html: '<span class="bw-steps__dot">' + (done ? icon('check') : (i + 1)) + '</span><span>' + STEP_INFO[s].n + '</span>',
      }));
    });
    el.shell.appendChild(h('header', { class: 'bw-head' }, [
      h('span', { class: 'bw-head__name', text: 'Criar em lote' }),
      stepper,
      h('div', { class: 'bw-head__actions' }, [
        h('button', { class: 'bw-link', text: 'Preencher à mão', title: 'Preencher post por post, sem pastas', onclick: function () { close(); if (window.openBatchModal) window.openBatchModal(); } }),
        h('button', { class: 'bw-icon-btn', title: 'Fechar (Esc)', html: icon('x'), onclick: close }),
      ]),
    ]));

    // Guia: o que fazer agora, em uma frase
    var guide = h('div', { class: 'bw-guide' });
    if (!m) {
      guide.appendChild(guideText('Primeiro crie o carrossel modelo no canvas', 'É ele que define como os carrosséis vão ficar.', 0, 0));
    } else if (!m.binds.length) {
      guide.appendChild(guideText('Antes: marque o que muda no design', 'Selecione o texto e a foto que trocam em cada carrossel e clique em {} no painel da direita.', 0, 0));
    } else if (cur === 'ready') {
      guide.appendChild(waitingAi()
        ? guideText('Tudo pronto pra IA: ' + plural(total, 'carrossel', 'carrosséis'), 'Mande a frase da direita no Claude. Os carrosséis caem na sua pasta de saída.', 0, 0, true)
        : guideText('Tudo pronto: ' + plural(total, 'carrossel', 'carrosséis') + ' pra gerar', 'Confira à direita e clique em Gerar.', 0, 0, true));
    } else {
      guide.appendChild(guideText(STEP_INFO[cur].title, STEP_INFO[cur].sub, list.indexOf(cur) + 1, list.length));
    }
    el.shell.appendChild(guide);

    // Fluxo: entradas → resultado desejado → saída
    var stage = h('div', { class: 'bw-stage' });
    var wires = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wires.setAttribute('class', 'bw-wires');
    var flow = h('div', { class: 'bw-flow' });
    stage.appendChild(wires);
    stage.appendChild(flow);

    var inputsCol = h('div', { class: 'bw-col' });
    var inNodes = [];
    if (list.indexOf('photos') !== -1) { var np = photosNode(m, cur); inputsCol.appendChild(np); inNodes.push(np); }
    var nr = refNode(m, cur); inputsCol.appendChild(nr); inNodes.push(nr);
    if (list.indexOf('texts') !== -1) { var nt = textsNode(m, cur); inputsCol.appendChild(nt); inNodes.push(nt); }
    var nm = modelNode(m);
    var no = outNode(m, cur, total);
    if (inNodes.length) flow.appendChild(inputsCol);
    flow.appendChild(nm);
    flow.appendChild(no);

    var body = h('div', { class: 'bw-body' }, [stage, sidePanel(m, cur)]);
    el.shell.appendChild(body);

    // Rodapé
    el.progress = h('div', { class: 'bw-progress' }, [h('div', { class: 'bw-progress__fill' })]);
    el.go = h('button', {
      class: 'bw-btn bw-btn--primary bw-go',
      html: icon('sparkles') + '<span>' + (cur === 'ready' && total ? 'Gerar ' + plural(total, 'carrossel', 'carrosséis') : 'Gerar') + '</span>',
      onclick: generate,
    });
    el.go.disabled = !m || !m.binds.length || cur !== 'ready' || !total || waitingAi();
    if (cur === 'ready' && waitingAi()) el.go.querySelector('span').textContent = 'Esperando a IA…';
    el.shell.appendChild(h('footer', { class: 'bw-foot' }, [
      h('div', { class: 'bw-foot__status', text: cur !== 'ready' ? 'Complete os passos para gerar.' : (waitingAi() ? 'A IA gera pelo MCP: mande a frase da direita no Claude.' : '') }),
      el.progress,
      el.go,
    ]));

    paintIcons();
    el.stage = stage; el.wires = wires;
    el.links = inNodes.map(function (n) { return [n, nm]; }).concat([[nm, no]]);
    requestAnimationFrame(drawWires);
  }

  function guideText(title, sub, n, total, ok) {
    return h('div', { class: 'bw-guide__inner' + (ok ? ' is-ok' : '') }, [
      n ? h('span', { class: 'bw-guide__count', text: 'Passo ' + n + ' de ' + total }) : null,
      h('div', { class: 'bw-guide__title', text: title }),
      sub ? h('div', { class: 'bw-guide__sub', text: sub }) : null,
    ]);
  }

  function node(key, opts) {
    var n = h('div', { class: 'bw-node bw-node--' + key + (opts.state ? ' is-' + opts.state : '') }, [
      h('span', { class: 'bw-port bw-port--in' }),
      h('div', { class: 'bw-node__head' }, [
        h('span', { class: 'bw-node__icon', html: icon(opts.icon) }),
        h('div', { class: 'bw-node__titles' }, [
          h('span', { class: 'bw-node__title', text: opts.title }),
          opts.sub ? h('span', { class: 'bw-node__sub', text: opts.sub }) : null,
        ]),
        opts.action || null,
      ]),
      h('div', { class: 'bw-node__body' }, opts.body || []),
      h('span', { class: 'bw-port bw-port--out' }),
    ]);
    if (opts.onDrop) {
      n.addEventListener('dragover', function (e) {
        if ([].indexOf.call(e.dataTransfer.types || [], 'Files') === -1) return;
        e.preventDefault(); e.stopPropagation(); n.classList.add('is-over');
      });
      n.addEventListener('dragleave', function () { n.classList.remove('is-over'); });
      n.addEventListener('drop', function (e) { e.preventDefault(); e.stopPropagation(); n.classList.remove('is-over'); opts.onDrop(e); });
    }
    return n;
  }

  function stateOf(step, cur) {
    if (isDone(step)) return 'done';
    return step === cur ? 'active' : 'todo';
  }

  function swapBtn(onclick) {
    return h('button', { class: 'bw-swap', text: 'Trocar', onclick: onclick });
  }

  function bindSelect(binds, value, onChange) {
    if (binds.length < 2) return binds.length ? h('span', { class: 'bw-pill', text: '→ {{' + binds[0].name + '}}' }) : null;
    var sel = h('select', { class: 'bw-select', title: 'Qual variável do design recebe isso' });
    binds.forEach(function (b) {
      var o = h('option', { value: b.name, text: '→ {{' + b.name + '}}' });
      if (b.name === value) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { onChange(sel.value); render(); });
    return sel;
  }

  function photosNode(m, cur) {
    var st = stateOf('photos', cur);
    var body = [];
    if (st === 'done') {
      var strip = h('div', { class: 'bw-strip' });
      state.photos.files.slice(0, 5).forEach(function (f) { strip.appendChild(thumbImg(f)); });
      if (state.photos.files.length > 5) strip.appendChild(h('span', { class: 'bw-strip__more', text: '+' + (state.photos.files.length - 5) }));
      body.push(strip);
      body.push(h('div', { class: 'bw-row' }, [
        h('span', { class: 'bw-meta', html: icon('folder') + '<span>' + escapeHtml(state.photos.name) + ' · ' + plural(state.photos.files.length, 'foto', 'fotos') + '</span>' }),
        bindSelect(imageBinds(m), state.photoBind, function (v) { state.photoBind = v; }),
      ]));
    } else if (st === 'active') {
      if (state.pendingPhotos) {
        body.push(h('button', { class: 'bw-btn bw-btn--primary bw-cta', html: icon('folder-open') + '<span>Reabrir “' + escapeHtml(state.pendingPhotos.name) + '”</span>', onclick: function () { reopen('photos'); } }));
        body.push(h('button', { class: 'bw-link', text: 'ou escolher outra pasta', onclick: pickPhotos }));
      } else {
        body.push(h('button', { class: 'bw-btn bw-btn--primary bw-cta', html: icon('folder-search') + '<span>Escolher pasta de fotos</span>', onclick: pickPhotos }));
        body.push(h('span', { class: 'bw-hint', text: 'ou arraste a pasta pra cá' }));
      }
    } else {
      body.push(h('span', { class: 'bw-hint', text: 'Uma pasta com as imagens' }));
    }
    return node('photos', {
      icon: 'images', title: 'Fotos', sub: st === 'done' ? null : 'Passo ' + (steps(m).indexOf('photos') + 1),
      state: st, body: body,
      action: st === 'done' ? swapBtn(pickPhotos) : null,
      onDrop: dropPhotos,
    });
  }

  function textsNode(m, cur) {
    var st = stateOf('texts', cur);
    var body = [];
    if (st === 'done' && waitingAi()) {
      body.push(h('div', { class: 'bw-brief-sum' }, [
        h('span', { class: 'bw-brief-sum__tag', html: icon('bot') + '<span>A IA vai escrever</span>' }),
        h('p', { class: 'bw-brief-sum__text', text: state.brief.pedido }),
      ]));
      body.push(h('div', { class: 'bw-row' }, [
        h('span', { class: 'bw-meta', text: plural(briefCount(), 'carrossel', 'carrosséis') + ' · ' + plural(copySlots(m).length, 'texto', 'textos') + ' cada' }),
        bindSelect(textBinds(m), state.textBind, function (v) { state.textBind = v; }),
      ]));
    } else if (st === 'done') {
      var list = h('ol', { class: 'bw-mini-lines' });
      state.texts.lines.slice(0, 3).forEach(function (l) { list.appendChild(h('li', { text: l })); });
      body.push(list);
      body.push(h('div', { class: 'bw-row' }, [
        h('span', { class: 'bw-meta', html: icon(state.texts.fromAi ? 'bot' : 'file-text') + '<span>' + escapeHtml(state.texts.name) + ' · ' + plural(textCount(), 'linha', 'linhas') + '</span>' }),
        state.texts.columns ? h('span', { class: 'bw-pill', text: Object.keys(state.texts.columns).map(function (k) { return '{{' + k + '}}'; }).join(' ') })
          : bindSelect(textBinds(m), state.textBind, function (v) { state.textBind = v; }),
      ]));
    } else if (st === 'active' && state.briefMode) {
      body.push(briefForm(m));
    } else if (st === 'active') {
      body.push(h('button', { class: 'bw-btn bw-btn--primary bw-cta', html: icon('bot') + '<span>Pedir pra IA escrever</span>', onclick: function () { state.briefMode = true; saveBrief(); render(); } }));
      body.push(h('button', { class: 'bw-btn bw-cta', html: icon('file-search') + '<span>Já tenho os textos</span>', onclick: pickTexts }));
    } else {
      body.push(h('span', { class: 'bw-hint', text: 'Um arquivo de textos ou um pedido pra IA' }));
    }
    var action = null;
    if (st === 'done') {
      action = swapBtn(function () {
        state.texts = null; state.briefMode = false;
        idbSet('texts', null); saveBrief(); render();
      });
    }
    return node('texts', {
      icon: 'type', title: 'Copy', sub: st === 'done' ? null : 'Passo ' + (steps(m).indexOf('texts') + 1),
      state: st, body: body, action: action,
      onDrop: dropTexts,
    });
  }

  // Pedido pra IA: o que escrever + quantos carrosséis
  function briefForm(m) {
    var ta = h('textarea', {
      class: 'bw-textarea', rows: '4',
      placeholder: 'Ex.: carrosséis sobre produtividade pra quem trabalha em casa. Capa com hook curto, slides com uma dica cada, último com CTA pra seguir. Tom direto, sem emoji.',
    });
    ta.value = state.brief.pedido;
    var qty = h('input', { class: 'bw-qty', type: 'number', min: '1', max: '200', placeholder: String(state.photos ? state.photos.files.length : 10) });
    qty.value = state.brief.quantidade;
    var ok = h('button', { class: 'bw-btn bw-btn--primary bw-cta', html: icon('check') + '<span>Pronto</span>' });
    ok.disabled = !state.brief.pedido.trim();
    ta.addEventListener('input', function () { state.brief.pedido = ta.value; ok.disabled = !ta.value.trim(); saveBrief(); });
    qty.addEventListener('input', function () { state.brief.quantidade = qty.value; saveBrief(); });
    ok.addEventListener('click', function () { if (state.brief.pedido.trim()) render(); });
    setTimeout(function () { ta.focus(); }, 30);
    return h('div', { class: 'bw-brief' }, [
      h('label', { class: 'bw-brief__label', text: 'Qual copy a IA deve escrever?' }),
      h('span', { class: 'bw-hint bw-brief__hint', text: 'Ela escreve todos os ' + plural(copySlots(m).length, 'texto', 'textos') + ' do carrossel, slide a slide.' }),
      ta,
      h('label', { class: 'bw-brief__row' }, [h('span', { text: 'Quantos carrosséis' }), qty]),
      ok,
      h('button', { class: 'bw-link', text: 'ou escolher um arquivo de textos', onclick: function () { state.briefMode = false; saveBrief(); pickTexts(); } }),
    ]);
  }

  function refNode(m, cur) {
    var st = stateOf('ref', cur);
    var body = [];
    if (st === 'done' && state.refSkipped) {
      body.push(h('span', { class: 'bw-hint', text: 'Sem exemplo: a IA segue só o pedido.' }));
    } else if (st === 'done') {
      state.ref.carousels.slice(0, 2).forEach(function (c) {
        var strip = h('div', { class: 'bw-strip bw-strip--seq' });
        c.files.slice(0, 5).forEach(function (f) { strip.appendChild(thumbImg(f)); });
        if (c.files.length > 5) strip.appendChild(h('span', { class: 'bw-strip__more', text: '+' + (c.files.length - 5) }));
        body.push(strip);
      });
      body.push(h('span', { class: 'bw-meta', html: icon('folder') + '<span>' + escapeHtml(state.ref.name) + ' · ' + plural(state.ref.carousels.length, 'carrossel', 'carrosséis') + '</span>' }));
    } else if (st === 'active') {
      if (state.pendingRef) {
        body.push(h('button', { class: 'bw-btn bw-btn--primary bw-cta', html: icon('folder-open') + '<span>Reabrir “' + escapeHtml(state.pendingRef.name) + '”</span>', onclick: function () { reopen('ref'); } }));
        body.push(h('button', { class: 'bw-link', text: 'ou escolher outra pasta', onclick: pickRef }));
      } else {
        body.push(h('button', { class: 'bw-btn bw-btn--primary bw-cta', html: icon('folder-search') + '<span>Escolher pasta de exemplos</span>', onclick: pickRef }));
        body.push(h('button', { class: 'bw-btn bw-cta', html: icon('images') + '<span>Escolher fotos em sequência</span>', onclick: pickRefPhotos }));
      }
      body.push(h('button', { class: 'bw-link', text: 'pular este passo', onclick: function () { state.refSkipped = true; render(); } }));
    } else {
      body.push(h('span', { class: 'bw-hint', text: 'Carrosséis de exemplo' }));
    }
    return node('ref', {
      icon: 'target', title: 'Resultado desejado', sub: st === 'done' ? null : 'Passo ' + (steps(m).indexOf('ref') + 1),
      state: st, body: body,
      action: st === 'done' ? swapBtn(function () { state.ref = null; state.refSkipped = false; idbSet('ref', null); render(); }) : null,
      onDrop: dropRef,
    });
  }

  function modelNode(m) {
    var body = [];
    if (!m) {
      body.push(h('span', { class: 'bw-hint', text: 'Crie o carrossel no canvas.' }));
    } else {
      var slides = h('div', { class: 'bw-slides' });
      m.frames.slice(0, 3).forEach(function (f) { slides.appendChild(slideThumb(f)); });
      body.push(slides);
      var chips = h('div', { class: 'bw-binds' });
      if (!m.binds.length) chips.appendChild(h('span', { class: 'bw-hint', text: 'Nada marcado com {} ainda' }));
      m.binds.forEach(function (b) {
        var fed = (b.type === 'image' && state.photos && state.photoBind === b.name)
          || (b.type !== 'image' && state.texts && (state.texts.columns ? !!state.texts.columns[b.name] : state.textBind === b.name));
        chips.appendChild(h('span', {
          class: 'bw-bind' + (fed ? ' is-fed' : ''),
          title: fed ? 'Vai mudar em cada carrossel' : 'Fica igual ao modelo',
          html: icon(b.type === 'image' ? 'image' : 'type') + '<span>{{' + escapeHtml(b.name) + '}}</span>',
        }));
      });
      body.push(chips);
      var nCopy = copySlots(m).length;
      if (nCopy) body.push(h('span', { class: 'bw-meta', html: icon('type') + '<span>' + plural(nCopy, 'texto de copy', 'textos de copy') + ' em ' + plural(m.frames.length, 'slide', 'slides') + '</span>' }));
    }
    return node('model', {
      icon: 'palette', title: 'Modelo do canvas',
      sub: m ? m.nome + ' · ' + plural(m.frames.length, 'slide', 'slides') : 'sem modelo',
      state: m && m.binds.length ? 'done' : 'active', body: body,
    });
  }

  function outNode(m, cur, total) {
    var st = stateOf('out', cur);
    var body = [];
    if (st === 'done') {
      body.push(h('div', { class: 'bw-big', html: '<strong>' + total + '</strong><span>' + (total === 1 ? 'carrossel' : 'carrosséis') + '</span>' }));
      body.push(h('span', { class: 'bw-meta', html: icon(state.out.zip ? 'file-archive' : 'folder') + '<span>' + escapeHtml(state.out.zip ? 'Baixar como .zip' : state.out.name) + '</span>' }));
    } else if (st === 'active') {
      if (state.pendingOut) {
        body.push(h('button', { class: 'bw-btn bw-btn--primary bw-cta', html: icon('folder-open') + '<span>Reabrir “' + escapeHtml(state.pendingOut.name) + '”</span>', onclick: function () { reopen('out'); } }));
        body.push(h('button', { class: 'bw-link', text: 'ou escolher outra', onclick: pickOut }));
      } else {
        body.push(h('button', {
          class: 'bw-btn bw-btn--primary bw-cta',
          html: icon(canWriteDisk ? 'folder-output' : 'file-archive') + '<span>' + (canWriteDisk ? 'Escolher saída' : 'Baixar como .zip') + '</span>',
          onclick: pickOut,
        }));
      }
    } else {
      body.push(h('span', { class: 'bw-hint', text: 'Onde os carrosséis prontos caem' }));
    }
    return node('out', {
      icon: 'package', title: 'Saída', sub: st === 'done' ? null : 'Passo ' + (steps(m).indexOf('out') + 1),
      state: st, body: body,
      action: st === 'done' && canWriteDisk ? swapBtn(pickOut) : null,
    });
  }

  // Painel da direita: mostra o que está escolhido e a ajuda da vez
  function sidePanel(m, cur) {
    var side = h('aside', { class: 'bw-side' });
    if (waitingAi()) {
      var btn = h('button', { class: 'bw-btn bw-copy', html: icon('copy') + '<span>Copiar frase</span>' });
      btn.addEventListener('click', function () { copyPrompt(m, btn); });
      side.appendChild(h('div', { class: 'bw-ai' }, [
        h('div', { class: 'bw-ai__head', html: icon('bot') + '<span>Agora é com a IA</span>' }),
        h('p', { class: 'bw-ai__text', text: 'No Claude (com o MCP carousel-maker ligado), mande a frase abaixo. Ela lê seu pedido, olha os exemplos, o modelo e as fotos, escreve a copy de ' + plural(briefCount(), 'carrossel', 'carrosséis') + ' e gera tudo na sua pasta de saída.' }),
        h('pre', { class: 'bw-ai__prompt', text: aiPrompt(m) }),
        btn,
        state.out ? null : h('p', { class: 'bw-ai__warn', text: 'Escolha a saída (passo 3) antes, pra IA ter onde salvar.' }),
      ]));
    }
    if (state.ref && !state.refSkipped) {
      var seqs = h('div', { class: 'bw-seqs' });
      state.ref.carousels.forEach(function (c) {
        var row = h('div', { class: 'bw-seq' });
        c.files.forEach(function (f) { row.appendChild(thumbImg(f)); });
        seqs.appendChild(h('div', { class: 'bw-seq__item' }, [h('span', { class: 'bw-tile__name', text: c.name + ' · ' + plural(c.files.length, 'slide', 'slides') }), row]));
      });
      side.appendChild(section('target', 'Resultado desejado', plural(state.ref.carousels.length, 'carrossel', 'carrosséis'), seqs));
    }
    if (state.photos) {
      var grid = h('div', { class: 'bw-grid' });
      state.photos.files.forEach(function (f) {
        grid.appendChild(h('div', { class: 'bw-tile', title: nameOf(f) }, [thumbImg(f), h('span', { class: 'bw-tile__name', text: nameOf(f) })]));
      });
      side.appendChild(section('images', state.photos.name, plural(state.photos.files.length, 'foto', 'fotos'), grid));
    }
    if (state.texts) {
      var list = h('ol', { class: 'bw-lines__list' });
      state.texts.lines.forEach(function (l) { list.appendChild(h('li', { text: l })); });
      side.appendChild(section('file-text', state.texts.name, plural(textCount(), 'linha', 'linhas'), list));
    }
    if (!side.children.length) {
      side.appendChild(h('div', { class: 'bw-side__empty', html: icon('mouse-pointer-click') + '<span>O que você escolher aparece aqui.</span>' }));
    }
    return side;
  }

  function section(ic, title, count, content) {
    return h('section', { class: 'bw-sec' }, [
      h('div', { class: 'bw-sec__head' }, [
        h('span', { class: 'bw-sec__title', html: icon(ic) + '<span>' + escapeHtml(title) + '</span>' }),
        h('span', { class: 'bw-sec__count', text: count }),
      ]),
      content,
    ]);
  }

  function drawWires() {
    if (!el.stage) return;
    var box = el.stage.getBoundingClientRect();
    el.wires.setAttribute('width', el.stage.scrollWidth);
    el.wires.setAttribute('height', el.stage.scrollHeight);
    el.wires.innerHTML = '';
    el.links.forEach(function (pair) {
      var a = pair[0].querySelector('.bw-port--out').getBoundingClientRect();
      var b = pair[1].querySelector('.bw-port--in').getBoundingClientRect();
      var x1 = a.left + a.width / 2 - box.left + el.stage.scrollLeft, y1 = a.top + a.height / 2 - box.top + el.stage.scrollTop;
      var x2 = b.left + b.width / 2 - box.left + el.stage.scrollLeft, y2 = b.top + b.height / 2 - box.top + el.stage.scrollTop;
      var dx = Math.max(30, (x2 - x1) / 2);
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2);
      var live = pair[0].classList.contains('is-done');
      path.setAttribute('class', 'bw-wire' + (live ? ' is-live' : ''));
      el.wires.appendChild(path);
    });
  }

  function thumbImg(item) {
    // alt vazio: o nome do arquivo piscava no lugar da miniatura enquanto carregava
    var img = h('img', { class: 'bw-thumb', alt: '', title: nameOf(item), loading: 'lazy', draggable: 'false' });
    fileOf(item).then(function (f) {
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

  /* ----------------------------------------------------------- gerar */
  function textFor(i, bind) {
    var t = state.texts;
    if (!t) return '';
    if (t.columns) { var col = t.columns[bind]; return col ? (col[i] || '') : ''; }
    return bind === state.textBind ? (t.lines[i % t.lines.length] || '') : '';
  }

  async function generate() {
    var m = model();
    if (!m || state.running) return null;
    var total = totalToMake(m);
    if (!total) return null;
    var result = null;

    state.running = true;
    el.overlay.classList.add('is-running');
    el.go.disabled = true;
    var fill = el.progress.querySelector('.bw-progress__fill');
    var label = el.go.querySelector('span');
    var zip = state.out.zip ? new window.JSZip() : null;
    var imageCache = new Map();

    try {
      for (var i = 0; i < total; i++) {
        label.textContent = 'Gerando ' + (i + 1) + ' de ' + total + '…';
        fill.style.width = Math.round((i / total) * 100) + '%';

        var overrides = {};
        var hook = '';
        if (state.texts && state.texts.rows) {
          var row = state.texts.rows[i] || {};
          Object.keys(row).forEach(function (k) { if (row[k]) overrides[overrideKeyOf(m, k)] = String(row[k]); });
          var firstSlot = copySlots(m)[0];
          hook = firstSlot ? (row[firstSlot.key] || '') : '';
        } else {
          textBinds(m).forEach(function (b) { var v = textFor(i, b.name); if (v) overrides[b.name] = v; });
          // Arquivo de linhas num modelo sem {}: a linha vira o primeiro texto do carrossel
          var slots = copySlots(m);
          if (!textBinds(m).length && slots.length && state.texts && state.texts.lines.length) {
            overrides['#' + slots[0].childId] = state.texts.lines[i % state.texts.lines.length];
          }
        }
        if (state.photos && state.photoBind) {
          var item = state.photos.files[i % state.photos.files.length];
          var key = nameOf(item);
          if (!imageCache.has(key)) imageCache.set(key, await readAsDataUrl(await fileOf(item)));
          overrides[state.photoBind] = imageCache.get(key);
        }

        if (!hook) hook = state.textBind ? textFor(i, state.textBind) : (state.texts && state.texts.lines ? state.texts.lines[i] : '');
        var folder = String(i + 1).padStart(2, '0') + (hook ? '-' + fileSlug(hook) : '');
        var dest = zip ? null : await state.out.dir.getDirectoryHandle(folder, { create: true });
        for (var s = 0; s < m.frames.length; s++) {
          var blobs = await window.exportFrameToBlobs(m.frames[s], { scale: 2, format: 'png', overrides: overrides });
          for (var b = 0; b < blobs.length; b++) {
            var file = 'slide-' + (s + 1) + (blobs.length > 1 ? '-' + (b + 1) : '') + '.png';
            if (zip) zip.file(folder + '/' + file, blobs[b]);
            else await writeFile(dest, file, blobs[b]);
          }
        }
        await new Promise(function (r) { setTimeout(r, 0); });
      }
      fill.style.width = '100%';
      if (zip) {
        label.textContent = 'Empacotando .zip…';
        var blob = await zip.generateAsync({ type: 'blob' });
        var a = h('a', { href: URL.createObjectURL(blob), download: fileSlug(m.nome) + '-lote.zip' });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        toast('success', plural(total, 'carrossel pronto', 'carrosséis prontos') + ' no .zip baixado');
        result = { gerados: total, slides: m.frames.length, destino: 'zip baixado no navegador' };
      } else {
        toast('success', plural(total, 'carrossel pronto', 'carrosséis prontos') + ' em ' + state.out.name);
        result = { gerados: total, slides: m.frames.length, destino: 'pasta ' + state.out.name };
      }
    } catch (e) {
      console.error('[lote] falha ao gerar', e);
      toast('error', 'O lote parou no meio: ' + (e && e.message ? e.message : 'erro desconhecido'));
      result = { erro: e && e.message ? e.message : 'erro desconhecido' };
    } finally {
      state.running = false;
      el.overlay.classList.remove('is-running');
      render();
    }
    return result;
  }

  /* ----------------------------------------------- ponte com a IA (MCP)
     mcp-bridge.js chama isto: a IA lê o pedido (com o modelo e as fotos em
     miniatura) e depois devolve os textos para gerar. */
  function smallJpeg(source, maxSide) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = function () { resolve(null); };
      img.src = source;
    });
  }

  async function lotePedido() {
    if (!el.overlay) build();
    await restore();
    var m = model();
    resolveBinds(m);
    var faltando = [];
    if (!m) faltando.push('carrossel modelo no canvas');
    else if (!m.binds.length) faltando.push('variáveis {} no modelo');
    if (imageBinds(m).length && !state.photos) faltando.push(state.pendingPhotos ? 'reabrir a pasta de fotos no app (um clique)' : 'pasta de fotos (passo 1)');
    if (!state.out) faltando.push(state.pendingOut ? 'reabrir a pasta de saída no app (um clique)' : 'pasta de saída (passo 3)');

    var modeloImgs = [];
    if (m) {
      for (var i = 0; i < Math.min(m.frames.length, 4); i++) {
        var c = await window.renderFrameToCanvas(m.frames[i], { scale: Math.min(1, 512 / Math.max(m.frames[i].w, m.frames[i].h)), format: 'jpeg' });
        modeloImgs.push(c.toDataURL('image/jpeg', 0.8));
      }
    }
    // Exemplos: até 3 carrosséis × 5 slides, pequenos (é referência de estilo)
    var refImgs = [];
    if (state.ref && !state.refSkipped) {
      var carr = state.ref.carousels.slice(0, 3);
      for (var ci = 0; ci < carr.length; ci++) {
        var slidesRef = [];
        for (var si = 0; si < Math.min(carr[ci].files.length, 5); si++) {
          var u = URL.createObjectURL(await fileOf(carr[ci].files[si]));
          slidesRef.push(await smallJpeg(u, 384));
          URL.revokeObjectURL(u);
        }
        refImgs.push({ nome: carr[ci].name, slides: slidesRef.filter(Boolean) });
      }
    }
    var fotoImgs = [];
    if (state.photos) {
      var files = state.photos.files.slice(0, 8);
      for (var j = 0; j < files.length; j++) {
        var url = URL.createObjectURL(await fileOf(files[j]));
        fotoImgs.push(await smallJpeg(url, 320));
        URL.revokeObjectURL(url);
      }
    }
    return {
      pedido: state.brief.pedido.trim() || null,
      quantidade: briefCount(),
      quantidade_origem: parseInt(state.brief.quantidade, 10) > 0 ? 'pedida' : (state.photos ? 'uma por foto' : 'padrão'),
      modelo: m ? { nome: m.nome, slides: m.frames.length, variaveis: m.binds.map(function (b) { return { nome: b.name, tipo: b.type === 'image' ? 'imagem' : 'texto' }; }) } : null,
      copys: copySlots(m).map(function (c) { return { chave: c.key, slide: c.slide, texto_do_modelo: c.exemplo, caracteres: c.exemplo.length }; }),
      variavel_de_texto: state.textBind,
      variaveis_de_texto: textBinds(m).map(function (b) { return b.name; }),
      fotos: state.photos ? { pasta: state.photos.name, total: state.photos.files.length, nomes: state.photos.files.map(nameOf) } : null,
      saida: state.out ? (state.out.zip ? '.zip baixado no navegador' : 'pasta ' + state.out.name) : null,
      textos_ja_escolhidos: state.texts && !state.texts.fromAi ? textCount() : 0,
      pronto: !faltando.length,
      faltando: faltando,
      resultado_desejado: state.ref && !state.refSkipped
        ? { pasta: state.ref.name, carrosseis: state.ref.carousels.map(function (c) { return { nome: c.name, slides: c.files.length }; }) }
        : null,
      imagens: { modelo: modeloImgs, fotos: fotoImgs.filter(Boolean), exemplos: refImgs },
    };
  }

  async function loteGerar(args) {
    var textos = (args && args.textos) || [];
    if (!textos.length) throw new Error('mande ao menos um texto em "textos"');
    if (!el.overlay) build();
    await restore();
    var m = model();
    if (!m) throw new Error('não há carrossel modelo no canvas');
    resolveBinds(m);
    if (!state.out) throw new Error(state.pendingOut ? 'a pasta de saída precisa ser reaberta no app (Criar em lote → Reabrir)' : 'escolha a pasta de saída no app (Criar em lote → passo 3)');
    if (imageBinds(m).length && !state.photos) throw new Error('escolha a pasta de fotos no app (Criar em lote → passo 1)');

    var texts = { name: 'copy da IA', fromAi: true, lines: [], columns: null };
    if (typeof textos[0] === 'object') {
      // Um objeto por carrossel com a copy de cada slide: { slide1_texto1: '...', ... }
      var chaves = copySlots(m).map(function (c) { return c.key; });
      var desconhecidas = [];
      textos.forEach(function (t) { Object.keys(t || {}).forEach(function (k) { if (chaves.indexOf(k) === -1 && desconhecidas.indexOf(k) === -1) desconhecidas.push(k); }); });
      if (desconhecidas.length) throw new Error('chaves que não existem no modelo: ' + desconhecidas.join(', ') + '. Use as chaves de "copys": ' + chaves.join(', '));
      texts.rows = textos.map(function (t) { return t || {}; });
      texts.lines = texts.rows.map(function (t) { return chaves.map(function (k) { return t[k] || ''; }).filter(Boolean).join(' · '); });
    } else {
      texts.lines = textos.map(function (t) { return String(t || '').trim(); }).filter(Boolean);
    }
    state.texts = texts;
    el.overlay.classList.add('is-open');
    render();
    var res = await generate();
    if (!res) throw new Error('nada para gerar');
    if (res.erro) throw new Error(res.erro);
    return res;
  }

  window.__tcmLote = { pedido: lotePedido, gerar: loteGerar };

  /* ------------------------------------------------------ abrir/fechar */
  async function open() {
    if (!el.overlay) build();
    el.overlay.classList.add('is-open');
    await restore();
    render();
  }

  function close() {
    if (!el.overlay) return;
    el.overlay.classList.remove('is-open');
    thumbUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    thumbUrls = [];
  }

  window.addEventListener('resize', function () {
    if (el.overlay && el.overlay.classList.contains('is-open')) drawWires();
  });

  window.openBatchWorkflow = open;
  window.closeBatchWorkflow = close;
})();
