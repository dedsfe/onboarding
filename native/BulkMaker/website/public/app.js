const form = document.querySelector('#waitlist');
const submit = form.querySelector('[type="submit"]');
const message = document.querySelector('#form-message');
const emailInput = document.querySelector('#email');
const handleInput = document.querySelector('#x-handle');

form.addEventListener('input', (event) => {
  event.target.removeAttribute('aria-invalid');
  if (message.dataset.state === 'error') {
    delete message.dataset.state;
    message.textContent = '';
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  const email = emailInput.value.trim();
  const xHandle = handleInput.value.trim().replace(/^@/, '');
  emailInput.value = email;
  handleInput.value = `@${xHandle}`;
  if (!form.reportValidity()) return;

  submit.disabled = true;
  submit.textContent = 'Salvando...';
  form.setAttribute('aria-busy', 'true');
  message.textContent = 'Adicionando você à lista.';
  delete message.dataset.state;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ email, xHandle }),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) {
      if (result.field) {
        const field = result.field === 'email' ? emailInput : handleInput;
        field.setAttribute('aria-invalid', 'true');
        field.focus();
      }
      throw new Error(result.error || 'Não foi possível salvar. Tente de novo.');
    }
    message.dataset.state = 'success';
    message.textContent = 'Vamos avisar por email.';
    submit.textContent = 'Você está na lista';
    emailInput.readOnly = true;
    handleInput.readOnly = true;
  } catch (error) {
    message.dataset.state = 'error';
    message.textContent = error.name === 'AbortError'
      ? 'A conexão demorou. Tente de novo.'
      : error instanceof TypeError ? 'Sem conexão. Tente de novo.' : error.message;
    submit.disabled = false;
    submit.textContent = 'Quero acesso';
  } finally {
    clearTimeout(timeout);
    form.removeAttribute('aria-busy');
  }
});
