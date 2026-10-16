# Revisão de design do produto

Escopo: telas de licença, ajustes de atualização, site e instalador produzidos por Codex. As telas de contas sociais,
onboarding, canvas e Instagram do Claude foram preservadas. Esta revisão não declara que esses outros fluxos foram auditados.

## Direção e referências consultadas

O mundo visual permanece o existente: pinturas da National Gallery no app, Liquid Glass e Slidi; Monet em ASCII e
Gambarino local no site. Foram consultadas referências de [Godly / Matthew Fisher](https://godly.website/website/760-matthew-fisher),
[Godly / Little Troop](https://godly.website/website/little-troop-409) e
[Land-book / Muse](https://land-book.com/websites/35567-muse-webflow-html-website-template): espaço para a arte,
hierarquia tipográfica e continuidade entre imagem e superfície. Não foram copiadas suas páginas ou conteúdo.

## Conferência ponto a ponto da lei anti-slop

Cada linha registra a decisão para os itens correspondentes da lei. “Ausente” significa que a técnica não foi
introduzida neste escopo, e não uma recomendação para eliminá-la do trabalho de outra pessoa.

| Ponto da lei | Conferência e decisão |
| --- | --- |
| Lucide repetido | Ausente; símbolos nativos existentes e marca/arte do produto. |
| Em dash | Não usado na nova copy de vendas. |
| Eyebrow/pill decorativo | Ausente. |
| Fraunces/Work Sans | Ausentes. |
| Botões pill com glow | Ausentes no site; vidro nativo solicitado no app. |
| Ícone grande em tile | Nenhum novo; Slidi é o mascote real, não um ícone de feature. |
| Cards flutuantes | Ausentes. |
| Glow cortado | Nenhum glow novo. |
| Kitchen-sink card | Ausente. |
| Mockup de janela macOS | Ausente; exemplos são JPGs reais do renderizador. |
| Space Grotesk | Ausente. |
| Roxo/gradiente azul-roxo | Ausente no novo design. |
| Gradiente + pill + ícone + texto | Ausente. |
| Par padrão de CTAs | Uma ação principal no hero; sem par preenchido/contorno. |
| Três pricing towers | Dois períodos numa mesma grade, sem tiers fabricados. |
| Testimonial/aspas decorativas | Ausentes; nenhum depoimento inventado. |
| Avatar de iniciais em gradiente | Ausente. |
| Banner de CTA pré-footer | Ausente. Lista de lançamento preserva função real. |
| Logo em squircle gradiente | Ausente. |
| Cormorant Garamond | Ausente. |
| Split hero padrão | Não criado. Hero central preserva a direção existente solicitada. |
| Papel quadriculado | Ausente; o ASCII reproduz uma pintura identificável. |
| Ilustração CSS/SVG rudimentar | Ausente; Slidi existente e saída do motor real. |
| Accent-bar card | Ausente. |
| Background glow | Ausente. |
| Code-snippet window falso | Ausente. |
| Sora/JetBrains Mono | Ausentes. |
| Tag flutuante na imagem | Ausente. |
| Syne | Ausente. |
| Texto preenchido por gradiente | Ausente. |
| Archivo/Inter por padrão | Ausentes; corpo do sistema e fonte existente do site. |
| Bordas claras em toda caixa | Não adicionadas no site; profundidade nativa no app. |
| Countdown falso | Ausente. |
| Hover-lift de card | Ausente. |
| Wordmark serif espaçado | Ausente. |
| Didone reflexivo | Ausente. |
| Monospace como voz | Não usado; checksum é dado técnico real. |
| Tratamento único em todos labels | Títulos, navegação, corpo e dados têm escalas distintas. |
| Glass mal executado | Reutiliza ModalStyle e section do app, sobre a pintura real; sem blur inventado em CSS. |
| Grid tênue de página inteira | Ausente. |
| Fill animation quebrada | Ausente. |
| Conteúdo invisível por reveal | Nenhum texto/controle depende de opacity 0 ou de JS para aparecer. |
| Clear the cut | Padding do modal e figuras conferidos; clipping só delimita as imagens. |
| Colunas de comparação desalinhadas | Linhas de título/preço/descrição/ação reservadas igualmente nos dois períodos. |
| Texto junto à borda | Gutter de 24/28 px no mobile; 28 px no modal; margens maiores no desktop. |
| Sombra simétrica por padrão | Nenhuma sombra nova em cards/botões do site. |
| Conteúdo jogado às pontas | Nav/footer centrados; blocos usam eixo e largura consistentes. |
| Logos reais/falsos | Nenhum cliente/integrador inventado; créditos reais da arte. |
| Centralização | Hero/ações e posição das colunas conferidos no navegador; modal usa frame central. |
| Sombra simulada com segunda caixa | Ausente. |
| Logo/ícone com caixa decorativa | Nenhum novo. |
| Eyebrow tick | Ausente. |
| Footer wordmark gigante mal colocado | Não utilizado. |
| Cores colidindo/seams | Verde tonal do site; Monet compartilhado; bordas da cena mascaradas nos pixels. |
| Sombra com borda dura | Nenhuma sombra adicionada. |
| Contraste insuficiente | Texto verde escuro sobre claro; modal branco sobre vidro escuro; contraste secundário aumentado. |
| Bloom repetindo silhueta | Nenhum bloom novo. |
| Dot no nav ativo | Ausente. |
| Seções sobrepostas cortando conteúdo | Modal acima do conteúdo; sem painel recortando texto do site. |
| Display type esmagado | Tracking moderado, sem unidades/separadores apertados. |
| Grain sobre texto | Ausente; arte fica atrás da copy. |
| Blue-charcoal padrão | Ausente. |
| Candy gradient pastel | Ausente. |
| Aurora de blobs | Ausente. |
| Halo radial atrás de objeto | Ausente. |
| Hero não domina a dobra | min-height de 100svh; nenhuma meia seção aparece por acidente. |
| Cream/beige default | Branco original do site preservado por solicitação; app usa a pintura escolhida pelo usuário. |
| Cinza UI-kit | Sem gray-100 como superfície geral; tonalidade verde específica no bloco de assinatura. |
| Rotação de Google Fonts | Nenhuma fonte nova; Gambarino já auto-hospedada e licenciada no site. |
| Hover boop de botão | Sem translate/scale no hover de botões. |
| Inner glow de badge | Ausente. |
| Strike fora de centro | Ausente. |
| Hero stack default | Composição do site original preservada, como solicitado; sem secundária ou badges. |
| Background fixo que segue tudo | Nenhum background fixed. Cada cena pertence à sua seção. |
| Hard image seams | Monet da segunda cena tem máscara longa com múltiplos stops e superfície contínua. |
| Accent saturado em tudo | Paleta tonal verde; sem palavra colorida arbitrária no headline. |
| Underline-fill no hover | Ausente; links usam estado tonal estático. |
| Sun/moon e ícones outline redrawn | Ausentes. |
| Hairlines decorativas | Nenhuma linha de ornamento nova. |
| Kicker + serif H2 | Sem kicker decorativo. |
| Big serif statement isolado | Texto explica o produto; não há seção de filosofia com aspas/itálico. |
| Form island repetido | Lista de lançamento sem ilha/card; função real preservada. |
| Email pill + botão pill | Campos retangulares, labels visíveis, botão em sua própria linha. |
| Image card com overlay caption | Imagem real sem texto HTML sobreposto nem badges; legenda fora da figura. |
| Fundo plano em tudo pós-hero | Cena de Monet também depois da dobra e exemplos reais do produto. |
| Reciclagem de house style | Componentes do próprio produto, não nova identidade transplantada de outro projeto. |
| Hero stack com painel à direita | Não criado. |
| Headline com 3+ linhas | Headline principal ajustado para duas linhas, inclusive 320 px. |
| Filled + outlined button pair | Ausente. |
| Label pequeno sobre heading grande | Não usado como abertura de seção. |
| Passos numerados sobre rail | Ausentes. |
| Slop layouts empilhados | Sem sequência features em 3 cards/tabs/pricing towers/accordion/CTA slab. |
| Meta-template SaaS | Não utilizado. |
| Metadata em pill chips | Dados de assinatura em Grid tipográfica, sem chips. |
| Dead controls | Testados carousel, lista, links e licença; checkout/download ausentes ficam explicitamente indisponíveis. |
| Fonte tasteful trocada por reputação | Fonte do site foi mantida; nenhuma caça a nova Google Font. |
| Mesmo skeleton recolorido | Evolução da marca existente, sem reskin genérico novo. |
| Standard footer | Rodapé curto, central, com navegação legal real; sem link farm/wordmark gigante. |
| Zero ícones por medo | App mantém seus símbolos e mascote; site usa controles semânticos de slide e favicon existente. |
| Evitar lista não é design | Assinatura visual é a pintura/ASCII e os arquivos de carrossel reais, com interação no próprio exemplo. |
| Translucência premium | Material do sistema e componentes do app, conforme direção expressa do André. |
| Tonal elevation | Bloco de assinatura tonal; glass nativo no app; sem bordas em todas as caixas. |
| Geometria bespoke | Mantidos mascote e componentes reais do produto; não adicionadas formas gratuitas. |
| Bare icons | Nenhum wrapper ornamental novo no site. |
| Say less | Copy curta por seção; requisitos detalhados junto da compra, termos em página própria. |
| Iconografia in-house | Mascote Slidi do próprio produto, sem desenhar um pacote genérico novo. |
| Microinterações | Slide reage a clique; pintura do hero reage ao ponteiro; states de formulário claros. |
| Luz considerada | Sem luz/glow arbitrário adicionado. |
| Noise premium | Não adicionado; pintura e ASCII já dão textura específica. |
| Glass CTA recipe | Não replicada mecanicamente; usa API nativa solicitada no app. |
| Tipo licenciado | Licença da Gambarino distribuída com a fonte; corpo neutro do sistema. |
| Composição grande | Primeiro viewport inteiro e segunda cena de Monet; escalas verificadas em desktop/mobile. |
| Logo wall legítimo | Não há clientes públicos declarados; nenhum wall inventado. |
| Blueprint/canvas | Não usado como fundo gratuito; exemplos mostram o próprio resultado do app. |
| Island sections | Somente assinatura com superfície tonal; não repetido em cada seção. |
| SVG custom de qualidade | Reutiliza o Slidi existente, não uma ilustração placeholder nova. |
| Gloss/glass | Gloss do sistema; não há halos/blur CSS sobre fundo plano. |
| Profissional com vida | Ponteiro/slider, mascote e states responsivos, sem gate de conteúdo. |
| Micro-grid texturizado | Não aplicável; nenhum grid novo. |
| Gradiente grainy | Não há grande gradiente colorido novo que precise de dither. |
| Scroll-authored motion | Não necessário; conteúdo permanece visível; smooth-scroll respeita reduced-motion. |
| Footer wordmark colocado certo | Não usado. |
| Signature artifact | Slidi no app; Monet/ASCII + slides realmente renderizados no site. |
| Atmosfera | Pintura em todo o app e em duas cenas do site. |
| Profundidade | Modal/glass sobre pintura; carrossel real em frente à segunda cena. |
| Produto populado | Exemplos reais exportados, sem dashboard imaginário. |
| Character display face | Gambarino do site existente, sem nova dupla de fontes. |
| Silhueta específica | Slidi e o vocabulário de vidro já pertencem ao produto. |
| Nav tratado | Nav do app preservado; nav do site centrado com agrupamento curto. |
| Specifics reais | Requisitos, dois Macs, sete dias, limitações e créditos explícitos. |
| Técnicas premium como ferramentas | Não acumuladas como checklist de efeitos. |
| Referência como linguagem | Nenhuma copy/artifact das referências foi reproduzida. |
| Coesão | Uma paleta/voz por superfície e a arte original ligando app/site. |
| Criativo não exige realismo stock | Arte clássica/ASCII já existente; não adicionado banco de imagens aleatório. |
| Fonte distinta muda com o contexto | Mantida por direção explícita da marca, não por reputação de Fontshare. |
| Dead-looking | Controles e mascote respondem; nenhuma motion esconde informação. |

## Evidências e correções feitas

- Navegador real em 1440, 390 e 320 px; próximo/anterior, inscrição, navegação, reduced-motion e ausência de
  overflow verificados. Corrigidos o overflow do footer e a quebra do hero em três linhas no celular.
- Colunas de planos com linhas e botões alinhados; zero métricas/clientes/depoimentos inventados.
- Modal de licença aberto no app, caminho de chave com resposta de configuração pendente e teste grátis acionado
  com clique real. O teste persiste sem login Keychain e sem prompt. Janela Settings crua removida.
- Pipeline de DMG de prévia executado; montagem e checksum válidos. Release notarizada/atualização real e checkout
  real de teste ainda dependem das configurações externas listadas em DISTRIBUICAO.md.
