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
    if (textBinds(m).length) list.push('texts');
    list.push('out');
    return list;
  }
  function isDone(step) {
    if (step === 'photos') return !!(state.photos && state.photos.files.length);
    if (step === 'texts') return !!(state.texts && textCount() > 0);
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
    if (state.texts.columns) {
      var max = 0;
      Object.keys(state.texts.columns).forEach(function (k) { max = Math.max(max, state.texts.columns[k].length); });
      return max;
    }
    return state.texts.lines.length;
  }

  function totalToMake(m) {
    if (textBinds(m).length && state.texts) return textCount();
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

  function aiPrompt(m) {
    var tb = textBinds(m).map(function (b) { return '{{' + b.name + '}}'; }).join(', ');
    var n = state.photos ? state.photos.files.length : 20;
    return [
      'Estou criando carrosséis em lote no The Carousel Maker (servidor MCP "carousel-maker").',
      'O carrossel modelo "' + (m ? m.nome : 'Post') + '" tem ' + (m ? plural(m.frames.length, 'slide', 'slides') : '') + ' e o texto que muda é ' + (tb || '{{hooks}}') + '.',
      'Use status_ponte para ver o modelo aberto no app e escreva ' + n + ' textos curtos, um por linha, no mesmo estilo.',
      'Tema: [descreva aqui o assunto e o público].',
      'Salve tudo num arquivo hooks.txt (um texto por linha, sem numeração) para eu escolher no passo 2.',
    ].join('\n');
  }

  async function copyPrompt(m, btn) {
    try {
      await navigator.clipboard.writeText(aiPrompt(m));
      btn.querySelector('span').textContent = 'Copiado!';
      setTimeout(function () { btn.querySelector('span').textContent = 'Copiar pedido'; }, 1600);
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

  async function restore() {
    if (!canWriteDisk) return;
    var p = await idbGet('photos');
    if (p && p.queryPermission && !state.photos) {
      if ((await p.queryPermission({ mode: 'read' })) === 'granted') {
        try { var files = await photosFromDir(p); if (files.length) state.photos = { name: p.name, files: files, dir: p }; } catch (e) {}
      } else state.pendingPhotos = p;
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
    texts: { n: 'Textos', title: 'Agora escolha o arquivo com os textos', sub: 'Um .txt com um texto por linha. Cada linha vira um carrossel.' },
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
      guide.appendChild(guideText('Tudo pronto: ' + plural(total, 'carrossel', 'carrosséis') + ' pra gerar', 'Confira à direita e clique em Gerar.', 0, 0, true));
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
    el.go.disabled = !m || !m.binds.length || cur !== 'ready' || !total;
    el.shell.appendChild(h('footer', { class: 'bw-foot' }, [
      h('div', { class: 'bw-foot__status', text: cur === 'ready' ? '' : 'Complete os passos para gerar.' }),
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
    if (st === 'done') {
      var list = h('ol', { class: 'bw-mini-lines' });
      state.texts.lines.slice(0, 3).forEach(function (l) { list.appendChild(h('li', { text: l })); });
      body.push(list);
      body.push(h('div', { class: 'bw-row' }, [
        h('span', { class: 'bw-meta', html: icon('file-text') + '<span>' + escapeHtml(state.texts.name) + ' · ' + plural(textCount(), 'linha', 'linhas') + '</span>' }),
        state.texts.columns ? h('span', { class: 'bw-pill', text: Object.keys(state.texts.columns).map(function (k) { return '{{' + k + '}}'; }).join(' ') })
          : bindSelect(textBinds(m), state.textBind, function (v) { state.textBind = v; }),
      ]));
    } else if (st === 'active') {
      body.push(h('button', { class: 'bw-btn bw-btn--primary bw-cta', html: icon('file-search') + '<span>Escolher textos</span>', onclick: pickTexts }));
      body.push(h('span', { class: 'bw-hint', text: '.txt (um por linha) ou .csv' }));
    } else {
      body.push(h('span', { class: 'bw-hint', text: 'Um .txt com um texto por linha' }));
    }
    return node('texts', {
      icon: 'type', title: 'Textos', sub: st === 'done' ? null : 'Passo ' + (steps(m).indexOf('texts') + 1),
      state: st, body: body,
      action: st === 'done' ? swapBtn(pickTexts) : null,
      onDrop: dropTexts,
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
    }
    return node('model', {
      icon: 'palette', title: 'Resultado desejado',
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
          html: icon(canWriteDisk ? 'folder-output' : 'file-archive') + '<span>' + (canWriteDisk ? 'Escolher pasta de saída' : 'Baixar como .zip') + '</span>',
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
    if (m && textBinds(m).length && (cur === 'texts' || !state.texts)) {
      var btn = h('button', { class: 'bw-btn bw-copy', html: icon('copy') + '<span>Copiar pedido</span>' });
      btn.addEventListener('click', function () { copyPrompt(m, btn); });
      side.appendChild(h('div', { class: 'bw-ai' }, [
        h('div', { class: 'bw-ai__head', html: icon('bot') + '<span>Não tem os textos? Peça pra uma IA</span>' }),
        h('p', { class: 'bw-ai__text', text: 'Copie o pedido e cole no Claude (com o MCP carousel-maker ligado). Ele olha o seu modelo, escreve os textos no mesmo estilo e salva um hooks.txt pra você escolher aqui.' }),
        h('pre', { class: 'bw-ai__prompt', text: aiPrompt(m) }),
        btn,
      ]));
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
    var img = h('img', { class: 'bw-thumb', alt: nameOf(item), loading: 'lazy', draggable: 'false' });
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
    if (!m || state.running) return;
    var total = totalToMake(m);
    if (!total) return;

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
        textBinds(m).forEach(function (b) { var v = textFor(i, b.name); if (v) overrides[b.name] = v; });
        if (state.photos && state.photoBind) {
          var item = state.photos.files[i % state.photos.files.length];
          var key = nameOf(item);
          if (!imageCache.has(key)) imageCache.set(key, await readAsDataUrl(await fileOf(item)));
          overrides[state.photoBind] = imageCache.get(key);
        }

        var hook = state.textBind ? textFor(i, state.textBind) : (state.texts ? state.texts.lines[i] : '');
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
      } else {
        toast('success', plural(total, 'carrossel pronto', 'carrosséis prontos') + ' em ' + state.out.name);
      }
    } catch (e) {
      console.error('[lote] falha ao gerar', e);
      toast('error', 'O lote parou no meio: ' + (e && e.message ? e.message : 'erro desconhecido'));
    } finally {
      state.running = false;
      el.overlay.classList.remove('is-running');
      render();
    }
  }

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
