// Exemplos de pedidos ao terminal, sempre visíveis e sem simular controles.
const promptText = document.querySelector('#prompt-text');
if (promptText && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
  const prompts = [
    'Crie 30 carrosséis no estilo dessa referência, com as minhas fotos',
    'Encontre carrosséis que mostram apps de produtividade',
    'Traga slides, textos e métricas dessas referências para o canvas',
    'Organize os arquivos e horários da próxima semana no calendário',
    'Encontre relatos pessoais sobre organização da rotina',
  ];
  let index = 0;
  setInterval(() => {
    index = (index + 1) % prompts.length;
    promptText.textContent = prompts[index];
  }, 4200);
}

// O atalho leva ao formulário existente, sem modal.
for (const link of document.querySelectorAll('a[href="#lista-de-espera"]')) {
  link.addEventListener('click', () => {
    document.querySelector('#email').focus({ preventScroll: true });
  });
}
