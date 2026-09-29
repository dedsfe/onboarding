# Direção de arte para carrosséis

Este guia complementa `contexto.md`. O objetivo é entregar slides prontos para publicar, não apenas um plano de design. Compare cada decisão com os exemplos em "Resultados desejados". Se os exemplos forem inconsistentes, mantenha uma direção visual por variação.

## Antes de desenhar

1. Inspecione fotos, referências, textos e formato. Identifique assunto, público, tom, sequência e área livre nas fotos.
2. Extraia das referências: proporção, margens, alinhamento, hierarquia, cores, tratamento das fotos, tipografia e ritmo entre slides. Não copie marcas nem elementos protegidos de terceiros.
3. Para cada variação, defina uma direção de arte coerente. Variações devem diferir em composição e hierarquia, não só na cor.

## Tipografia e acabamento

- Use uma família de destaque com personalidade compatível com o tema e uma família neutra para textos longos. Confirme que as fontes existem no ambiente de renderização; não presuma que uma fonte nomeada será carregada. Se faltar, escolha uma alternativa disponível e verifique a imagem exportada.
- Para 1080 × 1350 px, comece com título de capa entre 72 e 112 px, títulos internos entre 52 e 80 px, corpo entre 30 e 44 px e metadados entre 24 e 30 px. Ajuste ao conteúdo real. Corpo abaixo de 28 px exige uma justificativa visual e revisão em tamanho de celular.
- Distribua pesos com intenção: 400–500 para leitura, 600–700 para subtítulos e 700–800 para impacto. Não coloque tudo em negrito. Entrelinha sugerida: 1,05–1,18 em títulos e 1,25–1,45 no corpo.
- Dê uma margem inicial de 72–96 px nas laterais e 80–110 px no topo e rodapé. Deixe rostos, produto e texto livres de cortes; verifique a área que a interface da rede social pode cobrir.
- Escolha 2 cores principais e, se necessário, 1 acento. Mantenha contraste legível sobre cada foto. Use película, caixa sólida ou contorno de texto apenas quando resolver um problema concreto de leitura.
- Borda e raio não são decoração automática. Quando um contêiner fizer sentido, use borda discreta de 1–3 px na resolução final e raio consistente com a direção visual. Contorno em letras sobre foto pode exigir 6–10 px. Evite sombra difusa, gradiente genérico, ícone sem função e cartão em todo slide.
- Cada slide deve ter um foco claro. Alterne slides com foto dominante, texto e respiro conforme a narrativa; mantenha uma mesma linguagem entre capa, desenvolvimento e fechamento.

## Fundos

Prioridade: fotos da pasta de origem, depois arquivos da biblioteca local `.bulk-maker/biblioteca-fundos/` quando combinarem com o assunto. A pasta de resultados desejados é referência visual; não reutilize seus arquivos como se fossem ativos do usuário sem verificar a origem. Se a biblioteca estiver vazia ou nenhuma imagem servir, use uma superfície simples e intencional. Nunca preencha com foto aleatória só para evitar espaço vazio. Para imagens externas, confirme a licença e as permissões de pessoas, marcas e obras retratadas antes do uso.

## Ferramentas e revisão

O projeto contém um editor web e um servidor MCP em `mcp/server.js`. Se as ferramentas MCP do Carousel Maker estiverem conectadas, use `ver_exemplo_lote`, `definir_pastas_lote`, `ver_fotos_lote`, `criar_molde`, `previsualizar_lote` e `gerar_lote` na ordem adequada. `criar_molde` aceita `fonte`, `peso`, `tamanho`, `cor`, `contorno`, `cor_contorno` e `caixa` por campo de texto. Essas ferramentas dependem da ponte do editor web aberta; não suponha que estão disponíveis só porque os arquivos existem. Se não estiverem conectadas, use os meios de renderização realmente disponíveis e valide os arquivos finais.

Revise cada slide renderizado em 1080 px de largura e em tamanho de celular. Confira texto completo, legibilidade, alinhamento, centralização, margens, cor, fidelidade às referências e consistência. Corrija qualquer corte ou overflow antes de entregar. Nunca declare uma variação concluída sem seus arquivos finais.
