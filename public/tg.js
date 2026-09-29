(() => {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp;

  function sync() {
    if (!tg || !tg.MainButton) return;
    const can = window.PrizeWheel && window.PrizeWheel.canSpin();
    const spinning = window.PrizeWheel && window.PrizeWheel.isSpinning();
    tg.MainButton.setText(spinning ? 'Spinning…' : '🎡 Spin');
    if (can) {
      tg.MainButton.enable();
      tg.MainButton.show();
    } else {
      tg.MainButton.disable();
      if (!spinning) tg.MainButton.hide();
      else tg.MainButton.show();
    }
  }

  function onWin(result, signature, autoclose) {
    if (!tg) return;
    try {
      tg.sendData(JSON.stringify({ result, signature }));
    } catch {
      // sendData only works when launched as a keyboard WebApp from a bot
    }
    if (autoclose) {
      try { tg.close(); } catch { /* ignore */ }
    }
  }

  if (tg) {
    try {
      tg.ready();
      tg.expand();
      if (tg.themeParams && tg.themeParams.bg_color) {
        document.body.style.background = tg.themeParams.bg_color;
      }
      tg.MainButton.onClick(() => {
        if (window.PrizeWheel) window.PrizeWheel.spin();
      });
      sync();
    } catch (e) {
      console.warn('Telegram WebApp init skipped', e);
    }
  }

  window.PrizeWheelTG = { sync, onWin, present: !!tg };
})();
