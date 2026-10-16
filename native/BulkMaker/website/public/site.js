// Hero: the prompt box cycles through things people ask the app.
const promptText = document.querySelector('#prompt-text');
if (promptText && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
  const prompts = [
    'Crie 30 carrosséis no estilo dessa referência, com as minhas fotos',
    'Ache 10 contas de oração com mais de 1M de views este mês',
    'Baixe os 5 melhores carrosséis do @versoofc e me diga os ganchos',
    'Agende 6 posts por dia no Instagram, começando amanhã',
    'Qual formato de carrossel mais viraliza em academia?',
  ];
  let index = 0;
  setInterval(() => {
    promptText.style.opacity = '0';
    setTimeout(() => {
      index = (index + 1) % prompts.length;
      promptText.textContent = prompts[index];
      promptText.style.opacity = '1';
    }, 300);
  }, 3200);
}

// Pricing: monthly / annual switch on the Pro card.
for (const plan of document.querySelectorAll('.plan[data-billing]')) {
  plan.querySelector('.toggle').addEventListener('click', event => {
    const button = event.target.closest('[data-set]');
    if (!button) return;
    plan.dataset.billing = button.dataset.set;
    for (const option of plan.querySelectorAll('[data-set]')) option.setAttribute('aria-pressed', String(option === button));
  });
}
