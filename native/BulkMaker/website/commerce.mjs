import { readFile } from 'node:fs/promises';

export class CommerceError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}

export async function readCommerceConfig() {
  return JSON.parse(await readFile(new URL('./commerce.config.json', import.meta.url), 'utf8'));
}

export function createCommerce({ config, env = process.env, fetchImpl = fetch }) {
  const test = config.environment === 'test';
  const privateReady = Boolean(env.LEMON_SQUEEZY_API_KEY && config.storeID > 0 && config.productID > 0);
  const enabled = Boolean(privateReady && config.enabled && config.legalApproved && config.supportEmail
    && (test || (config.environment === 'live' && env.LEMON_ALLOW_LIVE === 'true')));
  const plans = Object.fromEntries(Object.entries(config.plans).map(([id, plan]) => [id, {
    ...plan, available: enabled && plan.variantID > 0 && Number.isSafeInteger(plan.amount) && plan.amount > 0,
    formattedPrice: Number.isSafeInteger(plan.amount) && plan.amount > 0
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: config.currency }).format(plan.amount / 100)
      : 'Preço em definição',
  }]));
  const annualSaving = plans.monthly.amount > 0 && plans.annual.amount > 0
    ? Math.round((1 - plans.annual.amount / (12 * plans.monthly.amount)) * 100) : 0;
  if (annualSaving <= 0) plans.annual.available = false;

  async function api(path, options = {}) {
    const response = await fetchImpl(`https://api.lemonsqueezy.com/v1/${path}`, {
      ...options, redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${env.LEMON_SQUEEZY_API_KEY}`, ...options.headers },
    });
    if (!response.ok) throw new CommerceError('O pagamento está indisponível no momento. Tente novamente.');
    return response.json();
  }

  async function checkout(planID) {
    const plan = plans[planID];
    if (!plan) throw new CommerceError('Plano não encontrado.', 404);
    if (!plan.available) throw new CommerceError('As assinaturas ainda não estão disponíveis. Entre na lista para receber o aviso.');
    let origin;
    try { origin = new URL(env.SITE_ORIGIN); } catch { throw new CommerceError('O checkout ainda está sendo preparado.'); }
    if (origin.protocol !== 'https:') throw new CommerceError('O checkout ainda está sendo preparado.');
    // One source of prices in commerce.config.json. Verify against the provider before charging.
    const variant = (await api(`variants/${plan.variantID}`)).data?.attributes;
    if (!variant || variant.product_id !== config.productID || variant.price !== plan.amount
      || !variant.is_subscription || variant.interval !== plan.interval || variant.interval_count !== 1
      || variant.test_mode !== test || !variant.has_license_keys || variant.license_activation_limit !== 2) {
      throw new CommerceError('A configuração deste plano está sendo atualizada. Tente novamente mais tarde.');
    }
    const store = (await api(`stores/${config.storeID}`)).data?.attributes;
    if (store?.currency !== config.currency) throw new CommerceError('A moeda deste plano está sendo atualizada. Tente novamente mais tarde.');
    const result = await api('checkouts', { method: 'POST', body: JSON.stringify({ data: {
      type: 'checkouts', attributes: {
        test_mode: test,
        product_options: { enabled_variants: [plan.variantID], redirect_url: new URL('/download?compra=concluida', origin).href,
          receipt_button_text: 'Baixar The Carousel Maker', receipt_link_url: new URL('/download', origin).href,
          receipt_thank_you_note: 'A chave de licença está neste recibo. Instale o app e ative a chave em Conta e assinatura.' },
        checkout_options: { locale: 'pt', embed: false, subscription_preview: true, skip_trial: true,
          button_color: '#303d2d', button_text_color: '#ffffff' },
      }, relationships: { store: { data: { type: 'stores', id: String(config.storeID) } },
        variant: { data: { type: 'variants', id: String(plan.variantID) } } },
    } }) });
    const value = result.data?.attributes;
    let url;
    try { url = new URL(value?.url); } catch { throw new CommerceError('Não foi possível abrir o checkout.'); }
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.lemonsqueezy.com') || url.username || url.password
      || value.test_mode !== test || value.store_id !== config.storeID || value.variant_id !== plan.variantID) {
      throw new CommerceError('Não foi possível confirmar o checkout.');
    }
    return url.href;
  }

  async function subscription({ license_key, instance_id }) {
    if (!privateReady) throw new CommerceError('Os dados da assinatura estão indisponíveis.');
    if (typeof license_key !== 'string' || typeof instance_id !== 'string'
      || !license_key || !instance_id || license_key.length > 512 || instance_id.length > 128) {
      throw new CommerceError('Licença inválida.', 400);
    }
    const response = await fetchImpl('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ license_key, instance_id }),
    });
    if (!response.ok) throw new CommerceError('Não foi possível validar a licença.', 403);
    const license = await response.json();
    const meta = license.meta;
    if (!license.valid || license.instance?.id !== instance_id || meta?.store_id !== config.storeID
      || meta?.product_id !== config.productID || !Object.values(config.plans).some(p => p.variantID === meta?.variant_id)
      || !Number.isSafeInteger(meta?.order_item_id)) throw new CommerceError('Licença inválida.', 403);
    const query = new URLSearchParams({ 'filter[store_id]': config.storeID, 'filter[order_item_id]': meta.order_item_id });
    const subscriptions = (await api(`subscriptions?${query}`)).data;
    const match = Array.isArray(subscriptions) ? subscriptions.find(s => s.attributes?.order_item_id === meta.order_item_id
      && s.attributes?.customer_id === meta.customer_id && s.attributes?.store_id === config.storeID
      && s.attributes?.product_id === config.productID && s.attributes?.test_mode === test) : undefined;
    if (!match) throw new CommerceError('Assinatura não encontrada.', 404);
    return { renewsAt: match.attributes.cancelled ? null : match.attributes.renews_at,
      status: match.attributes.status };
  }

  return { plans, test, checkout, subscription, config, annualSaving };
}
