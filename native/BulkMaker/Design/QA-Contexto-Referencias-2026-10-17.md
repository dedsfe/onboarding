# Contexto do produto e referências no canvas

O perfil completo do onboarding entra no estado do terminal e acompanha edições e trocas de projeto. A pesquisa nativa usa o nicho e as buscas do perfil e importa cada publicação baixada no canvas capturado no início da pesquisa. O terminal recebe também a regra obrigatória de importar imagens obtidas por outros caminhos.

## Validação

`swift test --filter 'AgentSessionTests|ProjectStoreTests|ResearchRuleTests|ResearchCanvasTests|OnboardingServicesTests|CanvasFolderTests|CanvasScreenTests'`

39 testes passaram. Incluem perfil parcial e completo, atualização de sessão aberta, isolamento entre projetos, persistência de texto editável, legenda longa, alinhamento das transcrições, slide ausente, métricas ausentes versus zero real, serialização dos resultados e OCR de uma imagem real gerada pelo teste. Os testes de tela existentes verificam seleção, zoom e abertura/cancelamento do seletor de arquivos com eventos de ponteiro.

Captura da composição na view real do canvas: `/private/tmp/research-canvas-audit.png`. Usa arquivos temporários de teste, sem alterar projetos pessoais. A chamada de rede ao TikTok não foi repetida nesta validação; o serviço pode exigir verificação ou não devolver resultados.

## Revisão da lei de design

Releitura integral aplicada ao escopo das anotações novas, sem redesenhar as outras telas do aplicativo:

| Pontos revisados | Resultado |
| --- | --- |
| Composição específica, conteúdo real, artefato e profundidade | A composição é a publicação solicitada: dados reais acima, arquivos originais no meio e transcrições abaixo, seguindo o exemplo do usuário. Não há dashboard de demonstração, ilustração decorativa ou afirmação inventada. |
| Famílias tipográficas, hierarquia e espaçamento das letras | Fonte nativa para dados editáveis, com pesos e tamanhos distintos para autoria, métricas e transcrição. Nenhuma fonte de marca ou Google Font adicionada. |
| Contraste, cores, superfícies, bordas e sombras | Texto branco sobre superfície escura quente. Sem gradiente, brilho, sombra decorativa ou borda acrescentada às caixas de texto. Os contornos de seleção pertencem ao canvas existente. |
| Gutter, margens, cortes e sobreposições | Padding de 14 unidades, espaços explícitos entre cabeçalho, legenda, imagens e transcrição. Alturas medidas pelo renderizador de texto, acrescidas de margem. Legenda e transcrições completas, sem truncamento. |
| Colunas comparáveis, alinhamento e centralização | Slides alinhados no topo; transcrições compartilham o mesmo eixo vertical e começam no x do slide correspondente. Texto é deliberadamente alinhado à esquerda. Cada publicação começa abaixo dos itens existentes. |
| Imagens, marcas, ícones, etiquetas e especificidade | Arquivos da pesquisa, @, URL e dados da fonte. Sem avatar falso, marca inventada, ícone em tile ou pills de metadados. Ausências são explícitas no texto e no JSON. |
| Movimento, estados visíveis e interatividade | Nenhuma entrada com opacity zero ou animação necessária para mostrar o conteúdo. Pan, zoom, seleção e edição usam a view nativa existente; textos permanecem editáveis e copiáveis. |
| Fundos, texturas, vidro, cores entre seções e efeitos de luz | Sem novos fundos, vidro, ruído, halo, seam ou efeitos decorativos. O canvas de pontos é o ambiente já existente e está no exemplo pedido. |
| Heróis, menus, rodapés, preços, formulários, CTAs e layouts repetidos | Nenhuma dessas estruturas é introduzida nesta mudança. Não há novo botão, hero, seção de marketing, wordmark ou layout de página. |
| Integridade e comportamento | A composição inteira é salva atomicamente; um board ilegível gera erro em vez de ser substituído. Textos longos mantêm altura suficiente. Falhas de download preservam a posição e o número do slide. Projetos removidos não são recriados pela pesquisa. |

O OCR é uma transcrição automática; quando não reconhece texto, a anotação pede conferência da imagem original. Para pesquisas externas ao comando nativo, a obrigação de importar é transmitida nas instruções e no estado da sessão da IA.
