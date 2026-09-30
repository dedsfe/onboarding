# Direção de arte para carrosséis

Este guia complementa `sessao.md`. O objetivo é entregar slides prontos para publicar, não apenas um plano de design. Compare cada decisão com os exemplos em "Resultados desejados". Se os exemplos forem inconsistentes, mantenha uma direção visual por variação.

## Antes de desenhar

1. Inspecione fotos, referências, textos e formato. Identifique assunto, público, tom, sequência e área livre nas fotos.
2. Extraia das referências: proporção, margens, alinhamento, hierarquia, cores, tratamento das fotos, tipografia e ritmo entre slides. Não copie marcas nem elementos protegidos de terceiros.
3. Para cada variação, defina uma direção de arte coerente. Variações devem diferir em composição e hierarquia, não só na cor.

## Tipografia e acabamento

Quem desenha é o renderizador nativo `.bulk-maker/bin/carousel-render`: fonte, tamanho, contorno, contraste, margens e áreas seguras do TikTok já saem calculados, com o estilo de `.bulk-maker/estilo.json`. Não tente reproduzir isso à mão nem desenhar com HTML, navegador ou Python. O que depende de você:

- Texto curto: uma ideia por slide. Se o relatório disser "fonte reduzida", a frase está longa; encurte em vez de aceitar letra pequena.
- Destaque com intenção: 1–2 palavras por slide que carregam a emoção ou a virada da frase. Nunca destaque artigo, preposição ou a frase inteira.
- Foto certa para cada texto: prefira fotos com área limpa (parede, céu, lençol) onde o texto vai ficar. Se o relatório disser que escureceu ou clareou a área, veja se outra foto resolve melhor.
- Rosto livre: confira na folha de revisão que o texto não cobre olhos ou boca. Se cobrir, troque a foto ou fixe `"position"` naquele slide.
- Ritmo: capa com gancho forte, desenvolvimento com uma ideia por slide, fechamento com CTA. Variações diferem no ângulo da copy e na escolha das fotos, não só em trocar palavras.

## Fundos

Prioridade: fotos da pasta de origem, depois arquivos da biblioteca local `.bulk-maker/biblioteca-fundos/` quando combinarem com o assunto. A pasta de resultados desejados é referência visual; não reutilize seus arquivos como se fossem ativos do usuário sem verificar a origem. Se a biblioteca estiver vazia ou nenhuma imagem servir, use uma superfície simples e intencional. Nunca preencha com foto aleatória só para evitar espaço vazio. Para imagens externas, confirme a licença e as permissões de pessoas, marcas e obras retratadas antes do uso.

## Ferramentas e revisão

Fluxo: folhas de miniaturas (`carousel-render --folha`) para ver referências e fotos → gravar todos os planos → um único `carousel-render .bulk-maker/planos/variacao-*.json --lote --estilo .bulk-maker/estilo.json --saida <saída> --revisao .bulk-maker/revisao` → ler o relatório e a folha de revisão de cada variação → no máximo uma rodada de ajuste.

Revise pela folha de revisão, não pelos slides soltos: texto completo, rosto livre, fidelidade às referências e consistência entre slides. Cada pasta de variação leva também `legenda.txt`. Nunca declare uma variação concluída sem seus arquivos finais.
