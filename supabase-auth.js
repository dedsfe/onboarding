/**
 * supabase-auth.js
 * Gerenciador de Autenticação e Sincronização em Nuvem (The Carousel Make / Analytics Onboard)
 * Conectado ao projeto Supabase: gukebwwqhssmbnioqalm
 */

(function (window) {
  'use strict';

  const DEFAULT_SUPABASE_URL = 'https://gukebwwqhssmbnioqalm.supabase.co';
  const DEFAULT_ANON_KEY = 'sb_publishable_goU53-qIP_OP8UaDNMPPIw_Oqz6POjj';
  const STORAGE_ANON_KEY = 'oa_supabase_anon_key';

  // Chave pública / anônima conectada ao projeto Supabase gukebwwqhssmbnioqalm
  let supabaseAnonKey = localStorage.getItem(STORAGE_ANON_KEY) || DEFAULT_ANON_KEY;
  let supabaseClient = null;
  let currentUser = null;
  let authListeners = [];

  function initSupabaseClient() {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      try {
        supabaseClient = window.supabase.createClient(DEFAULT_SUPABASE_URL, supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        });
        checkActiveSession();
      } catch (err) {
        console.warn('[Supabase] Inicialização adiada:', err);
      }
    }
  }

  // Carrega SDK do Supabase se ainda não existir na página
  function ensureSupabaseSDK() {
    return new Promise((resolve) => {
      if (window.supabase && typeof window.supabase.createClient === 'function') {
        initSupabaseClient();
        return resolve(supabaseClient);
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.async = true;
      script.onload = () => {
        initSupabaseClient();
        resolve(supabaseClient);
      };
      script.onerror = () => {
        console.error('[Supabase] Falha ao carregar CDN do Supabase JS SDK.');
        resolve(null);
      };
      document.head.appendChild(script);
    });
  }

  async function checkActiveSession() {
    if (!supabaseClient) return null;
    try {
      const { data: { session }, error } = await supabaseClient.auth.getSession();
      if (!error && session && session.user) {
        currentUser = session.user;
        notifyAuthListeners(currentUser);
        return currentUser;
      }
    } catch (e) {
      console.warn('[Supabase] Erro ao recuperar sessão:', e);
    }
    currentUser = null;
    notifyAuthListeners(null);
    return null;
  }

  function notifyAuthListeners(user) {
    authListeners.forEach(fn => {
      try { fn(user); } catch (e) { console.error(e); }
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
        authListeners.push(callback);
        if (currentUser !== undefined) callback(currentUser);
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
      currentUser = data.user;
      notifyAuthListeners(currentUser);
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
        currentUser = data.user;
        notifyAuthListeners(currentUser);
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
      currentUser = null;
      notifyAuthListeners(null);
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

  // Inicializa quando a página carregar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureSupabaseSDK);
  } else {
    ensureSupabaseSDK();
  }

  window.SupabaseAuth = SupabaseAuth;

})(typeof window !== 'undefined' ? window : this);
