const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderSitePage(html, config) {
  const email = config.supportEmail;
  const contact = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)
    ? `<a href="mailto:${escapeHTML(email)}">${escapeHTML(email)}</a>` : 'Contato de suporte em preparação';
  return html.replaceAll('{{SUPPORT_CONTACT}}', contact)
    .replaceAll('{{LEGAL_NOTE}}', config.legalApproved ? '' : '<p class="review-note">Documento em revisão para o lançamento.</p>');
}
