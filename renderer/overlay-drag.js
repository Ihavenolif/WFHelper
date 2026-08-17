(function () {
  window.installOverlayDrag = function installOverlayDrag(options) {
    let dragging = false;
    let dragButton = -1;
    let lastScreenX = 0;
    let lastScreenY = 0;
    let pendingDx = 0;
    let pendingDy = 0;
    let flushScheduled = false;

    function isInteractive() {
      return !!options.isInteractive();
    }

    // one move per frame; per-mousemove moves outpace the OS and rubber-band
    function flushMove() {
      flushScheduled = false;
      if (pendingDx === 0 && pendingDy === 0) return;
      const dx = pendingDx;
      const dy = pendingDy;
      pendingDx = 0;
      pendingDy = 0;
      options.moveBy(dx, dy);
    }

    function stopDragging() {
      dragging = false;
      dragButton = -1;
      pendingDx = 0;
      pendingDy = 0;
      document.documentElement.classList.remove("is-overlay-dragging");
    }

    document.addEventListener("contextmenu", (event) => {
      if (isInteractive()) event.preventDefault();
    });

    // Main logs overlay console warnings; one line per event kind per mode change.
    // No line at all means the window never received the input.
    const logged = { mousemove: null, mousedown: null };

    function logFirstInput(kind) {
      const interactive = isInteractive();
      if (logged[kind] === interactive) return;
      logged[kind] = interactive;
      console.warn(`[Overlay] ${kind} reached the dom interactive=${interactive}`);
    }

    // A content change fires a synthetic move at the resting cursor, which says
    // nothing about routing; only a move with a delta is real pointer input.
    document.addEventListener(
      "mousemove",
      (event) => {
        if (!event.movementX && !event.movementY) return;
        logFirstInput("mousemove");
      },
      true,
    );
    document.addEventListener("mousedown", () => logFirstInput("mousedown"), true);

    document.addEventListener("mousedown", (event) => {
      if (!isInteractive()) return;
      if (event.button !== 0 && event.button !== 2) return;
      // Left-drag must not swallow real controls; right-drag works anywhere.
      if (
        event.button === 0 &&
        event.target instanceof Element &&
        event.target.closest("button, a, input, select, [data-no-drag]")
      ) {
        return;
      }
      event.preventDefault();
      dragging = true;
      dragButton = event.button;
      lastScreenX = event.screenX;
      lastScreenY = event.screenY;
      document.documentElement.classList.add("is-overlay-dragging");
    });

    document.addEventListener("mousemove", (event) => {
      if (!dragging) return;
      const buttonMask = dragButton === 0 ? 1 : 2;
      if (!isInteractive() || (event.buttons & buttonMask) === 0) {
        stopDragging();
        return;
      }

      pendingDx += event.screenX - lastScreenX;
      pendingDy += event.screenY - lastScreenY;
      lastScreenX = event.screenX;
      lastScreenY = event.screenY;
      if (!flushScheduled) {
        flushScheduled = true;
        requestAnimationFrame(flushMove);
      }
    });

    document.addEventListener("mouseup", (event) => {
      if (event.button === dragButton) stopDragging();
    });

    window.addEventListener("blur", stopDragging);
  };
})();
