/* ==========================================================================
   LABORATÓRIO DE SHADER — abre pelo menu da conta, fecha no X ou Esc
   ========================================================================== */
(function () {
  function init() {
    const lab = document.getElementById('shader-lab');
    const openBtn = document.getElementById('canvas-user-action-shader-lab');
    const closeBtn = document.getElementById('shader-lab-close');
    const popover = document.getElementById('canvas-user-popover');
    if (!lab || !openBtn) return;

    function open() {
      if (popover) popover.classList.remove('is-open');
      lab.classList.add('is-open');
    }

    function close() {
      lab.classList.remove('is-open');
    }

    openBtn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lab.classList.contains('is-open')) close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
