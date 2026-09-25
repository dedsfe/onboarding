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
    qty: { n: '', ok: false }, // Variações: quantos carrosséis sair do lote
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
    // Fotos sempre: o lote não depende do canvas (sem modelo, o molde sai dos exemplos)
    if (!m || imageBinds(m).length) list.push('photos');
    list.push('ref');
    list.push('texts'); // sempre à vista: sem texto no modelo, o passo explica o que fazer
    list.push('qty');
    list.push('out');
    return list;
  }
  function isDone(step) {
    if (step === 'photos') return !!(state.photos && state.photos.files.length);
    if (step === 'ref') return !!(state.ref && state.ref.carousels.length) || state.refSkipped;
    if (step === 'texts') return !!(state.texts && textCount() > 0) || hasBrief() || (state.copySkipped && !copySlots(model()).length);
    if (step === 'qty') return !!state.qty.ok;
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

  function hasBrief() { return !state.texts && state.briefMode && !!state.brief.ok; }
  function waitingAi() { return hasBrief(); }

  // Sugestão antes de o usuário escolher: linhas do CSV, fotos ou 10
  function suggestedCount() {
    if (state.texts && !state.texts.fromAi && textCount()) return textCount();
    if (state.photos) return state.photos.files.length;
    return 10;
  }

  function variationsCount() {
    var n = parseInt(state.qty.n, 10);
    return n > 0 ? Math.min(n, 500) : suggestedCount();
  }

  function briefCount() { return variationsCount(); }
  function saveQty() { idbSet('qty', { n: state.qty.n, ok: !!state.qty.ok }); }

  function saveBrief() { idbSet('brief', { pedido: state.brief.pedido, quantidade: state.brief.quantidade, on: state.briefMode, ok: !!state.brief.ok }); }

  // A IA já mandou a copy: sai o que ela escreveu. Senão manda o passo Variações.
  function totalToMake(m) {
    if (state.texts && state.texts.fromAi) return textCount();
    return variationsCount();
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
    var slotKeys = copySlots(m).map(function (c) { return c.key; });
    var texts = { name: name, lines: [], columns: null };
    if (CSV_RE.test(name)) {
      var rows = parseCsv(text);
      var header = (rows[0] || []).map(slug);
      var slotHits = header.filter(function (c) { return slotKeys.indexOf(c) !== -1; });
      var hits = header.filter(function (c) { return tb.indexOf(c) !== -1; });
      if (slotHits.length) {
        // CSV modelo: uma linha por carrossel, uma coluna por texto do carrossel
        texts.rows = rows.slice(1).map(function (r) {
          var o = {};
          header.forEach(function (col, ci) { if (slotKeys.indexOf(col) !== -1 && r[ci]) o[col] = r[ci]; });
          return o;
        }).filter(function (o) { return Object.keys(o).length; });
        texts.lines = texts.rows.map(function (o) { return slotKeys.map(function (k) { return o[k] || ''; }).filter(Boolean).join(' · '); });
      } else if (hits.length) {
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

  function csvCell(v) {
    v = String(v == null ? '' : v);
    return /[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  // Cabeçalho = campos de copy; primeira linha = o texto que o modelo tem hoje
  function downloadCsvTemplate() {
    var m = model();
    var slots = copySlots(m);
    if (!slots.length) { toast('info', 'O modelo não tem textos.'); return; }
    var csv = '\uFEFF' + slots.map(function (c) { return csvCell(c.key); }).join(',') + '\n'
      + slots.map(function (c) { return csvCell(c.exemplo); }).join(',') + '\n';
    var a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: fileSlug(m.nome) + '-copy.csv' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
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
    if (br) { state.brief = { pedido: br.pedido || '', quantidade: br.quantidade || '', ok: !!br.ok }; state.briefMode = !!br.on; }
    if (!canWriteDisk) return;
    var p = await idbGet('photos');
    if (p && p.queryPermission && !state.photos) {
      if ((await p.queryPermission({ mode: 'read' })) === 'granted') {
        try { var files = await photosFromDir(p); if (files.length) state.photos = { name: p.name, files: files, dir: p }; } catch (e) {}
      } else state.pendingPhotos = p;
    }
    var q = await idbGet('qty');
    if (q) state.qty = { n: q.n || '', ok: !!q.ok };
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
    qty: { n: 'Variações', title: '', sub: '' },
    texts: { n: 'Copy', title: 'Agora a copy: a IA decide ou você manda um CSV', sub: 'A IA pesquisa o nicho e escreve o texto de todos os slides de cada carrossel.' },
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

  /* ------------------------------------------------ conectar a IA (MCP)
     Antes do fluxo: um comando pra copiar e o status ao vivo da ponte.
     A bolinha fica verde sozinha quando o servidor MCP sobe. */
  var CONNECT = {
    code: { nome: 'Claude Code', cmd: 'claude mcp add carousel-maker -- node "$(pwd)/mcp/server.js"', depois: 'Abra o Claude Code' },
    desktop: { nome: 'Claude Desktop', cmd: 'npm run mcp:desktop', depois: 'Reabra o Claude Desktop' },
    cursor: { nome: 'Cursor', cmd: 'npm run mcp:cursor', depois: 'Reabra o Cursor' },
  };

  function bridgeOk() {
    try { return !!(window.__tcmPonteStatus && window.__tcmPonteStatus().conectada); } catch (e) { return false; }
  }

  function connectSkipped() {
    try { return sessionStorage.getItem('tcm-lote-sem-ia') === '1'; } catch (e) { return !!state.skipAi; }
  }

  function skipConnect() {
    state.skipAi = true;
    try { sessionStorage.setItem('tcm-lote-sem-ia', '1'); } catch (e) {}
    state.showConnect = false;
    render();
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      btn.classList.add('is-copied');
      btn.innerHTML = icon('check');
      paintIcons();
      setTimeout(function () { btn.classList.remove('is-copied'); btn.innerHTML = icon('copy'); paintIcons(); }, 1400);
    } catch (e) { toast('error', 'Não consegui copiar.'); }
  }

  function renderConnect() {
    state.onConnect = true;
    var ok = bridgeOk();
    var tab = state.connectTab || 'code';
    var cfg = CONNECT[tab];
    el.shell.innerHTML = '';
    el.shell.appendChild(h('header', { class: 'bw-head' }, [
      h('span', { class: 'bw-head__name', text: 'Criar em lote' }),
      h('span'),
      h('div', { class: 'bw-head__actions' }, [
        h('button', { class: 'bw-icon-btn', title: 'Fechar (Esc)', html: icon('x'), onclick: close }),
      ]),
    ]));

    var tabs = h('div', { class: 'bw-tabs' });
    Object.keys(CONNECT).forEach(function (k) {
      tabs.appendChild(h('button', { class: 'bw-tab' + (k === tab ? ' is-on' : ''), text: CONNECT[k].nome, onclick: function () { state.connectTab = k; renderConnect(); } }));
    });

    var copyBtn = h('button', { class: 'bw-cmd__copy', title: 'Copiar', html: icon('copy') });
    copyBtn.addEventListener('click', function () { copyText(cfg.cmd, copyBtn); });

    var steps = h('div', { class: 'bw-cx-steps' }, [
      h('div', { class: 'bw-cx-step' }, [
        h('span', { class: 'bw-cx-step__n', text: '1' }),
        h('span', { class: 'bw-cx-step__icon', html: icon('terminal') }),
        h('span', { class: 'bw-chip-dir', html: icon('folder') + '<span>pasta do app</span>' }),
        h('div', { class: 'bw-cmd' }, [h('code', { text: cfg.cmd }), copyBtn]),
      ]),
      h('span', { class: 'bw-cx-arrow', html: icon('arrow-right') }),
      h('div', { class: 'bw-cx-step' }, [
        h('span', { class: 'bw-cx-step__n', text: '2' }),
        h('span', { class: 'bw-cx-step__icon', html: icon('rotate-cw') }),
        h('span', { class: 'bw-cx-step__label', text: cfg.depois }),
      ]),
      h('span', { class: 'bw-cx-arrow', html: icon('arrow-right') }),
      h('div', { class: 'bw-cx-step' + (ok ? ' is-ok' : ' is-wait') }, [
        h('span', { class: 'bw-cx-step__n', text: '3' }),
        h('span', { class: 'bw-cx-dot' }, [h('span', { class: 'bw-cx-dot__core', html: ok ? icon('check') : '' })]),
        h('span', { class: 'bw-cx-step__label', text: ok ? 'Conectado' : 'Aguardando' }),
      ]),
    ]);

    var body = h('div', { class: 'bw-connect' }, [
      h('div', { class: 'bw-connect__hero' + (ok ? ' is-ok' : '') , html: icon(ok ? 'plug-zap' : 'plug') }),
      h('h3', { class: 'bw-connect__title', text: ok ? 'IA conectada' : 'Conecte sua IA' }),
      tabs,
      steps,
      ok
        ? h('button', { class: 'bw-btn bw-btn--primary', html: icon('arrow-right') + '<span>Continuar</span>', onclick: function () { state.showConnect = false; render(); } })
        : h('button', { class: 'bw-link', text: 'Sem IA', onclick: skipConnect }),
    ]);
    el.shell.appendChild(body);
    paintIcons();
  }

  function render() {
    if (state.showConnect || (!bridgeOk() && !connectSkipped())) { renderConnect(); return; }
    state.onConnect = false;
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
        h('button', {
          class: 'bw-ai-pill' + (bridgeOk() ? ' is-ok' : ''),
          title: bridgeOk() ? 'IA conectada pelo MCP' : 'Conectar IA',
          html: '<span class="bw-ai-pill__dot"></span>' + icon('bot'),
          onclick: function () { state.showConnect = true; render(); },
        }),
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
    var nq = qtyNode(m, cur);
    var no = outNode(m, cur, total);
    if (inNodes.length) flow.appendChild(inputsCol);
    flow.appendChild(nm);
    flow.appendChild(nq);
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
      h('div', { class: 'bw-foot__status' }),
      el.progress,
      el.go,
    ]));

    paintIcons();
    el.stage = stage; el.wires = wires;
    el.links = inNodes.map(function (n) { return [n, nm]; }).concat([[nm, nq], [nq, no]]);
    requestAnimationFrame(function () {
      drawWires();
      // Passo da vez sempre à vista (a coluna de entradas pode passar da altura)
      var active = stage.querySelector('.bw-node.is-active');
      if (active) {
        var sb = stage.getBoundingClientRect(), ab = active.getBoundingClientRect();
        if (ab.bottom > sb.bottom || ab.top < sb.top) stage.scrollTop += ab.top - sb.top - (sb.height - ab.height) / 2;
      }
    });
  }

  // Silhueta do que vai entrar ali: ícone apagado numa área tracejada
  function ghost(ic, extra) {
    return h('div', { class: 'bw-ghost' + (extra ? ' ' + extra : ''), html: icon(ic) });
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
        body.push(h('div', { class: 'bw-dropzone' }, [
          h('span', { class: 'bw-dropzone__icon', html: icon('images') }),
          h('button', { class: 'bw-btn bw-btn--primary bw-cta', html: icon('folder-search') + '<span>Escolher pasta</span>', onclick: pickPhotos }),
        ]));
      }
    } else {
      body.push(ghost('images'));
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
    var semTexto = !!m && !copySlots(m).length;
    if (semTexto && st === 'done') {
      body.push(h('span', { class: 'bw-pill bw-pill--muted', html: icon('image') + '<span>Só fotos</span>' }));
    } else if (semTexto && st === 'active') {
      body.push(ghost('type', 'is-warn'));
      body.push(h('button', { class: 'bw-btn bw-btn--primary bw-cta', html: icon('pencil') + '<span>Adicionar textos</span>', title: 'Fecha e volta pro canvas (T cria texto)', onclick: close }));
      body.push(h('button', { class: 'bw-link', text: 'Só fotos', onclick: function () { state.copySkipped = true; render(); } }));
    } else if (st === 'done' && waitingAi()) {
      body.push(h('div', { class: 'bw-brief-sum' }, [
        h('span', { class: 'bw-brief-sum__tag', html: icon('sparkles') + '<span>A IA decide</span>' }),
        state.brief.pedido.trim() ? h('p', { class: 'bw-brief-sum__text', text: state.brief.pedido.trim() }) : null,
      ]));
      body.push(h('div', { class: 'bw-row' }, [
        h('span', { class: 'bw-meta', text: m ? plural(copySlots(m).length, 'texto', 'textos') + ' por carrossel' : '' }),
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
      body.push(h('button', { class: 'bw-choice', onclick: function () { state.briefMode = true; state.brief.ok = false; saveBrief(); render(); } }, [
        h('span', { class: 'bw-choice__icon', html: icon('sparkles') }),
        h('span', { class: 'bw-choice__txt' }, [h('strong', { text: 'A IA decide' })]),
      ]));
      body.push(h('button', { class: 'bw-choice', onclick: pickTexts }, [
        h('span', { class: 'bw-choice__icon', html: icon('sheet') }),
        h('span', { class: 'bw-choice__txt' }, [h('strong', { text: 'CSV' })]),
      ]));
      body.push(h('button', { class: 'bw-link', html: icon('download') + '<span>CSV modelo</span>', onclick: downloadCsvTemplate }));
    } else {
      body.push(ghost('type'));
    }
    var action = null;
    if (st === 'done') {
      action = swapBtn(function () {
        state.texts = null; state.briefMode = false; state.brief.ok = false; state.copySkipped = false;
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
      class: 'bw-textarea', rows: '3',
      placeholder: 'Direção (opcional)',
    });
    ta.value = state.brief.pedido;
    var ok = h('button', { class: 'bw-btn bw-btn--primary bw-cta', html: icon('check') + '<span>Pronto</span>' });
    ta.addEventListener('input', function () { state.brief.pedido = ta.value; saveBrief(); });
    ok.addEventListener('click', function () { state.brief.ok = true; saveBrief(); render(); });
    setTimeout(function () { ta.focus(); }, 30);
    return h('div', { class: 'bw-brief' }, [
      ta,
      ok,
      h('button', { class: 'bw-link', html: icon('sheet') + '<span>CSV</span>', onclick: function () { state.briefMode = false; saveBrief(); pickTexts(); } }),
    ]);
  }

  function qtyNode(m, cur) {
    var st = stateOf('qty', cur);
    var body = [];
    var n = variationsCount();
    if (st === 'active') {
      var num = h('input', { class: 'bw-qty-big', type: 'number', min: '1', max: '500', value: String(n) });
      var set = function (v) {
        v = Math.max(1, Math.min(500, parseInt(v, 10) || 1));
        state.qty.n = String(v); num.value = String(v); saveQty();
        chips.querySelectorAll('.bw-chip-n').forEach(function (c) { c.classList.toggle('is-on', Number(c.dataset.n) === v); });
      };
      num.addEventListener('input', function () { if (num.value) set(num.value); });
      var chips = h('div', { class: 'bw-chips-n' });
      [10, 25, 50, 100].forEach(function (v) {
        chips.appendChild(h('button', { class: 'bw-chip-n' + (v === n ? ' is-on' : ''), 'data-n': String(v), text: String(v), onclick: function () { set(v); } }));
      });
      body.push(h('div', { class: 'bw-stepper' }, [
        h('button', { class: 'bw-stepper__btn', html: icon('minus'), onclick: function () { set((parseInt(num.value, 10) || 1) - 1); } }),
        num,
        h('button', { class: 'bw-stepper__btn', html: icon('plus'), onclick: function () { set((parseInt(num.value, 10) || 0) + 1); } }),
      ]));
      body.push(chips);
      body.push(h('button', { class: 'bw-btn bw-btn--primary bw-cta', html: icon('check') + '<span>OK</span>', onclick: function () { set(num.value); state.qty.ok = true; saveQty(); render(); } }));
    } else if (st === 'done') {
      body.push(h('div', { class: 'bw-big', html: '<strong>×' + n + '</strong>' }));
    } else {
      body.push(ghost('copy'));
    }
    return node('qty', {
      icon: 'layers', title: 'Variações', sub: st === 'done' ? null : 'Passo ' + (steps(m).indexOf('qty') + 1),
      state: st, body: body,
      action: st === 'done' ? swapBtn(function () { state.qty.ok = false; saveQty(); render(); }) : null,
    });
  }

  function refNode(m, cur) {
    var st = stateOf('ref', cur);
    var body = [];
    if (st === 'done' && state.refSkipped) {
      body.push(h('span', { class: 'bw-pill bw-pill--muted', html: icon('skip-forward') + '<span>Pulado</span>' }));
    } else if (st === 'done') {
      state.ref.carousels.slice(0, 1).forEach(function (c) {
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
        body.push(h('div', { class: 'bw-dropzone' }, [
          h('span', { class: 'bw-dropzone__icon', html: icon('gallery-horizontal-end') }),
          h('div', { class: 'bw-pair' }, [
            h('button', { class: 'bw-btn bw-btn--primary', html: icon('folder-search') + '<span>Pasta</span>', title: 'Uma subpasta por carrossel', onclick: pickRef }),
            h('button', { class: 'bw-btn', html: icon('images') + '<span>Fotos</span>', title: 'Fotos em sequência = um carrossel', onclick: pickRefPhotos }),
          ]),
        ]));
      }
      body.push(h('button', { class: 'bw-link', html: icon('skip-forward') + '<span>Pular</span>', onclick: function () { state.refSkipped = true; render(); } }));
    } else {
      body.push(ghost('gallery-horizontal-end'));
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
      body.push(h('div', { class: 'bw-slides bw-slides--ghost' }, [ghost('sparkles', 'is-slide'), ghost('sparkles', 'is-slide')]));
    } else {
      var slides = h('div', { class: 'bw-slides' });
      m.frames.slice(0, 3).forEach(function (f) { slides.appendChild(slideThumb(f)); });
      body.push(slides);
      var chips = h('div', { class: 'bw-binds' });
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
      icon: 'palette', title: 'Molde',
      sub: m ? m.nome + ' · ' + plural(m.frames.length, 'slide', 'slides') : 'nenhum post no canvas',
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
      body.push(ghost('package'));
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
        h('div', { class: 'bw-ai__head', html: icon('bot') + '<span>Claude</span>' }),
        h('pre', { class: 'bw-ai__prompt', text: aiPrompt(m) }),
        btn,
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
      side.appendChild(h('div', { class: 'bw-side__empty', html: icon('images') }));
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

  /* Resolve a foto de um carrossel: pedido da IA (índice 1-based ou nome)
     ou a próxima da pasta. */
  function photoItem(i, pick) {
    var files = state.photos ? state.photos.files : [];
    if (!files.length) return null;
    if (pick != null && pick !== '') {
      var n = Number(pick);
      if (Number.isInteger(n) && n >= 1 && n <= files.length) return files[n - 1];
      var byName = files.find(function (f) { return nameOf(f) === String(pick); });
      if (byName) return byName;
    }
    return files[i % files.length];
  }

  async function photoData(item, cache) {
    var key = nameOf(item);
    if (!cache.has(key)) cache.set(key, await readAsDataUrl(await fileOf(item)));
    return cache.get(key);
  }

  /* A copy de um carrossel vira overrides do export. Linhas de uma IA/CSV
     trazem chaves de copy + extras: _foto, _fotos, _estilo, _legenda. */
  async function buildOverrides(m, i, row, cache) {
    var overrides = {};
    var hook = '', legenda = '';
    if (row) {
      Object.keys(row).forEach(function (k) {
        if (k.charAt(0) === '_' || !row[k]) return;
        overrides[overrideKeyOf(m, k)] = String(row[k]);
      });
      var first = copySlots(m)[0];
      hook = first ? (row[first.key] || '') : '';
      legenda = row._legenda ? String(row._legenda) : '';
      if (row._estilo && typeof row._estilo === 'object') {
        Object.keys(row._estilo).forEach(function (k) {
          var slot = copySlots(m).find(function (c) { return c.key === k; });
          if (slot) overrides['#' + slot.childId + ':estilo'] = row._estilo[k];
        });
      }
    } else {
      textBinds(m).forEach(function (b) { var v = textFor(i, b.name); if (v) overrides[b.name] = v; });
      var slots = copySlots(m);
      if (!textBinds(m).length && slots.length && state.texts && state.texts.lines.length) {
        overrides['#' + slots[0].childId] = state.texts.lines[i % state.texts.lines.length];
      }
      hook = state.textBind ? textFor(i, state.textBind) : (state.texts && state.texts.lines ? state.texts.lines[i % state.texts.lines.length] : '');
    }
    if (state.photos) {
      // Variável de foto principal + outras que a IA mapear (_fotos: { foto2: 3 })
      var extra = (row && row._fotos && typeof row._fotos === 'object') ? row._fotos : {};
      if (state.photoBind) overrides[state.photoBind] = await photoData(photoItem(i, row && row._foto), cache);
      var keys = Object.keys(extra);
      for (var k = 0; k < keys.length; k++) {
        if (imageBinds(m).some(function (b) { return b.name === keys[k]; })) {
          overrides[keys[k]] = await photoData(photoItem(i, extra[keys[k]]), cache);
        }
      }
    }
    return { overrides: overrides, hook: hook, legenda: legenda };
  }

  function rowFor(i) {
    var t = state.texts;
    return t && t.rows && t.rows.length ? t.rows[i % t.rows.length] : null;
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
    var resumo = [['pasta'].concat(copySlots(m).map(function (c) { return c.key; }), ['legenda'])];

    try {
      for (var i = 0; i < total; i++) {
        label.textContent = 'Gerando ' + (i + 1) + ' de ' + total + '…';
        fill.style.width = Math.round((i / total) * 100) + '%';

        var row = rowFor(i);
        var built = await buildOverrides(m, i, row, imageCache);
        var folder = String(i + 1).padStart(2, '0') + (built.hook ? '-' + fileSlug(built.hook) : '');
        var dest = zip ? null : await state.out.dir.getDirectoryHandle(folder, { create: true });
        for (var s = 0; s < m.frames.length; s++) {
          var blobs = await window.exportFrameToBlobs(m.frames[s], { scale: 2, format: 'png', overrides: built.overrides });
          for (var b = 0; b < blobs.length; b++) {
            var file = 'slide-' + (s + 1) + (blobs.length > 1 ? '-' + (b + 1) : '') + '.png';
            if (zip) zip.file(folder + '/' + file, blobs[b]);
            else await writeFile(dest, file, blobs[b]);
          }
        }
        // Legenda pronta pra colar no post
        if (built.legenda) {
          if (zip) zip.file(folder + '/legenda.txt', built.legenda);
          else await writeFile(dest, 'legenda.txt', built.legenda);
        }
        resumo.push([folder].concat(copySlots(m).map(function (c) { return row ? (row[c.key] || '') : ''; }), [built.legenda]));
        await new Promise(function (r) { setTimeout(r, 0); });
      }
      // Planilha com toda a copy do lote, pra revisar ou reaproveitar
      var csv = '﻿' + resumo.map(function (r) { return r.map(csvCell).join(','); }).join('\n') + '\n';
      if (zip) zip.file('copys.csv', csv);
      else await writeFile(state.out.dir, 'copys.csv', csv);

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
     mcp-bridge.js chama isto. Fluxo da IA: ver_pedido → (ver_fotos,
     ver_exemplo, pesquisa) → previsualizar → ajustar → gerar. */
  function smallJpeg(source, maxSide) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = function () { resolve(null); };
      img.src = source;
    });
  }

  async function fileJpeg(item, maxSide) {
    var u = URL.createObjectURL(await fileOf(item));
    try { return await smallJpeg(u, maxSide); } finally { URL.revokeObjectURL(u); }
  }

  async function frameJpeg(frame, maxSide, overrides) {
    var c = await window.renderFrameToCanvas(frame, { scale: Math.min(1, maxSide / Math.max(frame.w, frame.h)), format: 'jpeg', overrides: overrides || {} });
    return c.toDataURL('image/jpeg', 0.82);
  }

  async function ready() {
    if (!el.overlay) build();
    await restore();
    var m = model();
    resolveBinds(m);
    return m;
  }

  async function lotePedido() {
    var m = await ready();
    var faltando = [];
    if (!m) faltando.push('molde: não há post no canvas — crie um com criar_molde (a partir dos exemplos) ou peça pro usuário desenhar');
    if (!state.photos && (!m || imageBinds(m).length)) faltando.push(state.pendingPhotos ? 'reabrir a pasta de fotos no app (um clique)' : 'pasta de fotos (passo Fotos)');
    if (!state.out) faltando.push(state.pendingOut ? 'reabrir a pasta de saída no app (um clique)' : 'pasta de saída (passo Saída)');

    var modeloImgs = [];
    if (m) for (var i = 0; i < Math.min(m.frames.length, 6); i++) modeloImgs.push(await frameJpeg(m.frames[i], 512));

    // Exemplos grandes o bastante pra ler a copy dos melhores posts
    var refImgs = [];
    if (state.ref && !state.refSkipped) {
      var carr = state.ref.carousels.slice(0, 3);
      for (var ci = 0; ci < carr.length; ci++) {
        var slidesRef = [];
        for (var si = 0; si < Math.min(carr[ci].files.length, 6); si++) slidesRef.push(await fileJpeg(carr[ci].files[si], 640));
        refImgs.push({ nome: carr[ci].name, slides: slidesRef.filter(Boolean) });
      }
    }
    var fotoImgs = [];
    if (state.photos) {
      var files = state.photos.files.slice(0, 8);
      for (var j = 0; j < files.length; j++) fotoImgs.push(await fileJpeg(files[j], 320));
    }
    return {
      modo: state.texts && !state.texts.fromAi ? 'textos_prontos' : 'ia_decide',
      pedido: state.brief.pedido.trim() || null,
      quantidade: totalToMake(m) || variationsCount(),
      molde: m ? { nome: m.nome, slides: m.frames.length, variaveis: m.binds.map(function (b) { return { nome: b.name, tipo: b.type === 'image' ? 'imagem' : 'texto' }; }) } : null,
      copys: copySlots(m).map(function (c) { return { chave: c.key, slide: c.slide, texto_do_modelo: c.exemplo, caracteres: c.exemplo.length }; }),
      variavel_de_foto: state.photoBind,
      variaveis_de_foto: imageBinds(m).map(function (b) { return b.name; }),
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

  function checkRows(m, textos) {
    var chaves = copySlots(m).map(function (c) { return c.key; });
    var desconhecidas = [];
    textos.forEach(function (t) {
      Object.keys(t || {}).forEach(function (k) {
        if (k.charAt(0) !== '_' && chaves.indexOf(k) === -1 && desconhecidas.indexOf(k) === -1) desconhecidas.push(k);
      });
    });
    if (desconhecidas.length) throw new Error('chaves que não existem no molde: ' + desconhecidas.join(', ') + '. Use as chaves de "copys": ' + chaves.join(', '));
    return chaves;
  }

  // Prévia: renderiza até 3 carrosséis com a copy proposta e mede se cabe
  async function lotePrevia(args) {
    var textos = (args && args.textos) || [];
    if (!textos.length) throw new Error('mande ao menos um carrossel em "textos"');
    var m = await ready();
    if (!m) throw new Error('não há molde: crie com criar_molde ou peça pro usuário desenhar no canvas');
    checkRows(m, textos);
    var slots = copySlots(m);
    var cache = new Map();
    var out = [];
    for (var i = 0; i < Math.min(textos.length, 3); i++) {
      var built = await buildOverrides(m, i, textos[i], cache);
      var imgs = [], problemas = [];
      for (var s = 0; s < m.frames.length; s++) {
        imgs.push(await frameJpeg(m.frames[s], 540, built.overrides));
        window.__tcmBatch.medirCopy(m.frames[s].id, built.overrides).forEach(function (med) {
          var slot = slots.find(function (c) { return c.childId === med.id; });
          if (!slot) return;
          if (med.estoura_embaixo) problemas.push(slot.key + ': passa do fim do slide (' + med.linhas + ' linhas)');
          if (med.palavra_maior_que_caixa) problemas.push(slot.key + ': uma palavra não cabe na largura da caixa');
        });
      }
      out.push({ indice: i + 1, slides: imgs, problemas: problemas });
    }
    return { carrosseis: out };
  }

  async function loteFotos(args) {
    await ready();
    if (!state.photos) throw new Error('nenhuma pasta de fotos escolhida no app');
    var porPagina = 12;
    var pagina = Math.max(1, Number(args && args.pagina) || 1);
    var files = state.photos.files.slice((pagina - 1) * porPagina, pagina * porPagina);
    var fotos = [];
    for (var i = 0; i < files.length; i++) {
      fotos.push({ indice: (pagina - 1) * porPagina + i + 1, nome: nameOf(files[i]), img: await fileJpeg(files[i], 384) });
    }
    return { pagina: pagina, paginas: Math.ceil(state.photos.files.length / porPagina), total: state.photos.files.length, fotos: fotos };
  }

  async function loteExemplo(args) {
    await ready();
    if (!state.ref || state.refSkipped) throw new Error('nenhum resultado desejado escolhido no app');
    var c = state.ref.carousels[(Number(args && args.carrossel) || 1) - 1];
    if (!c) throw new Error('carrossel de exemplo inexistente (há ' + state.ref.carousels.length + ')');
    var f = c.files[(Number(args && args.slide) || 1) - 1];
    if (!f) throw new Error('slide inexistente (o exemplo tem ' + c.files.length + ')');
    return { carrossel: c.name, slide: Number(args && args.slide) || 1, de: c.files.length, img: await fileJpeg(f, 1080) };
  }

  async function loteCriarMolde(spec) {
    var res = window.__tcmBatch.criarMolde(spec || {});
    if (el.overlay) render();
    return res;
  }

  async function loteGerar(args) {
    var textos = (args && args.textos) || [];
    if (!textos.length) throw new Error('mande ao menos um carrossel em "textos"');
    var m = await ready();
    if (!m) throw new Error('não há molde: crie com criar_molde ou peça pro usuário desenhar no canvas');
    if (!state.out) throw new Error(state.pendingOut ? 'a pasta de saída precisa ser reaberta no app (Criar em lote → Reabrir)' : 'escolha a pasta de saída no app (Criar em lote → Saída)');
    if (imageBinds(m).length && !state.photos) throw new Error('escolha a pasta de fotos no app (Criar em lote → Fotos)');

    var texts = { name: 'copy da IA', fromAi: true, lines: [], columns: null };
    if (typeof textos[0] === 'object') {
      var chaves = checkRows(m, textos);
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

  window.__tcmLote = {
    pedido: lotePedido, gerar: loteGerar, previa: lotePrevia,
    fotos: loteFotos, exemplo: loteExemplo, criarMolde: loteCriarMolde,
  };

  /* ------------------------------------------------------ abrir/fechar */
  async function open() {
    if (!el.overlay) build();
    el.overlay.classList.add('is-open');
    await restore();
    render();
    // Ponte cai/volta: a tela reage sozinha (bolinha verde e segue pro fluxo)
    state.lastOk = bridgeOk();
    clearInterval(state.poll);
    state.poll = setInterval(function () {
      var ok = bridgeOk();
      if (ok === state.lastOk || state.running) return;
      state.lastOk = ok;
      // Acabou de conectar na tela de conexão: mostra o verde e segue sozinho
      if (ok && state.onConnect && !state.showConnect) {
        state.showConnect = true;
        render();
        setTimeout(function () { if (state.showConnect) { state.showConnect = false; render(); } }, 1400);
        return;
      }
      render();
    }, 1200);
  }

  function close() {
    if (!el.overlay) return;
    clearInterval(state.poll);
    state.showConnect = false;
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
