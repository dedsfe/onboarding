// Progressive enhancement flag
document.documentElement.classList.add('js');

// Header backdrop effect on scroll
const nav = document.querySelector('.nav');
if (nav) {
  const onScroll = () => {
    if (window.scrollY > 20) {
      nav.classList.add('is-scrolled');
    } else {
      nav.classList.remove('is-scrolled');
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// Scroll reveals: fade + subtle rise + blur(8px) -> 0
if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches && 'IntersectionObserver' in window) {
  const reveals = document.querySelectorAll('.reveal');
  const revealObserver = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      }
    });
  }, {
    rootMargin: '0px 0px -40px 0px',
    threshold: 0.08,
  });
  reveals.forEach(el => revealObserver.observe(el));
} else {
  document.querySelectorAll('.reveal').forEach(el => el.classList.add('is-visible'));
}

// Exemplos de pedidos ao terminal com transição de desfoque
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
    promptText.classList.add('prompt-blur-out');
    setTimeout(() => {
      index = (index + 1) % prompts.length;
      promptText.textContent = prompts[index];
      promptText.classList.remove('prompt-blur-out');
    }, 320);
  }, 4400);
}

// Calendário: as miniaturas de posts aparecem uma a uma em loop lento
function initCalendarAnimation() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const calendarPanel = document.querySelector('.calendar-panel');
  if (!calendarPanel) return;

  const posts = Array.from(calendarPanel.querySelectorAll('.calendar-post'));
  if (posts.length === 0) return;

  calendarPanel.classList.add('has-animated-posts');

  let active = false;
  let timer = null;
  let currentStep = 0;

  function cycle() {
    if (!active) return;
    if (currentStep < posts.length) {
      posts[currentStep].classList.add('is-active');
      currentStep++;
      timer = setTimeout(cycle, 850);
    } else {
      timer = setTimeout(() => {
        if (!active) return;
        posts.forEach(p => p.classList.remove('is-active'));
        currentStep = 0;
        timer = setTimeout(cycle, 500);
      }, 3500);
    }
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        active = true;
        posts.forEach(p => p.classList.remove('is-active'));
        currentStep = 0;
        clearTimeout(timer);
        cycle();
      } else {
        active = false;
        clearTimeout(timer);
        posts.forEach(p => p.classList.add('is-active'));
      }
    });
  }, { threshold: 0.15 });

  observer.observe(calendarPanel);
}
initCalendarAnimation();

// Atalho leva suavemente ao formulário existente e foca o e-mail
for (const link of document.querySelectorAll('a[href="#lista-de-espera"]')) {
  link.addEventListener('click', () => {
    setTimeout(() => {
      document.querySelector('#email')?.focus({ preventScroll: false });
    }, 400);
  });
}
