/**
 * Open Analytics - Carousel Templates Catalog & Engine
 * 
 * Coleção curada de templates de carrossel de alto padrão (3D Cascading Deck):
 * - Tutorial / Passo a Passo (5 slides)
 * - Editorial & Minimalist Noir (4 slides)
 * - Tech & Market Pulse (3 slides)
 * - Métricas & Crescimento SaaS (4 slides)
 * - Mito vs. Verdade (3 slides)
 * - Reflexão & Citação de Impacto (3 slides)
 */

(function (global) {
  'use strict';

  const TEMPLATES_DATA = [
    {
      id: 'tutorial_5steps',
      title: '5 Passos de Alto Impacto',
      category: 'educativo',
      categoryLabel: 'Educativo',
      description: 'Estrutura clássica de tutorial com capa atraente, passos numerados e CTA final de salvamento.',
      slideCount: 5,
      aspect: '1080 × 1350',
      badge: 'Mais Popular',
      deck: {
        coverBg: 'linear-gradient(180deg, #18181B 0%, #09090B 100%)',
        accentColor: '#3B82F6',
        tag: 'GUIA PRÁTICO',
        headline: '5 Hábitos Que Multiplicam Seus Resultados',
        sub: 'Pequenos ajustes diários que constroem consistência real.',
        author: '@voce.criador'
      },
      generateFrames: () => [
        {
          name: 'Capa',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: 'linear-gradient(180deg, #18181B 0%, #09090B 100%)',
          children: [
            {
              type: 'text',
              text: 'GUIA PRÁTICO · 2026',
              x: 100, y: 140, w: 880,
              fontSize: 22, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif',
              color: '#3B82F6', letterSpacing: '0.12em', textAlign: 'left'
            },
            {
              type: 'text',
              text: '5 Hábitos Que\nMultiplicam Seus\nResultados Diários',
              x: 100, y: 260, w: 880,
              fontSize: 72, fontWeight: 800, fontFamily: 'Inter Tight, sans-serif',
              color: '#FFFFFF', lineHeight: 1.08, letterSpacing: '-0.03em', textAlign: 'left',
              bind: 'titulo'
            },
            {
              type: 'text',
              text: 'Pequenos ajustes na rotina que eliminam a sobrecarga e constroem foco inabalável.',
              x: 100, y: 640, w: 860,
              fontSize: 34, fontWeight: 400, fontFamily: 'Inter, sans-serif',
              color: '#9CA3AF', lineHeight: 1.4, textAlign: 'left',
              bind: 'subtitulo'
            },
            {
              type: 'text',
              text: 'Arraste para o lado  →',
              x: 100, y: 1180, w: 880,
              fontSize: 24, fontWeight: 600, fontFamily: 'Space Grotesk, sans-serif',
              color: 'rgba(255, 255, 255, 0.45)', textAlign: 'left'
            }
          ]
        },
        {
          name: 'Dica 01',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: 'linear-gradient(180deg, #18181B 0%, #09090B 100%)',
          children: [
            {
              type: 'text',
              text: '01',
              x: 100, y: 130, w: 300,
              fontSize: 92, fontWeight: 900, fontFamily: 'Space Grotesk, sans-serif',
              color: '#3B82F6', letterSpacing: '-0.04em'
            },
            {
              type: 'text',
              text: 'Defina a Tarefa Heroica da Manhã',
              x: 100, y: 300, w: 880,
              fontSize: 54, fontWeight: 800, fontFamily: 'Inter Tight, sans-serif',
              color: '#FFFFFF', lineHeight: 1.15, textAlign: 'left',
              bind: 'passo_1_titulo'
            },
            {
              type: 'text',
              text: 'Antes de abrir e-mails ou redes sociais, dedique 90 minutos ininterruptos na única entrega que move a agulha do seu dia.\n\nProteja essa janela como uma reunião inegociável.',
              x: 100, y: 520, w: 860,
              fontSize: 32, fontWeight: 400, fontFamily: 'Inter, sans-serif',
              color: '#D1D5DB', lineHeight: 1.5, textAlign: 'left',
              bind: 'passo_1_desc'
            }
          ]
        },
        {
          name: 'Dica 02',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: 'linear-gradient(180deg, #18181B 0%, #09090B 100%)',
          children: [
            {
              type: 'text',
              text: '02',
              x: 100, y: 130, w: 300,
              fontSize: 92, fontWeight: 900, fontFamily: 'Space Grotesk, sans-serif',
              color: '#3B82F6', letterSpacing: '-0.04em'
            },
            {
              type: 'text',
              text: 'Elimine Notificações Ativas',
              x: 100, y: 300, w: 880,
              fontSize: 54, fontWeight: 800, fontFamily: 'Inter Tight, sans-serif',
              color: '#FFFFFF', lineHeight: 1.15, textAlign: 'left',
              bind: 'passo_2_titulo'
            },
            {
              type: 'text',
              text: 'Toda interrupção custa em média 23 minutos para retomar o estado de fluxo.\n\nColoque o celular em outro cômodo durante seus blocos de foco profundo.',
              x: 100, y: 520, w: 860,
              fontSize: 32, fontWeight: 400, fontFamily: 'Inter, sans-serif',
              color: '#D1D5DB', lineHeight: 1.5, textAlign: 'left',
              bind: 'passo_2_desc'
            }
          ]
        },
        {
          name: 'Dica 03',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: 'linear-gradient(180deg, #18181B 0%, #09090B 100%)',
          children: [
            {
              type: 'text',
              text: '03',
              x: 100, y: 130, w: 300,
              fontSize: 92, fontWeight: 900, fontFamily: 'Space Grotesk, sans-serif',
              color: '#3B82F6', letterSpacing: '-0.04em'
            },
            {
              type: 'text',
              text: 'Fechamento Diário em 5 Minutos',
              x: 100, y: 300, w: 880,
              fontSize: 54, fontWeight: 800, fontFamily: 'Inter Tight, sans-serif',
              color: '#FFFFFF', lineHeight: 1.15, textAlign: 'left',
              bind: 'passo_3_titulo'
            },
            {
              type: 'text',
              text: 'Termine o expediente escrevendo as 3 prioridades do dia seguinte. Assim, seu cérebro desliga sem carregar ansiedade para a noite.',
              x: 100, y: 520, w: 860,
              fontSize: 32, fontWeight: 400, fontFamily: 'Inter, sans-serif',
              color: '#D1D5DB', lineHeight: 1.5, textAlign: 'left',
              bind: 'passo_3_desc'
            }
          ]
        },
        {
          name: 'Conclusão / CTA',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: 'linear-gradient(180deg, #1E1B4B 0%, #09090B 100%)',
          children: [
            {
              type: 'text',
              text: 'RESUMO & AÇÃO',
              x: 100, y: 160, w: 880,
              fontSize: 22, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif',
              color: '#818CF8', letterSpacing: '0.12em', textAlign: 'center'
            },
            {
              type: 'text',
              text: 'Gostou deste conteúdo?',
              x: 100, y: 340, w: 880,
              fontSize: 62, fontWeight: 800, fontFamily: 'Inter Tight, sans-serif',
              color: '#FFFFFF', textAlign: 'center', lineHeight: 1.15,
              bind: 'cta_titulo'
            },
            {
              type: 'text',
              text: '📌 Salve este post para consultar sempre que precisar organizar sua rotina.',
              x: 140, y: 560, w: 800,
              fontSize: 32, fontWeight: 500, fontFamily: 'Inter, sans-serif',
              color: '#E0E7FF', textAlign: 'center', lineHeight: 1.45,
              bind: 'cta_texto'
            },
            {
              type: 'text',
              text: '@voce.criador',
              x: 100, y: 1180, w: 880,
              fontSize: 26, fontWeight: 600, fontFamily: 'Space Grotesk, sans-serif',
              color: '#A5B4FC', textAlign: 'center'
            }
          ]
        }
      ]
    },

    {
      id: 'editorial_minimal',
      title: 'Editorial Noir & Poético',
      category: 'editorial',
      categoryLabel: 'Editorial',
      description: 'Estética refinada em preto fosco com tipografia serifada de alto padrão e muito respiro.',
      slideCount: 4,
      aspect: '1080 × 1350',
      badge: 'Minimalista',
      deck: {
        coverBg: '#09090B',
        accentColor: '#E4E4E7',
        tag: 'ESSAY · VOL 04',
        headline: 'A Nobreza de Fazer Menos, Porém Melhor.',
        sub: 'Reflexões sobre design, foco e essencialismo.',
        author: 'Atelier de Ideias'
      },
      generateFrames: () => [
        {
          name: 'Capa',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: '#09090B',
          children: [
            {
              type: 'text',
              text: 'ESSAY · VOL 04',
              x: 100, y: 120, w: 880,
              fontSize: 18, fontWeight: 500, fontFamily: 'Space Grotesk, sans-serif',
              color: '#71717A', letterSpacing: '0.2em', textAlign: 'left'
            },
            {
              type: 'text',
              text: 'A Nobreza de\nFazer Menos,\nPorém Melhor.',
              x: 100, y: 320, w: 880,
              fontSize: 78, fontWeight: 400, fontFamily: 'Playfair Display, serif',
              color: '#F4F4F5', lineHeight: 1.1, textAlign: 'left',
              bind: 'titulo'
            },
            {
              type: 'text',
              text: 'No ruído da pressa contemporânea, a clareza se torna a maior das vantagens competitivas.',
              x: 100, y: 720, w: 780,
              fontSize: 28, fontWeight: 400, fontFamily: 'Lora, serif',
              color: '#A1A1AA', lineHeight: 1.5, textAlign: 'left',
              bind: 'subtitulo'
            },
            {
              type: 'text',
              text: '01 / 04',
              x: 100, y: 1200, w: 880,
              fontSize: 18, fontWeight: 500, fontFamily: 'Space Grotesk, sans-serif',
              color: '#52525B', textAlign: 'left'
            }
          ]
        },
        {
          name: 'Citação',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: '#09090B',
          children: [
            {
              type: 'text',
              text: '“',
              x: 90, y: 180, w: 200,
              fontSize: 140, fontWeight: 400, fontFamily: 'Playfair Display, serif',
              color: '#3F3F46', lineHeight: 0.8
            },
            {
              type: 'text',
              text: 'A perfeição não é atingida quando não há mais nada a acrescentar, mas sim quando não há mais nada a retirar.',
              x: 100, y: 360, w: 880,
              fontSize: 48, fontWeight: 400, fontFamily: 'Playfair Display, serif',
              color: '#FAFAFA', lineHeight: 1.35, textAlign: 'left',
              bind: 'citacao'
            },
            {
              type: 'text',
              text: '— Antoine de Saint-Exupéry',
              x: 100, y: 820, w: 880,
              fontSize: 24, fontWeight: 400, fontFamily: 'Lora, serif',
              color: '#A1A1AA', fontStyle: 'italic'
            },
            {
              type: 'text',
              text: '02 / 04',
              x: 100, y: 1200, w: 880,
              fontSize: 18, fontWeight: 500, fontFamily: 'Space Grotesk, sans-serif',
              color: '#52525B', textAlign: 'left'
            }
          ]
        },
        {
          name: 'Desenvolvimento',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: '#09090B',
          children: [
            {
              type: 'text',
              text: 'O Filtro do Essencial',
              x: 100, y: 220, w: 880,
              fontSize: 44, fontWeight: 500, fontFamily: 'Playfair Display, serif',
              color: '#F4F4F5', textAlign: 'left'
            },
            {
              type: 'text',
              text: 'Dizer sim para tudo é a forma mais silenciosa de dizer não para o que realmente importa.\n\nQuando você remove o supérfluo, o que resta ganha peso, significado e impacto.',
              x: 100, y: 380, w: 860,
              fontSize: 32, fontWeight: 400, fontFamily: 'Lora, serif',
              color: '#D4D4D8', lineHeight: 1.6, textAlign: 'left',
              bind: 'texto_desenvolvimento'
            },
            {
              type: 'text',
              text: '03 / 04',
              x: 100, y: 1200, w: 880,
              fontSize: 18, fontWeight: 500, fontFamily: 'Space Grotesk, sans-serif',
              color: '#52525B', textAlign: 'left'
            }
          ]
        },
        {
          name: 'Fechamento',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: '#09090B',
          children: [
            {
              type: 'text',
              text: 'Para Guardar e Refletir',
              x: 100, y: 360, w: 880,
              fontSize: 48, fontWeight: 400, fontFamily: 'Playfair Display, serif',
              color: '#FFFFFF', textAlign: 'center'
            },
            {
              type: 'text',
              text: 'Qual projeto ou tarefa você pode simplificar hoje para recuperar seu foco?',
              x: 120, y: 520, w: 840,
              fontSize: 32, fontWeight: 400, fontFamily: 'Lora, serif',
              color: '#A1A1AA', textAlign: 'center', lineHeight: 1.5,
              bind: 'pergunta_final'
            },
            {
              type: 'text',
              text: 'Compartilhe sua visão abaixo.',
              x: 100, y: 760, w: 880,
              fontSize: 22, fontWeight: 500, fontFamily: 'Space Grotesk, sans-serif',
              color: '#71717A', textAlign: 'center', letterSpacing: '0.05em'
            },
            {
              type: 'text',
              text: '04 / 04',
              x: 100, y: 1200, w: 880,
              fontSize: 18, fontWeight: 500, fontFamily: 'Space Grotesk, sans-serif',
              color: '#52525B', textAlign: 'center'
            }
          ]
        }
      ]
    },

    {
      id: 'tech_news',
      title: 'Tech Update & Breaking News',
      category: 'tech',
      categoryLabel: 'Tech & Notícias',
      description: 'Visual moderno com badges luminosos e hierarquia perfeita para atualizações de mercado.',
      slideCount: 3,
      aspect: '1080 × 1350',
      badge: 'Notícias',
      deck: {
        coverBg: 'linear-gradient(180deg, #0F172A 0%, #020617 100%)',
        accentColor: '#38BDF8',
        tag: '⚡ AI RADAR 2026',
        headline: 'A Nova Era dos Agentes Autônomos Chegou.',
        sub: 'O que muda no mercado de software e design.',
        author: 'Tech Insight'
      },
      generateFrames: () => [
        {
          name: 'Manchete',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: 'linear-gradient(180deg, #0F172A 0%, #020617 100%)',
          children: [
            {
              type: 'text',
              text: '⚡ TECH UPDATE · MARÇO 2026',
              x: 100, y: 140, w: 880,
              fontSize: 20, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif',
              color: '#38BDF8', letterSpacing: '0.14em', textAlign: 'left'
            },
            {
              type: 'text',
              text: 'A Nova Era dos\nAgentes Autônomos\nde Inteligência Artificial.',
              x: 100, y: 280, w: 880,
              fontSize: 68, fontWeight: 800, fontFamily: 'Inter Tight, sans-serif',
              color: '#F8FAFC', lineHeight: 1.1, textAlign: 'left',
              bind: 'manchete'
            },
            {
              type: 'text',
              text: 'Modelos que não apenas respondem textos, mas executam tarefas completas no seu computador e workflow.',
              x: 100, y: 640, w: 860,
              fontSize: 32, fontWeight: 400, fontFamily: 'Inter, sans-serif',
              color: '#94A3B8', lineHeight: 1.45, textAlign: 'left',
              bind: 'sub_manchete'
            },
            {
              type: 'text',
              text: 'Entenda os 3 impactos  →',
              x: 100, y: 1180, w: 880,
              fontSize: 24, fontWeight: 600, fontFamily: 'Space Grotesk, sans-serif',
              color: '#38BDF8', textAlign: 'left'
            }
          ]
        },
        {
          name: 'Os 3 Impactos',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: 'linear-gradient(180deg, #0F172A 0%, #020617 100%)',
          children: [
            {
              type: 'text',
              text: 'PRINCIPAIS MUDANÇAS',
              x: 100, y: 140, w: 880,
              fontSize: 20, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif',
              color: '#38BDF8', letterSpacing: '0.14em', textAlign: 'left'
            },
            {
              type: 'text',
              text: '1. Automação de Ponta a Ponta\nRotinas repetitivas de dados e código deixam de ser manuais.\n\n2. Criatividade Aumentada\nFoco no direcionamento e bom gosto em vez de execução braçal.\n\n3. Velocidade 10x de Validação\nProjetos saem da ideia para o ar em poucas horas.',
              x: 100, y: 280, w: 880,
              fontSize: 32, fontWeight: 500, fontFamily: 'Inter, sans-serif',
              color: '#E2E8F0', lineHeight: 1.5, textAlign: 'left',
              bind: 'pontos_principais'
            }
          ]
        },
        {
          name: 'Conclusão & Fonte',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: 'linear-gradient(180deg, #0F172A 0%, #020617 100%)',
          children: [
            {
              type: 'text',
              text: 'O QUE ESPERAR',
              x: 100, y: 240, w: 880,
              fontSize: 20, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif',
              color: '#38BDF8', letterSpacing: '0.14em', textAlign: 'center'
            },
            {
              type: 'text',
              text: 'Quem dominar as ferramentas certas hoje liderará o mercado amanhã.',
              x: 120, y: 380, w: 840,
              fontSize: 52, fontWeight: 800, fontFamily: 'Inter Tight, sans-serif',
              color: '#FFFFFF', textAlign: 'center', lineHeight: 1.2,
              bind: 'conclusao_texto'
            },
            {
              type: 'text',
              text: 'Siga para atualizações diárias sobre tecnologia e inovação.',
              x: 100, y: 720, w: 880,
              fontSize: 26, fontWeight: 400, fontFamily: 'Inter, sans-serif',
              color: '#94A3B8', textAlign: 'center'
            }
          ]
        }
      ]
    },

    {
      id: 'metrics_growth',
      title: 'Métricas & Case de Crescimento',
      category: 'negocios',
      categoryLabel: 'Métricas & SaaS',
      description: 'Destaque para números tabulares gigantes e análises baseadas em dados reais.',
      slideCount: 4,
      aspect: '1080 × 1350',
      badge: 'Negócios',
      deck: {
        coverBg: '#09090B',
        accentColor: '#10B981',
        tag: 'GROWTH CASE STUDY',
        headline: '+340% de Retenção Orgânica em 90 Dias.',
        sub: 'Os bastidores da nossa maior virada de produto.',
        author: 'SaaS Metrics'
      },
      generateFrames: () => [
        {
          name: 'Capa',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: '#09090B',
          children: [
            {
              type: 'text',
              text: 'CASE REAL DE PRODUTO',
              x: 100, y: 130, w: 880,
              fontSize: 20, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif',
              color: '#10B981', letterSpacing: '0.14em', textAlign: 'left'
            },
            {
              type: 'text',
              text: 'Como Atingimos\n+340% de Retenção\nEm Apenas 90 Dias.',
              x: 100, y: 260, w: 880,
              fontSize: 66, fontWeight: 800, fontFamily: 'Inter Tight, sans-serif',
              color: '#FFFFFF', lineHeight: 1.1, textAlign: 'left',
              bind: 'titulo_case'
            },
            {
              type: 'text',
              text: 'Sem aumentar investimento em anúncios: apenas redesenhando a primeira experiência do usuário.',
              x: 100, y: 640, w: 860,
              fontSize: 32, fontWeight: 400, fontFamily: 'Inter, sans-serif',
              color: '#9CA3AF', lineHeight: 1.45, textAlign: 'left',
              bind: 'sub_case'
            },
            {
              type: 'text',
              text: 'Veja os números e decisões  →',
              x: 100, y: 1180, w: 880,
              fontSize: 24, fontWeight: 600, fontFamily: 'Space Grotesk, sans-serif',
              color: '#10B981', textAlign: 'left'
            }
          ]
        },
        {
          name: 'Métrica Chave',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: '#09090B',
          children: [
            {
              type: 'text',
              text: 'A MÉTRICA HERO',
              x: 100, y: 180, w: 880,
              fontSize: 20, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif',
              color: '#10B981', letterSpacing: '0.14em', textAlign: 'center'
            },
            {
              type: 'text',
              text: '3.4x',
              x: 100, y: 300, w: 880,
              fontSize: 140, fontWeight: 900, fontFamily: 'Inter Tight, sans-serif',
              color: '#10B981', letterSpacing: '-0.05em', textAlign: 'center',
              bind: 'numero_destaque'
            },
            {
              type: 'text',
              text: 'Mais ativações completadas no primeiro dia após o novo fluxo de onboarding.',
              x: 140, y: 560, w: 800,
              fontSize: 36, fontWeight: 600, fontFamily: 'Inter, sans-serif',
              color: '#FFFFFF', textAlign: 'center', lineHeight: 1.4,
              bind: 'explicacao_metrica'
            }
          ]
        },
        {
          name: 'O Que Mudou',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: '#09090B',
          children: [
            {
              type: 'text',
              text: '3 DECISÕES CRÍTICAS',
              x: 100, y: 140, w: 880,
              fontSize: 20, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif',
              color: '#10B981', letterSpacing: '0.14em', textAlign: 'left'
            },
            {
              type: 'text',
              text: '1. Redução de Passos\nCortamos 4 telas desnecessárias de cadastro.\n\n2. Valor em Menos de 60s\nO usuário vê o primeiro resultado imediato.\n\n3. Templates Prontos\nEliminamos a síndrome da tela em branco.',
              x: 100, y: 280, w: 880,
              fontSize: 32, fontWeight: 500, fontFamily: 'Inter, sans-serif',
              color: '#E5E7EB', lineHeight: 1.5, textAlign: 'left',
              bind: 'licoes_case'
            }
          ]
        },
        {
          name: 'CTA',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: 'linear-gradient(180deg, #064E3B 0%, #022C22 100%)',
          children: [
            {
              type: 'text',
              text: 'LIÇÃO FINAL',
              x: 100, y: 260, w: 880,
              fontSize: 20, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif',
              color: '#6EE7B7', letterSpacing: '0.14em', textAlign: 'center'
            },
            {
              type: 'text',
              text: 'Simplificar é a estratégia mais lucrativa de produto.',
              x: 100, y: 380, w: 880,
              fontSize: 54, fontWeight: 800, fontFamily: 'Inter Tight, sans-serif',
              color: '#FFFFFF', textAlign: 'center', lineHeight: 1.2
            },
            {
              type: 'text',
              text: 'Salve para aplicar no seu projeto!',
              x: 100, y: 720, w: 880,
              fontSize: 28, fontWeight: 500, fontFamily: 'Inter, sans-serif',
              color: '#A7F3D0', textAlign: 'center'
            }
          ]
        }
      ]
    },

    {
      id: 'myth_vs_truth',
      title: 'Mito vs. Verdade',
      category: 'comparativo',
      categoryLabel: 'Comparativo',
      description: 'Alto engajamento com blocos de contraste divididos entre erros comuns e práticas recomendadas.',
      slideCount: 3,
      aspect: '1080 × 1350',
      badge: 'Engajamento',
      deck: {
        coverBg: '#18181B',
        accentColor: '#F43F5E',
        tag: 'DESMISTIFICANDO',
        headline: 'Mitos vs. Fatos no Mercado Digital',
        sub: 'O que realmente funciona vs. o que é apenas ilusão.',
        author: 'Insight Club'
      },
      generateFrames: () => [
        {
          name: 'Capa',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: '#18181B',
          children: [
            {
              type: 'text',
              text: 'DESMISTIFICANDO',
              x: 100, y: 140, w: 880,
              fontSize: 20, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif',
              color: '#F43F5E', letterSpacing: '0.14em', textAlign: 'left'
            },
            {
              type: 'text',
              text: 'Mito vs. Verdade:\nO Que Ninguém Te\nConta Sobre Crescimento',
              x: 100, y: 280, w: 880,
              fontSize: 66, fontWeight: 800, fontFamily: 'Inter Tight, sans-serif',
              color: '#FFFFFF', lineHeight: 1.1, textAlign: 'left',
              bind: 'titulo_mito'
            },
            {
              type: 'text',
              text: 'Arraste para ver os 3 maiores mitos  →',
              x: 100, y: 1180, w: 880,
              fontSize: 24, fontWeight: 600, fontFamily: 'Space Grotesk, sans-serif',
              color: 'rgba(255, 255, 255, 0.45)', textAlign: 'left'
            }
          ]
        },
        {
          name: 'Mito 01',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: '#18181B',
          children: [
            {
              type: 'text',
              text: '❌  MITO',
              x: 100, y: 140, w: 880,
              fontSize: 28, fontWeight: 800, fontFamily: 'Space Grotesk, sans-serif',
              color: '#F43F5E', letterSpacing: '0.08em', textAlign: 'left'
            },
            {
              type: 'text',
              text: '“Você precisa postar 3 vezes ao dia para ter alcance.”',
              x: 100, y: 220, w: 880,
              fontSize: 44, fontWeight: 600, fontFamily: 'Inter Tight, sans-serif',
              color: '#FECDD3', lineHeight: 1.25, textAlign: 'left',
              bind: 'texto_mito_1'
            },
            {
              type: 'text',
              text: '✅  VERDADE',
              x: 100, y: 560, w: 880,
              fontSize: 28, fontWeight: 800, fontFamily: 'Space Grotesk, sans-serif',
              color: '#10B981', letterSpacing: '0.08em', textAlign: 'left'
            },
            {
              type: 'text',
              text: '1 conteúdo memorável e profundo por semana gera 10x mais autoridade e clientes do que 20 posts rasos.',
              x: 100, y: 640, w: 880,
              fontSize: 42, fontWeight: 600, fontFamily: 'Inter Tight, sans-serif',
              color: '#A7F3D0', lineHeight: 1.3, textAlign: 'left',
              bind: 'texto_verdade_1'
            }
          ]
        },
        {
          name: 'Conclusão',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: '#09090B',
          children: [
            {
              type: 'text',
              text: 'E você, concorda?',
              x: 100, y: 340, w: 880,
              fontSize: 64, fontWeight: 800, fontFamily: 'Inter Tight, sans-serif',
              color: '#FFFFFF', textAlign: 'center', lineHeight: 1.15
            },
            {
              type: 'text',
              text: 'Deixe sua opinião nos comentários e compartilhe com alguém que precisa ler isso!',
              x: 120, y: 540, w: 840,
              fontSize: 32, fontWeight: 400, fontFamily: 'Inter, sans-serif',
              color: '#9CA3AF', textAlign: 'center', lineHeight: 1.5
            }
          ]
        }
      ]
    },

    {
      id: 'quote_leadership',
      title: 'Frase & Visão de Liderança',
      category: 'editorial',
      categoryLabel: 'Liderança & Visão',
      description: 'Perfeito para reflexões pessoais, princípios inegociáveis e conexão autêntica.',
      slideCount: 3,
      aspect: '1080 × 1350',
      badge: 'Reflexão',
      deck: {
        coverBg: 'linear-gradient(135deg, #1C1917 0%, #44403C 100%)',
        accentColor: '#F59E0B',
        tag: 'PRINCÍPIOS DE VIDA',
        headline: 'Construa Algo Tão Bom Que Seja Impossível Ignorar.',
        sub: '3 regras que me guiaram nos últimos 10 anos.',
        author: 'Liderança Craft'
      },
      generateFrames: () => [
        {
          name: 'Capa',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: 'linear-gradient(135deg, #1C1917 0%, #44403C 100%)',
          children: [
            {
              type: 'text',
              text: 'PRINCÍPIOS DE DESIGN & VIDA',
              x: 100, y: 140, w: 880,
              fontSize: 20, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif',
              color: '#F59E0B', letterSpacing: '0.14em', textAlign: 'left'
            },
            {
              type: 'text',
              text: 'Construa Algo\nTão Bom Que Seja\nImpossível Ignorar.',
              x: 100, y: 280, w: 880,
              fontSize: 70, fontWeight: 800, fontFamily: 'Inter Tight, sans-serif',
              color: '#FFFFFF', lineHeight: 1.1, textAlign: 'left',
              bind: 'frase_destaque'
            },
            {
              type: 'text',
              text: '3 regras inegociáveis que moldaram minha trajetória profissional.',
              x: 100, y: 660, w: 860,
              fontSize: 32, fontWeight: 400, fontFamily: 'Inter, sans-serif',
              color: '#D6D3D1', lineHeight: 1.45, textAlign: 'left',
              bind: 'sub_frase'
            },
            {
              type: 'text',
              text: 'Passa para o lado  →',
              x: 100, y: 1180, w: 880,
              fontSize: 24, fontWeight: 600, fontFamily: 'Space Grotesk, sans-serif',
              color: '#F59E0B', textAlign: 'left'
            }
          ]
        },
        {
          name: 'Os Princípios',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: 'linear-gradient(135deg, #1C1917 0%, #292524 100%)',
          children: [
            {
              type: 'text',
              text: '1. O Capricho é Notado\nMesmo quando ninguém vê os detalhes, a harmonia total é sentida.\n\n2. Consistência Vence Intensidade\n1% de avanço diário supera qualquer sprint desordenado.\n\n3. Respeite Seu Ritmo\nCrescimento sustentável sempre supera modismos rápidos.',
              x: 100, y: 240, w: 880,
              fontSize: 34, fontWeight: 500, fontFamily: 'Inter, sans-serif',
              color: '#F5F5F4', lineHeight: 1.6, textAlign: 'left',
              bind: 'principios_texto'
            }
          ]
        },
        {
          name: 'Encerramento',
          format: 'ig-feed',
          w: 1080,
          h: 1350,
          bg: '#1C1917',
          children: [
            {
              type: 'text',
              text: 'Qual desses princípios mais ressoa com você hoje?',
              x: 120, y: 400, w: 840,
              fontSize: 54, fontWeight: 800, fontFamily: 'Inter Tight, sans-serif',
              color: '#FFFFFF', textAlign: 'center', lineHeight: 1.2
            },
            {
              type: 'text',
              text: 'Salve para revisitar nos dias desafiadores.',
              x: 100, y: 720, w: 880,
              fontSize: 28, fontWeight: 400, fontFamily: 'Inter, sans-serif',
              color: '#A8A29E', textAlign: 'center'
            }
          ]
        }
      ]
    }
  ];

  class CarouselTemplatesEngine {
    constructor() {
      this.templates = TEMPLATES_DATA;
    }

    getAll() {
      return this.templates;
    }

    getById(id) {
      return this.templates.find(t => t.id === id) || null;
    }

    getByCategory(category) {
      if (!category || category === 'todos') return this.templates;
      return this.templates.filter(t => t.category === category);
    }

    getCategories() {
      return [
        { id: 'todos', label: 'Todos os Templates' },
        { id: 'educativo', label: 'Educativo / Passo a Passo' },
        { id: 'editorial', label: 'Editorial & Minimal' },
        { id: 'tech', label: 'Tech & Notícias' },
        { id: 'negocios', label: 'Métricas & SaaS' },
        { id: 'comparativo', label: 'Mito vs. Verdade' }
      ];
    }
  }

  global.CarouselTemplates = new CarouselTemplatesEngine();

})(typeof window !== 'undefined' ? window : this);
