/* ============================================================================
   5RADIO — living inside 5OS
   ----------------------------------------------------------------------------
   When 5OS frames this page as an app, its on-screen keyboard cannot reach in:
   putting a keystroke into another origin's frame is a security boundary, not a
   gap. What 5OS may do is postMessage the key, and the framed page dispatches it
   itself. This file is that listener.

   The catch, and the reason this is more than the ten-line snippet from the 5OS
   README: **a synthetic KeyboardEvent is untrusted, and an untrusted key event
   performs no default action.** Dispatching the event makes 5RADIO's own
   shortcuts fire (SPACE, R, S, arrows all read the event), but nothing appears
   in the SEARCH box, the REGION dial does not move, and the volume fader does
   not slide -- because those are default actions the browser declines to
   perform for a fake event.

   So the bridge does what 5OS itself does when the frame happens to be
   same-origin (js/apps/keyboard.js): dispatch the real event first so shortcuts
   and preventDefault work exactly as from a physical keyboard, and only if
   nobody claimed it, carry out the default action by hand.

   5OS posts one message kind, `5os-key`. Nothing else is invented here.
   ========================================================================== */

(function () {
  'use strict';

  var framed = (function () {
    try { return window.self !== window.top; } catch (e) { return true; }
  })();

  /* Input types where the selection API works. type=range and type=number
   * report no selection and throw on setRangeText, so they are handled as
   * controls further down rather than as text. */
  var TEXT_TYPES = {
    text: 1, search: 1, url: 1, tel: 1, password: 1, email: 1, '': 1
  };

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.k !== '5os-key') return;

    /* Only our embedder drives this keyboard. 5OS posts from the parent window
     * into the frame, so that is the only source worth listening to. */
    if (framed && e.source !== window.parent) return;

    var target = document.activeElement || document.body;

    /* 5OS's own field names -- do not rename them. */
    var event = new KeyboardEvent('keydown', {
      key: d.key, code: d.code, keyCode: d.keyCode, which: d.keyCode,
      shiftKey: !!d.shiftKey, ctrlKey: !!d.ctrlKey, altKey: !!d.altKey,
      metaKey: !!d.metaKey, repeat: !!d.repeat,
      bubbles: true, cancelable: true, composed: true
    });

    var wentThrough = target.dispatchEvent(event);

    /* preventDefault means the page claimed the key -- SPACE with the boombox
     * focused, for instance, which toggles play and must not also type a space
     * somewhere. */
    if (wentThrough && !d.ctrlKey && !d.metaKey && !d.altKey) {
      applyDefault(target, d.key);
    }

    target.dispatchEvent(new KeyboardEvent('keyup', {
      key: d.key, code: d.code, keyCode: d.keyCode, which: d.keyCode,
      shiftKey: !!d.shiftKey, ctrlKey: !!d.ctrlKey, altKey: !!d.altKey,
      metaKey: !!d.metaKey, repeat: !!d.repeat,
      bubbles: true, cancelable: true, composed: true
    }));
  });

  /* Perform the default action the browser skipped, for the four kinds of
   * control 5RADIO actually has: the search box, the three dials, the volume
   * fader, and the buttons. */
  function applyDefault(el, key) {
    if (!el || typeof key !== 'string') return;

    var tag = (el.tagName || '').toLowerCase();
    var type = (el.type || '').toLowerCase();

    if (el.isContentEditable) return editContentEditable(key);
    if (tag === 'textarea' || (tag === 'input' && TEXT_TYPES[type])) return editText(el, key);
    if (tag === 'input' && type === 'range') return nudgeRange(el, key);
    if (tag === 'select') return moveSelect(el, key);
    if (tag === 'button' || tag === 'a') return activate(el, key);
  }

  /* ------------------------------------------------------------ text boxes */

  /* Ported from 5OS's js/apps/keyboard.js so a key behaves the same whether the
   * frame is same-origin (5OS edits directly) or cross-origin (this file does). */
  function editText(el, key) {
    if (el.readOnly || el.disabled) return;

    var start, end;
    try {
      start = el.selectionStart;
      end = el.selectionEnd;
    } catch (e) { return; }
    if (start === null || start === undefined) return;

    if (key.length === 1) {
      el.setRangeText(key, start, end, 'end');
    } else if (key === 'Backspace') {
      if (start === end && start > 0) el.setRangeText('', start - 1, end, 'end');
      else el.setRangeText('', start, end, 'end');
    } else if (key === 'Delete') {
      if (start === end) el.setRangeText('', start, Math.min(end + 1, el.value.length), 'end');
      else el.setRangeText('', start, end, 'end');
    } else if (key === 'ArrowLeft') {
      var l = Math.max(0, start - 1);
      el.setSelectionRange(l, l);
      return;                                   // caret moves fire no input event
    } else if (key === 'ArrowRight') {
      var r = Math.min(el.value.length, end + 1);
      el.setSelectionRange(r, r);
      return;
    } else if (key === 'Home') {
      el.setSelectionRange(0, 0);
      return;
    } else if (key === 'End') {
      el.setSelectionRange(el.value.length, el.value.length);
      return;
    } else {
      return;
    }

    /* 5RADIO filters on `input`, so the event matters as much as the text. */
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function editContentEditable(key) {
    try {
      if (key.length === 1) document.execCommand('insertText', false, key);
      else if (key === 'Enter') document.execCommand('insertLineBreak');
      else if (key === 'Backspace') document.execCommand('delete');
    } catch (e) { /* an editor that refuses is not an error */ }
  }

  /* --------------------------------------------------------- the VOL fader */

  function nudgeRange(el, key) {
    var step = Number(el.step) || 1;
    var min = el.min === '' ? 0 : Number(el.min);
    var max = el.max === '' ? 100 : Number(el.max);
    var value = Number(el.value);
    var next = value;

    if (key === 'ArrowRight' || key === 'ArrowUp') next = value + step;
    else if (key === 'ArrowLeft' || key === 'ArrowDown') next = value - step;
    else if (key === 'PageUp') next = value + step * 10;
    else if (key === 'PageDown') next = value - step * 10;
    else if (key === 'Home') next = min;
    else if (key === 'End') next = max;
    else return;

    next = Math.max(min, Math.min(max, next));
    if (next === value) return;

    el.value = String(next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* ------------------------------------------------ the GENRE/REGION dials */

  function moveSelect(el, key) {
    if (el.disabled) return;
    var i = el.selectedIndex;
    var next = i;

    if (key === 'ArrowDown' || key === 'ArrowRight') next = i + 1;
    else if (key === 'ArrowUp' || key === 'ArrowLeft') next = i - 1;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = el.options.length - 1;
    else if (key.length === 1) next = findByPrefix(el, key, i);
    else return;

    if (next < 0 || next >= el.options.length || next === i) return;

    el.selectedIndex = next;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* Type-ahead: "j" jumps to Jazz, the way a real select behaves. Starts after
   * the current option so repeated presses cycle through the matches. */
  function findByPrefix(el, char, from) {
    var needle = char.toLowerCase();
    var n = el.options.length;
    for (var step = 1; step <= n; step++) {
      var idx = (from + step) % n;
      if ((el.options[idx].text || '').trim().toLowerCase().indexOf(needle) === 0) return idx;
    }
    return from;
  }

  /* ------------------------------------------------------------- buttons */

  /* SPACE never reaches here for a button -- 5RADIO's own handler claims it for
   * play/pause -- so this is really about ENTER on a focused key or link. */
  function activate(el, key) {
    if (key !== 'Enter') return;
    if (el.disabled) return;
    el.click();
  }
})();
