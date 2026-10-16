const slides = [...document.querySelectorAll('#sample-track img')];
const controls = document.querySelector('.sample-controls');
if (controls && slides.length) {
  controls.hidden = false;
  let selected = 0;
  controls.addEventListener('click', event => {
    const button = event.target.closest('[data-step]');
    if (!button) return;
    selected = (selected + Number(button.dataset.step) + slides.length) % slides.length;
    slides.forEach((slide, i) => { slide.hidden = i !== selected; });
    document.querySelector('#slide-position').textContent = `${selected + 1} / ${slides.length}`;
  });
}
for (const form of document.querySelectorAll('.checkout-form')) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    if (button.disabled) return;
    const message = document.querySelector('#checkout-message');
    const label = button.textContent;
    button.disabled = true; button.textContent = 'Abrindo checkout…';
    try {
      const response = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.lemonsqueezy.com')) throw new Error('Checkout inválido.');
      window.location.assign(url.href);
    } catch (error) {
      message.textContent = error.message || 'Não foi possível abrir o checkout. Tente novamente.';
      button.disabled = false; button.textContent = label;
    }
  });
}
const hero = document.querySelector('.hero');
if (hero && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
  hero.addEventListener('pointermove', event => {
    const bounds = hero.getBoundingClientRect();
    hero.style.setProperty('--painting-x', `${((event.clientX - bounds.left) / bounds.width - .5) * 8}px`);
    hero.style.setProperty('--painting-y', `${((event.clientY - bounds.top) / bounds.height - .5) * 8}px`);
  });
  hero.addEventListener('pointerleave', () => {
    hero.style.setProperty('--painting-x', '0px'); hero.style.setProperty('--painting-y', '0px');
  });
}
