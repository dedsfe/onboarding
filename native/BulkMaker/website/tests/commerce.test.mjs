import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCommerce } from '../commerce.mjs';

const configuration = () => ({ enabled: true, environment: 'test', storeID: 10, productID: 20,
  legalApproved: true, supportEmail: 'support@example.invalid', currency: 'BRL', plans: {
    monthly: { name: 'Mensal', variantID: 30, amount: 4900, interval: 'month' },
    annual: { name: 'Anual', variantID: 31, amount: 49000, interval: 'year' },
  } });
const env = { LEMON_SQUEEZY_API_KEY: randomUUID(), SITE_ORIGIN: 'https://carousel.example.invalid' };
const variant = { product_id: 20, price: 4900, is_subscription: true, interval: 'month', interval_count: 1,
  test_mode: true, has_license_keys: true, license_activation_limit: 2 };
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

test('test checkout verifies price, cadence, two Macs and adds download to the receipt', async () => {
  const calls = [];
  const commerce = createCommerce({ config: configuration(), env, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if(url.endsWith('/stores/10')) return json({data:{attributes:{currency:'BRL'}}});
    return url.endsWith('/variants/30') ? json({ data: { attributes: variant } }) : json({ data: { attributes: {
      url: 'https://store.lemonsqueezy.com/checkout/custom/test', test_mode: true, store_id: 10, variant_id: 30,
    } } });
  } });
  assert.equal(await commerce.checkout('monthly'), 'https://store.lemonsqueezy.com/checkout/custom/test');
  const payment = calls.find(call => call.url.endsWith('/checkouts'));
  const body = JSON.parse(payment.options.body).data;
  assert.equal(body.attributes.test_mode, true);
  assert.equal(body.attributes.product_options.receipt_link_url, 'https://carousel.example.invalid/download');
  assert.deepEqual(body.attributes.product_options.enabled_variants, [30]);
  assert.equal(body.relationships.variant.data.id, '30');
  assert.equal(payment.options.headers.Authorization.split(' ')[1], env.LEMON_SQUEEZY_API_KEY);
  assert.equal(commerce.plans.monthly.formattedPrice, 'R$ 49,00');
});

test('missing setup and live mode are blocked before making requests', async () => {
  for (const change of [{ enabled: false }, { legalApproved: false }, { environment: 'live' }, { storeID: 0 }]) {
    const commerce = createCommerce({ config: { ...configuration(), ...change }, env,
      fetchImpl: () => assert.fail('Network must not be called') });
    await assert.rejects(commerce.checkout('monthly'));
  }
});

test('changed provider price or product does not charge a misleading amount', async () => {
  for (const change of [{ price: 6000 }, { product_id: 99 }, { interval: 'year' }, { license_activation_limit: 3 }, { test_mode: false }]) {
    let calls = 0;
    const commerce = createCommerce({ config: configuration(), env, fetchImpl: async () => {
      calls++; return json({ data: { attributes: { ...variant, ...change } } });
    } });
    await assert.rejects(commerce.checkout('monthly'));
    assert.equal(calls, 1);
  }
});

test('provider cannot redirect to an arbitrary host or return live checkout', async () => {
  for (const change of [{ url: 'https://evil.invalid' }, { test_mode: false }, { store_id: 99 }, { variant_id: 99 }]) {
    const commerce = createCommerce({ config: configuration(), env, fetchImpl: async url => url.endsWith('/stores/10') ? json({data:{attributes:{currency:'BRL'}}}) : url.endsWith('/variants/30')
      ? json({ data: { attributes: variant } })
      : json({ data: { attributes: { url: 'https://store.lemonsqueezy.com/test', test_mode: true, store_id: 10, variant_id: 30, ...change } } }) });
    await assert.rejects(commerce.checkout('monthly'));
  }
});

test('renewal requires this instance and the same customer and order item', async () => {
  const calls = [];
  const commerce = createCommerce({ config: configuration(), env, fetchImpl: async (url, options) => {
    calls.push({url,options});
    if (url.includes('/licenses/validate')) return json({valid:true, instance:{id:'this-mac'}, meta:{store_id:10,product_id:20,variant_id:30,order_item_id:40,customer_id:50}});
    return json({data:[{attributes:{store_id:10,product_id:20,order_item_id:40,customer_id:50,test_mode:true,status:'active',renews_at:'2026-11-01T00:00:00Z'}}]});
  } });
  assert.deepEqual(await commerce.subscription({license_key:'dummy',instance_id:'this-mac'}), {renewsAt:'2026-11-01T00:00:00Z',status:'active'});
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.match(calls[1].url, /filter%5Border_item_id%5D=40/);
  await assert.rejects(commerce.subscription({license_key:'dummy',instance_id:'other-mac'}));
});

test('store currency mismatch blocks checkout before creating a payment link', async () => {
 let calls=0;
 const commerce=createCommerce({config:configuration(),env,fetchImpl:async url=>{
  calls++;
  return url.endsWith('/variants/30') ? json({data:{attributes:variant}}) : json({data:{attributes:{currency:'USD'}}});
 }});
 await assert.rejects(commerce.checkout('monthly'));
 assert.equal(calls,2);
});
