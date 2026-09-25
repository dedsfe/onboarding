/**
 * The Carousel Maker — MCP Bridge (lado navegador)
 *
 * Conecta o app aberto no navegador ao servidor MCP (mcp/server.js) via
 * WebSocket em ws://localhost:8765. O servidor envia comandos {id, cmd, args};
 * a ponte executa nas APIs __tcmCanvas / __tcmBatch do app.js e responde
 * {id, ok, data | erro}.
 *
 * Reconexão automática: o servidor pode subir depois da página (ou cair e
 * voltar) — a ponte tenta de novo a cada 2s sem recarregar nada.
 */
(function () {
  'use strict';

  // ?ponte=<porta> aponta para outro servidor (teste E2E em paralelo)
  var portaPonte = (location.search.match(/[?&]ponte=(\d+)/) || [])[1] || '8765';
  var URL_PONTE = 'ws://localhost:' + portaPonte;
  var TIMEOUT_EXPORT_MS = 10 * 60 * 1000; // lote grande em scale 2 demora

  var ws = null;
  var reconectando = false;

  function log() {
    try { console.info.apply(console, ['[tcm-ponte]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  function conectar() {
    try { ws = new WebSocket(URL_PONTE); } catch (e) { reagendar(); return; }

    ws.onopen = function () {
      log('conectada em', URL_PONTE);
      // estado assim que conecta: o servidor já pode decidir o que fazer
      enviar({ tipo: 'hello', app: 'the-carousel-maker' });
    };

    ws.onclose = function () { ws = null; reagendar(); };
    ws.onerror = function () { /* onclose vem logo atrás */ };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg && msg.cmd) executar(msg);
    };
  }

  function reagendar() {
    if (reconectando) return;
    reconectando = true;
    setTimeout(function () { reconectando = false; conectar(); }, 2000);
  }

  function enviar(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(obj)); } catch (e) { log('falha ao enviar', e); }
    }
  }

  /* ---------------------- comandos ---------------------- */

  function prontos() {
    return {
      canvas: typeof window.__tcmCanvas === 'object',
      batch: typeof window.__tcmBatch === 'object',
      template: typeof window.__tcmApplyTemplate === 'function'
    };
  }

  var COMANDOS = {
    status: function () {
      var apis = prontos();
      var dados = { conectado: true, apis: apis };
      if (apis.canvas) dados.canvas = window.__tcmCanvas.info();
      if (!apis.canvas || !apis.batch) dados.erro = 'aguardando app inicializar';
      return dados;
    },

    limpar_canvas: function () {
      return exigirCanvas().limpar();
    },

    aplicar_template: function (args) {
      return exigirCanvas().aplicarTemplate(args && args.id);
    },

    definir_fundo_bind: function (args) {
      return exigirCanvas().definirFundoBind((args && args.nome) || 'fundo');
    },

    definir_lote: function (args) {
      var registros = (args && args.registros) || [];
      if (!registros.length) throw new Error('lote vazio: nada para gerar');
      return { posts: exigirBatch().definirLote(registros) };
    },

    /* Criar em lote (batch-workflow.js): a IA lê o pedido e devolve os
       textos; o app gera na pasta de saída que o usuário escolheu. */
    lote_pedido: function () {
      return exigirLote().pedido();
    },

    lote_gerar: function (args) {
      return exigirLote().gerar(args || {});
    },

    lote_previa: function (args) {
      return exigirLote().previa(args || {});
    },

    lote_fotos: function (args) {
      return exigirLote().fotos(args || {});
    },

    lote_exemplo: function (args) {
      return exigirLote().exemplo(args || {});
    },

    lote_criar_molde: function (args) {
      return exigirLote().criarMolde(args || {});
    },

    gerar_no_canvas: function () {
      return { ok: exigirBatch().gerarNoCanvas() };
    },

    /* Exporta o lote e devolve o zip em base64 — sem download do navegador.
       O hook __tcmOnZip é quem captura o blob dentro do runBatchExport. */
    exportar_zip: function () {
      var batch = exigirBatch();
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
          window.__tcmOnZip = null;
          reject(new Error('tempo esgotado esperando o zip do export'));
        }, TIMEOUT_EXPORT_MS);

        window.__tcmOnZip = function (blob, nome) {
          clearTimeout(timer);
          window.__tcmOnZip = null;
          return blob.arrayBuffer().then(function (buf) {
            var bytes = new Uint8Array(buf);
            var bin = '';
            // chunk: String.fromCharCode com array gigante estoura a pilha
            for (var i = 0; i < bytes.length; i += 0x8000) {
              bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            }
            resolve({ nome: nome, zip: btoa(bin) });
            return true; // consumido: não baixar no navegador
          });
        };

        Promise.resolve(batch.exportar()).catch(function (e) {
          clearTimeout(timer);
          window.__tcmOnZip = null;
          reject(e);
        });
      });
    }
  };

  function exigirCanvas() {
    if (!window.__tcmCanvas) throw new Error('app ainda não inicializou o canvas');
    return window.__tcmCanvas;
  }

  function exigirLote() {
    if (!window.__tcmLote) throw new Error('tela de Criar em lote indisponível');
    return window.__tcmLote;
  }

  function exigirBatch() {
    if (!window.__tcmBatch) throw new Error('motor de lote indisponível');
    return window.__tcmBatch;
  }

  function executar(msg) {
    var fn = COMANDOS[msg.cmd];
    if (!fn) {
      enviar({ id: msg.id, ok: false, erro: 'comando desconhecido: ' + msg.cmd });
      return;
    }
    Promise.resolve()
      .then(function () { return fn(msg.args || {}); })
      .then(function (data) { enviar({ id: msg.id, ok: true, data: data }); })
      .catch(function (e) {
        enviar({ id: msg.id, ok: false, erro: (e && e.message) || String(e) });
      });
  }

  /* Status inspecionável no console do navegador: window.__tcmPonteStatus() */
  window.__tcmPonteStatus = function () {
    return {
      conectada: !!(ws && ws.readyState === WebSocket.OPEN),
      url: URL_PONTE,
      apis: prontos()
    };
  };

  conectar();
})();
