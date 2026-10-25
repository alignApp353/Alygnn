/* Alygnn bottom-sheet swipe-to-dismiss. Candidates and employers share this behavior.
 * Only explicitly marked drag handles are affected. Page close handlers remain
 * authoritative so existing focus, navigation and scroll locking are preserved.
 */
(function () {
  'use strict';
  if (window.__alygnnSheetSwipeInstalled) return;
  window.__alygnnSheetSwipeInstalled = true;

  const HANDLE = '.candidate-settings-sheet-handle, .sheet-handle, .sheet-grip';
  const closeButtonBySheet = {
    'candidate-sheet': '#close-candidate',
    'job-preview-sheet': '#close-job-preview',
    'team-sheet': '#close-team-sheet',
    'notifications-sheet': '#close-notifications',
    'privacy-sheet': '#close-privacy-sheet',
    'support-sheet': '#close-support-sheet',
    'about-sheet': '#close-about-sheet'
  };

  function locate(handle) {
    const panel = handle.closest('.candidate-settings-sheet, .sheet-panel, .sheet');
    const overlay = handle.closest('.candidate-settings-sheet-backdrop, .sheet-backdrop, .sheet[id]');
    if (!panel || !overlay) return null;
    if (overlay.hidden || (overlay.classList.contains('sheet-backdrop') && !overlay.classList.contains('open'))) return null;
    return { panel, overlay };
  }

  function dismiss(overlay) {
    const id = overlay.id;
    if (id === 'candidate-appearance-sheet' && typeof window.closeCandidateAppearanceSheet === 'function') {
      window.closeCandidateAppearanceSheet();
      return;
    }
    if (id === 'appearance-sheet' && typeof window.closeAppearance === 'function') {
      window.closeAppearance();
      return;
    }
    const selector = closeButtonBySheet[id];
    const button = selector && overlay.querySelector(selector);
    if (button) {
      button.click();
      return;
    }
    // Avoid bypassing a page's close cleanup for unrecognized sheets.
    console.warn('Alygnn: no close action available for sheet', id || 'unknown');
  }

  function setup(handle) {
    if (handle.dataset.alygnnSwipeReady === '1') return;
    handle.dataset.alygnnSwipeReady = '1';
    handle.classList.add('alygnn-sheet-swipe-handle');
    handle.setAttribute('role', 'button');
    handle.setAttribute('tabindex', '0');
    handle.setAttribute('aria-label', 'Swipe down to close');

    let gesture = null;
    let settleTimer = 0;
    function restore(panel, restoreStyle) {
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = 0; }
      panel.style.transform = restoreStyle.transform;
      panel.style.transition = restoreStyle.transition;
      panel.style.willChange = restoreStyle.willChange;
    }
    handle.addEventListener('pointerdown', function (event) {
      if (event.button !== undefined && event.button !== 0) return;
      const found = locate(handle);
      if (!found) return;
      const {panel,overlay} = found;
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = 0; }
      const original = { transform:panel.style.transform, transition:panel.style.transition, willChange:panel.style.willChange };
      gesture = {pointerId:event.pointerId,startY:event.clientY,lastY:event.clientY,startTime:performance.now(),panel,overlay,original};
      panel.style.transition = 'none';
      panel.style.willChange = 'transform';
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault();
    });
    handle.addEventListener('pointermove', function (event) {
      const g = gesture;
      if (!g || event.pointerId !== g.pointerId) return;
      g.lastY = event.clientY;
      const delta = Math.max(0,event.clientY-g.startY);
      // Avoid overscrolling a tall sheet off screen before the gesture ends.
      g.panel.style.transform = 'translate3d(0,' + Math.min(delta,innerHeight) + 'px,0)';
      event.preventDefault();
    });
    function finish(event,cancelled) {
      const g=gesture;
      if (!g || event.pointerId !== g.pointerId) return;
      gesture=null;
      const delta=Math.max(0,g.lastY-g.startY);
      const duration=Math.max(1,performance.now()-g.startTime);
      const velocity=delta/duration;
      const close=!cancelled && (delta>Math.min(110,g.panel.getBoundingClientRect().height*.25) || (delta>=45 && velocity>.6));
      try { handle.releasePointerCapture(event.pointerId); } catch (_) {}
      const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      g.panel.style.transition=reduce?'none':'transform 170ms cubic-bezier(.2,.75,.2,1)';
      if(close) {
        g.panel.style.transform='translate3d(0,'+Math.ceil(innerHeight)+'px,0)';
        settleTimer=setTimeout(function(){
          dismiss(g.overlay);
          restore(g.panel,g.original);
        }, reduce ? 0 : 175);
      } else {
        g.panel.style.transform=g.original.transform || 'translate3d(0,0,0)';
        settleTimer=setTimeout(function(){ restore(g.panel,g.original); },reduce ? 0 : 180);
      }
    }
    handle.addEventListener('pointerup',function(event){finish(event,false);});
    handle.addEventListener('pointercancel',function(event){finish(event,true);});
    handle.addEventListener('keydown',function(event){
      if(event.key==='Enter'||event.key===' '||event.key==='Escape'){
        const found=locate(handle);
        if(!found)return;
        event.preventDefault();
        dismiss(found.overlay);
      }
    });
  }

  function init() {
    const style=document.createElement('style');
    style.id='alygnn-sheet-swipe-style';
    // The invisible touch target extends around the existing visible grip; no
    // changes to the line's size, positioning, color, or parent layout.
    style.textContent = '.alygnn-sheet-swipe-handle{position:relative!important;touch-action:none!important;cursor:grab}.alygnn-sheet-swipe-handle:active{cursor:grabbing}.alygnn-sheet-swipe-handle::after{content:"";position:absolute;left:50%;top:50%;width:112px;height:36px;transform:translate(-50%,-50%);background:transparent}.alygnn-sheet-swipe-handle:focus-visible{outline:2px solid #5D7FA3;outline-offset:8px}';
    document.head.appendChild(style);
    document.querySelectorAll(HANDLE).forEach(setup);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
