# Direção de arte para carrosséis

Este guia complementa `sessao.md`. O objetivo é entregar slides prontos para publicar, não apenas um plano de design. Compare cada decisão com os exemplos em "Resultados desejados". Se os exemplos forem inconsistentes, mantenha uma direção visual por variação.

## O que faz um carrossel converter

Design aqui não é estética de portfólio: é parar o dedo no slide 1 e fazer a pessoa arrastar até o fim. Um carrossel bonito que ninguém arrasta falhou. Estas regras vêm de criadores que viralizaram com slideshows (base em `~/Conhecimento-Slideshow`) e valem acima do gosto pessoal de quem desenha.

**Slide 1 (a capa) decide 90% do resultado**
- A foto da capa pesa tanto quanto o texto. O mesmo texto foi de 650 mil a 3,3 milhões de views só trocando a foto por um rosto chorando. Na capa vai uma **pessoa com emoção visível** (choro, alívio, riso nervoso), olhando pra câmera, em selfie ou foto caseira. Nunca use objeto, paisagem ou silhueta na capa.
- O gancho é um estado emocional que a pessoa reconhece, ou uma lacuna de curiosidade ("o dia 1 foi assim:", "eu aprendi da pior forma..."), não uma promessa genérica. "Como eu fiz" ganha de "como fazer".
- Uma palavra em CAIXA ALTA dá peso à frase (NÃO, ANTES, METADE). Só uma por slide.
- Tem que ser lido e entendido em menos de 2 segundos: 5 a 12 palavras.

**Cara de post de gente, não de anúncio**
- Fotos com cara de celular: luz quente de abajur, quarto real, lençol bagunçado, mão segurando o celular, café, Bíblia aberta. Cor viva e quente. **Nada de preto e branco, granulado artístico, foto de banco posada ou estética minimalista de designer.** Isso parece anúncio ou portfólio e a pessoa pula.
- Texto no estilo nativo do TikTok: fonte TikTok Sans (ou a mais próxima), branca com contorno preto, centralizada, no meio da tela ou acima do rosto. É o que o usuário já lê o dia todo e por isso não parece propaganda.
- O produto só aparece perto do fim, como parte da história ("baixei um app que..."), e de preferência numa foto real: mão segurando o celular com a tela do app, notificação, tempo de tela. A pessoa precisa sentir que **ela descobriu** o app.

**Sequência que segura o swipe**
- Uma ideia por slide. Cada slide deixa uma ponta solta pro próximo.
- Formatos que mais funcionam: diário com datas ("dia 1 / dia 7 / dia 30"), antes → o que fiz → depois (mesmo cenário nas duas pontas pra obrigar a voltar e comparar), lista salvável, desabafo em primeira pessoa.
- Variar o enquadramento entre slides (rosto → mãos → objeto → tela → rosto) pra cada swipe parecer novo. Mesma persona e mesma luz do começo ao fim.
- Fechamento: a virada emocional (a mesma pessoa melhor) e o CTA como final da história: "se quiser o nome do app comenta QUERO".
- 6 a 8 slides. Menos slides = mais gente chega no CTA.

**Formato**
- TikTok: 1080×1920 (9:16), tela cheia, respeitando os botões laterais e a legenda.
- Instagram feed: 1080×1350 (4:5). Carrossel com música aparece também na aba Reels.
- Gerar fotos sempre **sem texto**; o texto entra pelo renderizador.

**Checklist antes de entregar** (se algum item falhar, refaça)
1. A capa tem um rosto emocionado e o texto dá pra ler em 2 segundos?
2. Isso parece post de uma pessoa real ou parece anúncio? Tem que parecer pessoa.
3. As fotos são coloridas, quentes e da mesma persona e lugar?
4. Cada slide tem uma ideia só e puxa pro próximo?
5. O app aparece só no fim, numa foto real de celular?
6. O texto não cobre olhos nem boca?

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
