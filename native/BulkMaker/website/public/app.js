const form = document.querySelector('#waitlist');
const submit = form?.querySelector('[type="submit"]');
const message = document.querySelector('#form-message');
const emailInput = document.querySelector('#email');
const handleInput = document.querySelector('#x-handle');

// Limpar estado de erro ao digitar
if (form) {
  form.addEventListener('input', (event) => {
    event.target.removeAttribute('aria-invalid');
    if (message && message.dataset.state === 'error') {
      delete message.dataset.state;
      message.textContent = '';
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const email = emailInput.value.trim();
    const rawHandle = handleInput ? handleInput.value.trim() : '';
    const xHandle = rawHandle ? rawHandle.replace(/^@/, '') : '';

    emailInput.value = email;
    if (handleInput) {
      handleInput.value = xHandle ? `@${xHandle}` : '';
    }

    if (!form.reportValidity()) return;

    submit.disabled = true;
    submit.textContent = 'Enviando...';
    form.setAttribute('aria-busy', 'true');
    message.textContent = 'Adicionando você à lista...';
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
          if (field) {
            field.setAttribute('aria-invalid', 'true');
            field.focus();
          }
        }
        throw new Error(result.error || 'Não foi possível salvar. Tente de novo.');
      }
      message.dataset.state = 'success';
      message.textContent = 'Você está na lista! Vamos avisar por e-mail quando o acesso estiver disponível.';
      submit.textContent = 'Você está na lista';
      emailInput.readOnly = true;
      if (handleInput) handleInput.readOnly = true;

      // Sincronizar header form caso esteja na página
      const headerEmail = document.querySelector('#header-email');
      const headerBtn = document.querySelector('.header-btn');
      if (headerEmail) {
        headerEmail.value = '';
        headerEmail.placeholder = 'Inscrição confirmada!';
        headerEmail.disabled = true;
      }
      if (headerBtn) {
        headerBtn.textContent = '✓ Na lista';
        headerBtn.disabled = true;
      }
    } catch (error) {
      message.dataset.state = 'error';
      message.textContent = error.name === 'AbortError'
        ? 'A conexão demorou. Tente de novo.'
        : error instanceof TypeError ? 'Sem conexão. Tente de novo.' : error.message;
      submit.disabled = false;
      submit.textContent = 'Entrar na lista de espera';
    } finally {
      clearTimeout(timeout);
      form.removeAttribute('aria-busy');
    }
  });
}

// Formulário compacto no topo (Header)
const headerForm = document.querySelector('#header-waitlist');
if (headerForm) {
  const headerEmail = headerForm.querySelector('#header-email');
  const headerSubmit = headerForm.querySelector('.header-btn');

  headerEmail?.addEventListener('input', () => {
    headerEmail.removeAttribute('aria-invalid');
  });

  headerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (headerSubmit.disabled) return;
    const email = headerEmail.value.trim();
    headerEmail.value = email;

    if (!headerForm.reportValidity()) return;

    headerSubmit.disabled = true;
    const originalText = headerSubmit.textContent;
    headerSubmit.textContent = '...';
    headerForm.setAttribute('aria-busy', 'true');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email, xHandle: '' }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) {
        headerEmail.setAttribute('aria-invalid', 'true');
        throw new Error(result.error || 'Não foi possível salvar.');
      }

      headerSubmit.textContent = '✓ Na lista';
      headerEmail.value = '';
      headerEmail.placeholder = 'Inscrição confirmada!';
      headerEmail.disabled = true;

      // Sincronizar o formulário principal
      if (emailInput) {
        emailInput.value = email;
        emailInput.readOnly = true;
      }
      if (submit) {
        submit.textContent = 'Você está na lista';
        submit.disabled = true;
      }
      if (message) {
        message.dataset.state = 'success';
        message.textContent = 'Você está na lista! Vamos avisar por e-mail quando o acesso estiver disponível.';
      }
    } catch (error) {
      headerSubmit.disabled = false;
      headerSubmit.textContent = originalText;
      headerEmail.focus();
      headerEmail.setAttribute('aria-invalid', 'true');
    } finally {
      clearTimeout(timeout);
      headerForm.removeAttribute('aria-busy');
    }
  });
}
