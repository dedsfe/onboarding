/**
 * Open Analytics - Unsplash Service Engine (Backend API Client)
 * 
 * Gerencia a comunicação com a API do Unsplash:
 * - Autenticação e gestão de API Keys (persistência segura em localStorage)
 * - Busca inteligente com dicionário de tradução PT-BR -> EN
 * - Listagem de fotos populares/curadas e categorias temáticas de alto padrão
 * - Download tracking em conformidade com as diretrizes do Unsplash
 * - Ingestão, conversão para Blob/DataURL e integração com o cache de assets
 * - Cache em memória para economia de requisições e proteção contra Rate Limits
 */

(function (global) {
  'use strict';

  const DEFAULT_ACCESS_KEY = 'YhCoNWRqrNCAjMDN0IhFRI8u7lpSW6lLLhUkZRT1rtg';
  const STORAGE_KEY = 'oa_unsplash_access_key';
  const BASE_URL = 'https://api.unsplash.com';

  // Cache em memória de buscas recentes (5 minutos de TTL)
  const responseCache = new Map();
  const CACHE_TTL_MS = 5 * 60 * 1000;

  // Dicionário curado de tradução PT-BR -> EN com termos otimizados para busca estética no Unsplash
  const TRANSLATION_MAP = {
    'negocio': 'business office',
    'negócios': 'business modern office',
    'tecnologia': 'technology minimalist coding',
    'trabalho': 'workspace desk laptop',
    'escritorio': 'modern workspace office architecture',
    'escritório': 'modern workspace office architecture',
    'dinheiro': 'finance wealth minimal currency',
    'investimento': 'finance investment stock market',
    'educacao': 'education study books focus',
    'educação': 'education study books focus',
    'estudo': 'studying notebook desk coffee',
    'minimalista': 'minimalist aesthetic architecture',
    'minimalismo': 'minimalism clean texture',
    'escuro': 'dark moody cinematic contrast',
    'preto': 'black aesthetic dark background',
    'textura': 'texture background concrete paper',
    'gradiente': 'gradient background abstract light',
    'abstrato': 'abstract 3d aesthetic geometry',
    'pessoas': 'portrait expressive human',
    'pessoa': 'portrait authentic human face',
    'mulher': 'woman portrait professional',
    'homem': 'man portrait professional',
    'saude': 'wellness healthcare healthy lifestyle',
    'saúde': 'wellness healthcare healthy lifestyle',
    'comida': 'food culinary gastronomy aesthetic',
    'cafe': 'coffee aesthetic cafe morning',
    'café': 'coffee aesthetic cafe morning',
    'natureza': 'nature landscape peaceful serene',
    'cidade': 'urban cityscape architecture street',
    'viagem': 'travel adventure destination wanderlust',
    'arte': 'art gallery sculpture aesthetic museum',
    'moda': 'fashion editorial streetwear modern',
    'futuro': 'futuristic neon tech ai',
    'inteligencia artificial': 'artificial intelligence technology futuristic network',
    'inteligência artificial': 'artificial intelligence technology futuristic network',
    'marketing': 'marketing strategy creative workspace',
    'vendas': 'sales business team growth chart',
    'sucesso': 'success achievement ambition motivation',
    'foco': 'focus concentration productivity mindset',
    'livro': 'book open pages reading literature',
    'leitura': 'reading book aesthetic quiet moments'
  };

  // Categorias estéticas curadas para inspiração imediata (Zero digitação necessária)
  const CURATED_CATEGORIES = [
    {
      id: 'editorial',
      label: 'Editorial & Moda',
      icon: 'sparkles',
      query: 'editorial fashion modern architecture portrait aesthetic'
    },
    {
      id: 'minimalist',
      label: 'Minimalismo & Clean',
      icon: 'circle',
      query: 'minimalist clean white negative space architecture'
    },
    {
      id: 'business',
      label: 'Negócios & Tech',
      icon: 'briefcase',
      query: 'workspace startup technology modern laptop desk'
    },
    {
      id: 'dark_moody',
      label: 'Dark & Cinematográfico',
      icon: 'moon',
      query: 'dark moody cinematic black aesthetic contrast'
    },
    {
      id: 'textures',
      label: 'Texturas & Fundos',
      icon: 'layers',
      query: 'texture paper concrete noise abstract surface'
    },
    {
      id: 'gradients',
      label: 'Luz & Gradientes',
      icon: 'blend',
      query: 'abstract gradient blur light prism colorful'
    },
    {
      id: 'portraits',
      label: 'Retratos & Pessoas',
      icon: 'user',
      query: 'authentic portrait human expressive natural light'
    },
    {
      id: 'architecture',
      label: 'Arquitetura & Design',
      icon: 'building-2',
      query: 'brutalist modern architecture geometry glass facade'
    },
    {
      id: 'nature',
      label: 'Natureza & Calmaria',
      icon: 'trees',
      query: 'peaceful nature forest fog ocean golden hour'
    },
    {
      id: 'abstract_3d',
      label: 'Abstrato 3D',
      icon: 'boxes',
      query: 'abstract 3d render geometry surreal shapes pastel'
    }
  ];

  class UnsplashService {
    constructor() {
      this.apiKey = this.loadApiKey();
    }

    /**
     * Carrega a chave de API do localStorage ou da memória
     */
    loadApiKey() {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const stored = window.localStorage.getItem(STORAGE_KEY);
          if (stored && stored.trim()) return stored.trim();
        }
      } catch (e) {
        console.warn('[UnsplashService] Não foi possível acessar localStorage:', e);
      }
      return DEFAULT_ACCESS_KEY;
    }

    /**
     * Salva ou remove a chave de API
     */
    setApiKey(key) {
      const cleanKey = (key || '').trim();
      this.apiKey = cleanKey;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          if (cleanKey) {
            window.localStorage.setItem(STORAGE_KEY, cleanKey);
          } else {
            window.localStorage.removeItem(STORAGE_KEY);
          }
        }
      } catch (e) {
        console.warn('[UnsplashService] Erro ao salvar chave:', e);
      }
      // Limpa cache de respostas para recarregar com a nova chave
      responseCache.clear();
      return !!cleanKey;
    }

    /**
     * Retorna se a chave de API está configurada
     */
    hasApiKey() {
      return !!this.apiKey;
    }

    /**
     * Retorna a chave configurada
     */
    getApiKey() {
      return this.apiKey;
    }

    /**
     * Categorias curadas disponíveis
     */
    getCategories() {
      return CURATED_CATEGORIES;
    }

    /**
     * Traduz uma query em português ou termos coloquiais para inglês refinado
     */
    translateQuery(rawQuery) {
      if (!rawQuery) return '';
      const clean = rawQuery.toLowerCase().trim();
      
      // Procura correspondência exata no dicionário
      if (TRANSLATION_MAP[clean]) {
        return TRANSLATION_MAP[clean];
      }

      // Procura correspondência por partes
      for (const [ptKey, enValue] of Object.entries(TRANSLATION_MAP)) {
        if (clean.includes(ptKey)) {
          return clean.replace(ptKey, enValue);
        }
      }

      return rawQuery;
    }

    /**
     * Monta os headers da requisição com a chave de autenticação
     */
    _getHeaders() {
      if (!this.apiKey) {
        throw new Error('UNSPLASH_KEY_MISSING');
      }
      return {
        'Authorization': `Client-ID ${this.apiKey}`,
        'Accept-Version': 'v1'
      };
    }

    /**
     * Requisição HTTP interna com tratamento de cache e erros de cota
     */
    async _fetch(endpoint, params = {}) {
      const url = new URL(`${BASE_URL}${endpoint}`);
      Object.keys(params).forEach(k => {
        if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
          url.searchParams.set(k, String(params[k]));
        }
      });

      const cacheKey = url.toString() + '|' + (this.apiKey ? this.apiKey.slice(-6) : '');
      const cached = responseCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        return cached.data;
      }

      let res;
      try {
        res = await fetch(url.toString(), {
          headers: this._getHeaders()
        });
      } catch (networkErr) {
        console.error('[UnsplashService] Erro de rede:', networkErr);
        throw new Error('NETWORK_ERROR');
      }

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('UNSPLASH_UNAUTHORIZED'); // Chave inválida
        }
        if (res.status === 403) {
          throw new Error('UNSPLASH_RATE_LIMIT'); // Limite de 50 req/h atingido
        }
        const errorText = await res.text().catch(() => '');
        throw new Error(`UNSPLASH_API_ERROR: ${res.status} ${errorText}`);
      }

      const data = await res.json();
      responseCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    }

    /**
     * Testa e valida se a chave de API fornecida é válida
     */
    async validateKey(testKey) {
      const keyToTest = (testKey || this.apiKey || '').trim();
      if (!keyToTest) return { valid: false, message: 'Chave não informada.' };

      try {
        const res = await fetch(`${BASE_URL}/photos?per_page=1`, {
          headers: {
            'Authorization': `Client-ID ${keyToTest}`,
            'Accept-Version': 'v1'
          }
        });
        if (res.ok) {
          return { valid: true };
        }
        if (res.status === 401) {
          return { valid: false, message: 'Chave inválida. Verifique se copiou a Access Key correta no painel do Unsplash.' };
        }
        if (res.status === 403) {
          return { valid: false, message: 'Limite de requisições excedido para esta chave (Rate Limit).' };
        }
        return { valid: false, message: `Erro ao validar chave (Status ${res.status}).` };
      } catch (err) {
        return { valid: false, message: 'Não foi possível conectar aos servidores do Unsplash.' };
      }
    }

    /**
     * Busca fotos por texto (com paginação, orientação e ordenação)
     */
    async searchPhotos(query, options = {}) {
      const {
        page = 1,
        perPage = 24,
        orientation = '', // 'portrait' | 'landscape' | 'squarish'
        color = '',
        orderBy = 'relevant' // 'relevant' | 'latest'
      } = options;

      const cleanQuery = (query || '').trim();
      if (!cleanQuery) {
        return this.getEditorialPhotos({ page, perPage, orderBy });
      }

      const translatedQuery = this.translateQuery(cleanQuery);

      const params = {
        query: translatedQuery,
        page,
        per_page: perPage,
        order_by: orderBy
      };

      if (orientation && orientation !== 'all') {
        params.orientation = orientation;
      }
      if (color) {
        params.color = color;
      }

      const res = await this._fetch('/search/photos', params);
      return {
        results: (res.results || []).map(this._formatPhoto),
        total: res.total || 0,
        totalPages: res.total_pages || 0,
        query: cleanQuery,
        translatedQuery
      };
    }

    /**
     * Fotos em destaque / curadas (quando nenhuma busca for digitada)
     */
    async getEditorialPhotos(options = {}) {
      const {
        page = 1,
        perPage = 24,
        orderBy = 'popular' // 'popular' | 'latest'
      } = options;

      const params = {
        page,
        per_page: perPage,
        order_by: orderBy
      };

      const photos = await this._fetch('/photos', params);
      const list = Array.isArray(photos) ? photos : (photos.results || []);
      return {
        results: list.map(this._formatPhoto),
        total: 1000,
        totalPages: Math.ceil(1000 / perPage),
        isEditorial: true
      };
    }

    /**
     * Fotos por categoria pré-selecionada
     */
    async getPhotosByCategory(categoryId, options = {}) {
      const cat = CURATED_CATEGORIES.find(c => c.id === categoryId);
      const query = cat ? cat.query : categoryId;
      return this.searchPhotos(query, options);
    }

    /**
     * Fotos aleatórias (para preenchimento rápido ou lotes)
     */
    async getRandomPhotos(options = {}) {
      const {
        count = 10,
        query = 'minimalist background texture',
        orientation = 'portrait'
      } = options;

      const params = {
        count: Math.min(30, Math.max(1, count)),
        query: this.translateQuery(query)
      };
      if (orientation && orientation !== 'all') {
        params.orientation = orientation;
      }

      const res = await this._fetch('/photos/random', params);
      const list = Array.isArray(res) ? res : [res];
      return list.map(this._formatPhoto);
    }

    /**
     * Dispara o beacon de download do Unsplash (exigência dos Termos de API)
     */
    async trackDownload(photo) {
      if (!photo || !photo.downloadLocation) return;
      try {
        await fetch(photo.downloadLocation, {
          headers: this._getHeaders()
        });
      } catch (err) {
        console.warn('[UnsplashService] Falha no track de download:', err);
      }
    }

    /**
     * Baixa a imagem do Unsplash como Blob/DataURL e garante tamanho ideal
     * Evita contaminação do Canvas (CORS) e permite exportar em alta qualidade
     */
    async downloadPhotoAsDataUrl(photo, quality = 'regular', customWidth = null) {
      if (!photo) throw new Error('Foto inválida.');

      let targetUrl = photo.urls ? (photo.urls[quality] || photo.urls.regular || photo.urls.full) : photo;

      // Se customWidth for especificado, adicionamos parâmetros de otimização na URL do Unsplash CDN
      if (customWidth && typeof targetUrl === 'string' && targetUrl.includes('images.unsplash.com')) {
        const u = new URL(targetUrl);
        u.searchParams.set('w', String(customWidth));
        u.searchParams.set('auto', 'format');
        u.searchParams.set('fit', 'crop');
        u.searchParams.set('q', '85');
        targetUrl = u.toString();
      }

      // 1. Notifica o Unsplash sobre o uso da foto (Diretriz oficial)
      this.trackDownload(photo);

      // 2. Faz o fetch como Blob e converte para DataURL
      const response = await fetch(targetUrl, { mode: 'cors' });
      if (!response.ok) throw new Error(`Falha ao baixar imagem: ${response.statusText}`);

      const blob = await response.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      return {
        dataUrl,
        width: photo.width || 1080,
        height: photo.height || 1350,
        aspectRatio: (photo.width && photo.height) ? (photo.width / photo.height) : 0.8,
        authorName: photo.author ? photo.author.name : 'Unsplash',
        authorUrl: photo.author ? photo.author.link : 'https://unsplash.com',
        photoId: photo.id
      };
    }

    /**
     * Formata o objeto retornado pelo Unsplash para a estrutura limpa usada no App
     */
    _formatPhoto(item) {
      if (!item) return null;
      return {
        id: item.id,
        slug: item.slug || item.id,
        width: item.width,
        height: item.height,
        color: item.color || '#18181B',
        blurHash: item.blur_hash,
        description: item.description || item.alt_description || 'Foto Unsplash',
        urls: {
          raw: item.urls ? item.urls.raw : '',
          full: item.urls ? item.urls.full : '',
          regular: item.urls ? item.urls.regular : '',
          small: item.urls ? item.urls.small : '',
          thumb: item.urls ? item.urls.thumb : ''
        },
        author: {
          name: (item.user && item.user.name) || 'Fotógrafo',
          username: (item.user && item.user.username) || '',
          avatar: (item.user && item.user.profile_image && item.user.profile_image.small) || '',
          link: (item.user && item.user.links && item.user.links.html) ? `${item.user.links.html}?utm_source=analytics_onboard&utm_medium=referral` : 'https://unsplash.com'
        },
        links: {
          html: (item.links && item.links.html) ? `${item.links.html}?utm_source=analytics_onboard&utm_medium=referral` : 'https://unsplash.com'
        },
        downloadLocation: (item.links && item.links.download_location) || ''
      };
    }
  }

  // Instância singleton exposta globalmente
  global.UnsplashService = new UnsplashService();

})(typeof window !== 'undefined' ? window : this);
