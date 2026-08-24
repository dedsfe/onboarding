/**
 * supabase-auth.js
 * Gerenciador de Autenticação e Sincronização em Nuvem (The Carousel Maker / Analytics Onboard)
 * Conectado ao projeto Supabase: gukebwwqhssmbnioqalm
 * 
 * Arquitetura de Alta Performance e Proteção de Memória:
 * - Singleton rigoroso: 1 único cliente Supabase em memória por ciclo de vida da página
 * - Trava anti-recursão para evitar loops infinitos de checagem de sessão e listagem
 * - Prevenção contra estouro de RAM (Garbage Collection otimizado)
 */

(function (window) {
  'use strict';

  const DEFAULT_SUPABASE_URL = 'https://gukebwwqhssmbnioqalm.supabase.co';
  const DEFAULT_ANON_KEY = 'sb_publishable_goU53-qIP_OP8UaDNMPPIw_Oqz6POjj';
  const STORAGE_ANON_KEY = 'oa_supabase_anon_key';

  let supabaseAnonKey = localStorage.getItem(STORAGE_ANON_KEY) || DEFAULT_ANON_KEY;
  let supabaseClient = null;
  let currentUser = null;
  let lastNotifiedUserId = Symbol('uninitialized');
  let authListeners = [];
  let sdkLoadPromise = null;
  let isCheckingSession = false;

  function initSupabaseClient() {
    if (supabaseClient) return supabaseClient;

    if (window.supabase && typeof window.supabase.createClient === 'function') {
      try {
        supabaseClient = window.supabase.createClient(DEFAULT_SUPABASE_URL, supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        });

        // Escuta nativa de eventos do Supabase (disparado apenas em mudanças reais)
        supabaseClient.auth.onAuthStateChange((event, session) => {
          const newUser = (session && session.user) ? session.user : null;
          handleUserChange(newUser);
        });

        // Checagem inicial de sessão uma única vez
        checkActiveSession();
      } catch (err) {
        console.warn('[Supabase] Falha ao instanciar cliente singleton:', err);
      }
    }
    return supabaseClient;
  }

  function handleUserChange(user) {
    const nextId = user ? user.id : null;
    if (lastNotifiedUserId === nextId) return; // Evita qualquer notificação redundante ou loop
    
    lastNotifiedUserId = nextId;
    currentUser = user;
    notifyAuthListeners(currentUser);
  }

  // Carrega SDK do Supabase se ainda não existir na página (Promise singleton compartilhada)
  function ensureSupabaseSDK() {
    if (supabaseClient) return Promise.resolve(supabaseClient);
    if (sdkLoadPromise) return sdkLoadPromise;

    sdkLoadPromise = new Promise((resolve) => {
      if (window.supabase && typeof window.supabase.createClient === 'function') {
        const client = initSupabaseClient();
        return resolve(client);
      }

      // Verifica se a tag de script já existe no documento
      const existingScript = document.querySelector('script[src*="supabase-js"]');
      if (existingScript) {
        existingScript.addEventListener('load', () => {
          const client = initSupabaseClient();
          resolve(client);
        }, { once: true });
        existingScript.addEventListener('error', () => {
          console.error('[Supabase] Falha ao carregar script existente do Supabase JS.');
          resolve(null);
        }, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.async = true;
      script.onload = () => {
        const client = initSupabaseClient();
        resolve(client);
      };
      script.onerror = () => {
        console.error('[Supabase] Falha ao carregar CDN do Supabase JS SDK.');
        resolve(null);
      };
      document.head.appendChild(script);
    });

    return sdkLoadPromise;
  }

  async function checkActiveSession() {
    if (!supabaseClient || isCheckingSession) return currentUser;
    isCheckingSession = true;
    try {
      const { data: { session }, error } = await supabaseClient.auth.getSession();
      const user = (!error && session && session.user) ? session.user : null;
      handleUserChange(user);
      return currentUser;
    } catch (e) {
      console.warn('[Supabase] Erro ao recuperar sessão:', e);
    } finally {
      isCheckingSession = false;
    }
    return currentUser;
  }

  function notifyAuthListeners(user) {
    authListeners.forEach(fn => {
      try { fn(user); } catch (e) { console.error('[Supabase Auth Listener Error]', e); }
    });
  }

  const SupabaseAuth = {
    url: DEFAULT_SUPABASE_URL,

    getAnonKey() {
      return supabaseAnonKey;
    },

    setAnonKey(key) {
      if (!key) return;
      supabaseAnonKey = key.trim();
      localStorage.setItem(STORAGE_ANON_KEY, supabaseAnonKey);
      supabaseClient = null; // reseta para reinicializar com a nova chave
      sdkLoadPromise = null;
      lastNotifiedUserId = Symbol('uninitialized');
      initSupabaseClient();
    },

    getClient() {
      return supabaseClient;
    },

    getUser() {
      return currentUser;
    },

    onAuthStateChange(callback) {
      if (typeof callback === 'function') {
        if (!authListeners.includes(callback)) {
          authListeners.push(callback);
        }
        if (lastNotifiedUserId !== Symbol('uninitialized')) {
          try { callback(currentUser); } catch (e) { console.error(e); }
        }
      }
    },

    async signIn({ email, password }) {
      await ensureSupabaseSDK();
      if (!supabaseClient) throw new Error('Cliente Supabase não inicializado.');
      
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (error) throw error;
      handleUserChange(data.user);
      return data;
    },

    async signUp({ email, password, metadata = {} }) {
      await ensureSupabaseSDK();
      if (!supabaseClient) throw new Error('Cliente Supabase não inicializado.');

      const { data, error } = await supabaseClient.auth.signUp({
        email: email.trim(),
        password,
        options: { data: metadata }
      });

      if (error) throw error;
      if (data.user) {
        handleUserChange(data.user);
      }
      return data;
    },

    async signInWithOAuth(provider = 'google') {
      await ensureSupabaseSDK();
      if (!supabaseClient) throw new Error('Cliente Supabase não inicializado.');

      const { data, error } = await supabaseClient.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin + window.location.pathname
        }
      });

      if (error) throw error;
      return data;
    },

    async signOut() {
      if (supabaseClient) {
        try { await supabaseClient.auth.signOut(); } catch (e) {}
      }
      handleUserChange(null);
    },

    // Salvar projeto no banco (tabela `projects` com RLS por dono)
    async saveProject({ id, title, data, thumbnail }) {
      if (!currentUser) {
        throw new Error('Você precisa estar autenticado para salvar na nuvem.');
      }
      await ensureSupabaseSDK();
      if (!supabaseClient) throw new Error('Cliente Supabase não inicializado.');

      const payload = {
        user_id: currentUser.id,
        title: title || 'Carrossel sem título',
        data: data || {},
        thumbnail: thumbnail || null,
        updated_at: new Date().toISOString()
      };

      if (id) {
        payload.id = id;
        const { data: res, error } = await supabaseClient
          .from('projects')
          .upsert(payload)
          .select()
          .single();
        if (error) throw error;
        return res;
      } else {
        const { data: res, error } = await supabaseClient
          .from('projects')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        return res;
      }
    },

    // Carregar lista de projetos do usuário autenticado
    async listProjects() {
      if (!currentUser) return [];
      await ensureSupabaseSDK();
      if (!supabaseClient) return [];

      const { data, error } = await supabaseClient
        .from('projects')
        .select('id, title, thumbnail, created_at, updated_at')
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('[Supabase] Erro ao listar projetos:', error);
        return [];
      }
      return data || [];
    }
  };

  // Inicializa quando a página carregar (apenas 1 vez)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureSupabaseSDK, { once: true });
  } else {
    ensureSupabaseSDK();
  }

  window.SupabaseAuth = SupabaseAuth;

})(typeof window !== 'undefined' ? window : this);
