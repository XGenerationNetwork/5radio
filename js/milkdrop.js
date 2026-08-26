/* ============================================================================
   5RADIO — the MilkDrop-style visual
   ----------------------------------------------------------------------------
   A port of 5OS's `js/apps/visualizer-milk.js`, which is itself an homage to
   Ryan Geiss's Winamp visualiser built from first principles. No MilkDrop code
   and no `.milk` presets are used or reproduced; what is borrowed is the
   technique, which is a well-known bit of graphics:

     1. Keep the previous frame in a texture.
     2. Draw it back into the next frame through a distorted UV mapping —
        zoom, rotate, stretch, translate, plus a sinusoidal warp — darkening
        it slightly on the way.
     3. Draw this instant's waveform on top, additively.
     4. Repeat.

   Step 2 is the whole illusion. Nothing on screen is simulated: the tunnels,
   smoke and spirals are one frame being resampled into the next a few thousand
   times, and the audio steers the warp. A shape drawn once gets dragged
   outward or inward forever by whatever the warp is doing.

   **The one change from 5OS: no three.js.** 5RADIO has no dependencies and no
   build step — that is a property worth keeping, and it turned out to cost
   nothing. The engine only ever asked three.js for an orthographic camera, a
   full-screen quad, two render targets, two shader materials and a line strip,
   which is a plain WebGL program with two framebuffers. The shaders come
   across very nearly verbatim, because GLSL is GLSL and three.js was only
   wrapping them. The presets come across exactly: they are the same numbers.

   Written in GLSL ES 1.00 with no `#version` directive, which both a WebGL1
   and a WebGL2 context accept, so this runs anywhere a canvas does.
   ========================================================================== */

(function () {
  'use strict';

  var milk = {};
  window.RADIO_MILK = milk;

  /* ------------------------------------------------------------------ */
  /* presets                                                            */
  /* ------------------------------------------------------------------ */

  /* zoom > 1 pulls the image inward (a tunnel receding); < 1 pushes it out.
     decay is how much of the old frame survives each pass, and is the single
     biggest lever on how "smoky" a preset feels. */
  var PRESETS = [
    { name: 'Aurora Well',
      zoom: 1.012, zoomBeat: 0.030, rot: 0.0016, rotBeat: 0.010,
      warp: 0.85, warpScale: 3.1, warpSpeed: 0.35,
      dx: 0, dy: 0, sx: 1, sy: 1, decay: 0.965,
      wave: 'circle', waveAmp: 0.30, waveThick: 2,
      hue: 0.55, hueRate: 0.03, sat: 0.85,
      echo: 0.18, echoZoom: 1.18, solarize: 0, invert: 0, gamma: 1.05 },
    { name: 'Iron Spiral',
      zoom: 0.994, zoomBeat: -0.022, rot: 0.0085, rotBeat: 0.018,
      warp: 0.35, warpScale: 2.0, warpSpeed: 0.22,
      dx: 0, dy: 0, sx: 1, sy: 1, decay: 0.972,
      wave: 'spiral', waveAmp: 0.22, waveThick: 1,
      hue: 0.08, hueRate: 0.012, sat: 0.70,
      echo: 0.10, echoZoom: 0.90, solarize: 0, invert: 0, gamma: 1.0 },
    { name: 'Tide Machine',
      zoom: 1.004, zoomBeat: 0.014, rot: -0.0009, rotBeat: -0.006,
      warp: 1.55, warpScale: 5.2, warpSpeed: 0.62,
      dx: 0, dy: 0, sx: 1.008, sy: 0.994, decay: 0.958,
      wave: 'dual', waveAmp: 0.34, waveThick: 2,
      hue: 0.48, hueRate: 0.05, sat: 0.9,
      echo: 0.0, echoZoom: 1.0, solarize: 0.25, invert: 0, gamma: 1.1 },
    { name: 'Lantern Drift',
      zoom: 1.0008, zoomBeat: 0.040, rot: 0.0004, rotBeat: 0.026,
      warp: 0.22, warpScale: 1.6, warpSpeed: 0.15,
      dx: 0.0016, dy: 0.0009, sx: 1, sy: 1, decay: 0.985,
      wave: 'liss', waveAmp: 0.40, waveThick: 2,
      hue: 0.13, hueRate: 0.008, sat: 0.95,
      echo: 0.30, echoZoom: 1.35, solarize: 0, invert: 0, gamma: 1.0 },
    { name: 'Static Cathedral',
      zoom: 1.020, zoomBeat: 0.010, rot: 0.0000, rotBeat: 0.004,
      warp: 0.05, warpScale: 1.0, warpSpeed: 0.08,
      dx: 0, dy: 0, sx: 1, sy: 1, decay: 0.945,
      wave: 'radial', waveAmp: 0.45, waveThick: 1,
      hue: 0.72, hueRate: 0.02, sat: 0.6,
      echo: 0.0, echoZoom: 1.0, solarize: 0, invert: 0, gamma: 1.2 },
    { name: 'Reef Bloom',
      zoom: 0.9975, zoomBeat: -0.030, rot: 0.0030, rotBeat: 0.012,
      warp: 1.15, warpScale: 4.4, warpSpeed: 0.48,
      dx: 0, dy: 0, sx: 0.996, sy: 1.004, decay: 0.976,
      wave: 'circle', waveAmp: 0.26, waveThick: 3,
      hue: 0.33, hueRate: 0.04, sat: 0.8,
      echo: 0.22, echoZoom: 1.10, solarize: 0, invert: 0, gamma: 1.0 },
    { name: 'Night Signal',
      zoom: 1.008, zoomBeat: 0.024, rot: -0.0042, rotBeat: -0.014,
      warp: 0.62, warpScale: 6.8, warpSpeed: 0.90,
      dx: 0, dy: 0, sx: 1, sy: 1, decay: 0.950,
      wave: 'dual', waveAmp: 0.50, waveThick: 1,
      hue: 0.92, hueRate: 0.06, sat: 1.0,
      echo: 0.0, echoZoom: 1.0, solarize: 0, invert: 0.18, gamma: 1.0 },
    { name: 'Slow Furnace',
      zoom: 1.0035, zoomBeat: 0.018, rot: 0.0011, rotBeat: 0.007,
      warp: 0.95, warpScale: 2.6, warpSpeed: 0.20,
      dx: 0, dy: -0.0018, sx: 1, sy: 1, decay: 0.982,
      wave: 'spiral', waveAmp: 0.30, waveThick: 2,
      hue: 0.02, hueRate: 0.010, sat: 0.9,
      echo: 0.14, echoZoom: 1.22, solarize: 0.15, invert: 0, gamma: 1.08 },
    { name: 'Paper Lanterns',
      zoom: 1.0, zoomBeat: 0.055, rot: 0.0022, rotBeat: 0.030,
      warp: 0.40, warpScale: 3.8, warpSpeed: 0.30,
      dx: 0, dy: 0, sx: 1.004, sy: 1.004, decay: 0.988,
      wave: 'radial', waveAmp: 0.38, waveThick: 2,
      hue: 0.60, hueRate: 0.025, sat: 0.75,
      echo: 0.26, echoZoom: 0.86, solarize: 0, invert: 0, gamma: 1.0 },
    { name: 'Undertow',
      zoom: 0.9955, zoomBeat: -0.040, rot: 0.0058, rotBeat: 0.022,
      warp: 1.85, warpScale: 7.5, warpSpeed: 0.75,
      dx: 0, dy: 0, sx: 1, sy: 1, decay: 0.968,
      wave: 'liss', waveAmp: 0.34, waveThick: 2,
      hue: 0.78, hueRate: 0.045, sat: 0.88,
      echo: 0.0, echoZoom: 1.0, solarize: 0.35, invert: 0, gamma: 1.15 }
  ];

  milk.PRESETS = PRESETS;

  /* Every numeric field is crossfaded when presets change, which is what makes
     a switch a slow morph rather than a cut. */
  var LERPABLE = ['zoom', 'zoomBeat', 'rot', 'rotBeat', 'warp', 'warpScale',
                  'warpSpeed', 'dx', 'dy', 'sx', 'sy', 'decay', 'waveAmp',
                  'hue', 'hueRate', 'sat', 'echo', 'echoZoom', 'solarize',
                  'invert', 'gamma'];

  /* ------------------------------------------------------------------ */
  /* shaders                                                            */
  /* ------------------------------------------------------------------ */

  var QUAD_VERT = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = aPos * 0.5 + 0.5;',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  /* The warp. Everything MilkDrop-looking comes out of these twenty lines: the
     previous frame is read from somewhere slightly *else*, and that somewhere
     is what the music moves. */
  var WARP_FRAG = [
    'precision highp float;',
    'uniform sampler2D tPrev;',
    'uniform vec2 uAspect;',
    'uniform float uZoom, uRot, uWarp, uWarpScale, uWarpSpeed, uTime, uDecay;',
    'uniform vec2 uTranslate, uStretch;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec2 uv = (vUv - 0.5) * uAspect;',
    '  uv /= uStretch;',
    '  float c = cos(uRot), s = sin(uRot);',
    '  uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);',
    '  uv /= uZoom;',
    '  float t = uTime * uWarpSpeed;',
    '  uv += uWarp * 0.012 * vec2(',
    '      sin(uv.y * uWarpScale + t) + 0.5 * cos(uv.x * uWarpScale * 1.7 - t * 1.3),',
    '      cos(uv.x * uWarpScale + t * 1.1) + 0.5 * sin(uv.y * uWarpScale * 1.3 + t * 0.7));',
    '  uv /= uAspect;',
    '  uv += 0.5 + uTranslate;',
    '  vec3 prev = texture2D(tPrev, uv).rgb * uDecay;',
    /* pixels dragged in from outside the frame must not smear the edge */
    '  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);',
    '  gl_FragColor = vec4(prev * inside, 1.0);',
    '}'
  ].join('\n');

  /* Final pass: video echo, then the cheap film tricks MilkDrop also had. */
  var POST_FRAG = [
    'precision highp float;',
    'uniform sampler2D tDiffuse;',
    'uniform float uEcho, uEchoZoom, uSolarize, uInvert, uGamma;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec3 col = texture2D(tDiffuse, vUv).rgb;',
    '  if (uEcho > 0.001) {',
    '    vec2 e = (vUv - 0.5) / uEchoZoom + 0.5;',
    '    col += texture2D(tDiffuse, e).rgb * uEcho;',
    '  }',
    '  if (uSolarize > 0.001) {',
    '    vec3 sol = abs(1.0 - 2.0 * col);',
    '    col = mix(col, 1.0 - sol, uSolarize);',
    '  }',
    '  col = mix(col, 1.0 - col, uInvert);',
    '  col = pow(max(col, 0.0), vec3(1.0 / uGamma));',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var WAVE_VERT = [
    'attribute vec2 aPos;',
    'uniform vec2 uOffset;',
    'void main() { gl_Position = vec4(aPos + uOffset, 0.0, 1.0); }'
  ].join('\n');

  var WAVE_FRAG = [
    'precision highp float;',
    'uniform vec3 uColor;',
    'uniform float uAlpha;',
    'void main() { gl_FragColor = vec4(uColor * uAlpha, 1.0); }'
  ].join('\n');

  /* ------------------------------------------------------------------ */
  /* gl helpers                                                         */
  /* ------------------------------------------------------------------ */

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('shader: ' + log);
    }
    return sh;
  }

  function program(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(p));
    }
    /* Uniform and attribute locations, looked up once. */
    p.u = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS), i;
    for (i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      p.u[info.name] = gl.getUniformLocation(p, info.name);
    }
    p.aPos = gl.getAttribLocation(p, 'aPos');
    return p;
  }

  function target(gl, w, h) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    /* LINEAR because the warp reads between pixels constantly — that
       interpolation is a good half of why the result looks smooth rather than
       blocky. CLAMP_TO_EDGE because a repeat would wrap the image onto itself
       at the borders. */
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex: tex, fb: fb, w: w, h: h };
  }

  /* three.js's Color.setHSL, which the presets are written against. */
  function hslToRgb(h, s, l) {
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
      return p;
    }
    if (s === 0) return [l, l, l];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
  }

  /* ------------------------------------------------------------------ */
  /* the engine                                                         */
  /* ------------------------------------------------------------------ */

  milk.create = function (canvas, opts) {
    opts = opts || {};
    var WAVE_POINTS = 512;
    var THICK_MAX = 3;

    var gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false }) ||
             canvas.getContext('webgl', { alpha: false, antialias: false, depth: false });
    if (!gl) return null;

    var warpP, postP, waveP;
    try {
      warpP = program(gl, QUAD_VERT, WARP_FRAG);
      postP = program(gl, QUAD_VERT, POST_FRAG);
      waveP = program(gl, WAVE_VERT, WAVE_FRAG);
    } catch (e) {
      return null;
    }

    /* one full-screen triangle pair, reused by both quad passes */
    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    var wavePos = new Float32Array(WAVE_POINTS * 2);
    var waveBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, waveBuf);
    gl.bufferData(gl.ARRAY_BUFFER, wavePos, gl.DYNAMIC_DRAW);

    var scale = opts.scale || 1;
    var width = Math.max(2, opts.width || 640);
    var height = Math.max(2, opts.height || 360);
    var rtA = null, rtB = null;
    var aspect = [1, 1];

    var cur = Object.assign({}, PRESETS[0]);
    var from = null, to = null, blend = 1, blendFor = 3.0;
    var index = 0;
    var dwell = opts.dwell || 16;
    var since = 0;
    var auto = opts.auto !== false;
    var time = 0;
    var hue = cur.hue;
    var waveMode = cur.wave;
    var speed = opts.speed > 0 ? opts.speed : 1;

    function lerp(a, b, t) { return a + (b - a) * t; }

    function applyBlend() {
      if (!to) return;
      var t = blend >= 1 ? 1 : blend;
      var e = t * t * (3 - 2 * t);                    /* smoothstep */
      LERPABLE.forEach(function (k) { cur[k] = lerp(from[k], to[k], e); });
      /* the waveform style cannot be averaged, so it flips at the midpoint */
      if (e >= 0.5 && waveMode !== to.wave) waveMode = to.wave;
      if (t >= 1) { cur.name = to.name; cur.waveThick = to.waveThick; from = null; to = null; }
    }

    function goTo(preset) {
      from = Object.assign({}, cur);
      to = Object.assign({}, preset);
      blend = 0;
      since = 0;
    }

    function next(step) {
      step = step || 1;
      index = (index + step + PRESETS.length) % PRESETS.length;
      goTo(PRESETS[index]);
    }

    /* --- waveform geometry --- */

    function buildWave(a) {
      var wf = a.waveform;
      var n = WAVE_POINTS;
      var amp = cur.waveAmp * (0.45 + a.level * 2.2);

      for (var i = 0; i < n; i++) {
        var f = i / (n - 1);
        /* the waveform is bytes around 128; centre it */
        var s = wf ? (wf[Math.floor(f * (wf.length - 1))] - 128) / 128 : 0;
        var x, y;

        if (waveMode === 'circle') {
          var ang = f * Math.PI * 2;
          var r = 0.34 + s * amp * 0.6 + a.bass * 0.10;
          x = Math.cos(ang) * r; y = Math.sin(ang) * r;
        } else if (waveMode === 'dual') {
          x = (f - 0.5) * 1.75;
          y = s * amp + (i % 2 ? 0.22 : -0.22);
        } else if (waveMode === 'spiral') {
          var sa = f * Math.PI * 8 + time * 0.4;
          var sr = 0.06 + f * 0.62 + s * amp * 0.35;
          x = Math.cos(sa) * sr; y = Math.sin(sa) * sr;
        } else if (waveMode === 'liss') {
          var j = Math.floor(f * (wf ? wf.length / 2 : 1));
          var s2 = wf ? (wf[j + Math.floor((wf.length || 4) / 4)] - 128) / 128 : 0;
          x = s * amp * 2.0;
          y = s2 * amp * 2.0;
        } else {                                       /* radial spokes */
          var spokes = 64;
          var k = Math.floor(f * spokes) / spokes;
          var ra = k * Math.PI * 2 + time * 0.15;
          var rr = 0.14 + Math.abs(s) * amp * 1.5;
          var inner = (i % 2) === 0 ? 0.10 : rr;
          x = Math.cos(ra) * inner; y = Math.sin(ra) * inner;
        }

        /* The warp works in a square space that the aspect uniform stretches;
           the waveform is drawn in clip space, so it takes the same correction
           the other way or a circle comes out an oval. */
        wavePos[i * 2] = x / aspect[0];
        wavePos[i * 2 + 1] = y / aspect[1];
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, waveBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, wavePos);
    }

    function drawQuad(p) {
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(p.aPos);
      gl.vertexAttribPointer(p.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    /* --- the frame --- */

    function render(a, dt) {
      dt = Math.min(0.05, dt || 0.016);
      time += dt;
      since += dt;

      if (to) {
        blend += dt / blendFor;
        applyBlend();
      } else if (auto && since > dwell) {
        next(1);
      }

      var beat = a.beat || 0;

      /* `speed` scales the *deviation from stillness*, not the raw numbers. A
         zoom of 1.0 is "no movement", so it is (zoom - 1) that gets multiplied;
         scaling zoom itself would push a still preset toward zero and turn the
         picture inside out rather than slowing it down. Decay is deliberately
         left alone: it is how smoky the image is, not how fast. */
      var zoom = 1 + (cur.zoom - 1 + cur.zoomBeat * beat + a.bass * 0.010) * speed;
      var rot = (cur.rot + cur.rotBeat * beat * 0.5 + (a.mid - 0.1) * 0.002) * speed;
      var decay = Math.min(0.995, cur.decay + a.level * 0.012);

      /* 1. previous frame, warped, into the write target */
      gl.bindFramebuffer(gl.FRAMEBUFFER, rtB.fb);
      gl.viewport(0, 0, rtB.w, rtB.h);
      gl.disable(gl.BLEND);
      gl.useProgram(warpP);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, rtA.tex);
      gl.uniform1i(warpP.u.tPrev, 0);
      gl.uniform2f(warpP.u.uAspect, aspect[0], aspect[1]);
      gl.uniform1f(warpP.u.uZoom, zoom);
      gl.uniform1f(warpP.u.uRot, rot);
      gl.uniform1f(warpP.u.uWarp, cur.warp * (0.6 + a.level * 2.4));
      gl.uniform1f(warpP.u.uWarpScale, cur.warpScale);
      gl.uniform1f(warpP.u.uWarpSpeed, cur.warpSpeed * speed);
      gl.uniform1f(warpP.u.uDecay, decay);
      gl.uniform1f(warpP.u.uTime, time);
      gl.uniform2f(warpP.u.uTranslate, cur.dx * speed, cur.dy * speed);
      gl.uniform2f(warpP.u.uStretch, cur.sx, cur.sy);
      drawQuad(warpP);

      /* 2. this instant's waveform, on top, additively */
      hue = (hue + dt * cur.hueRate * speed + beat * 0.02) % 1;
      var rgb = hslToRgb(hue, cur.sat, Math.min(1, 0.55 + a.level * 0.3));
      buildWave(a);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);              /* additive */
      gl.useProgram(waveP);
      gl.uniform3f(waveP.u.uColor, rgb[0], rgb[1], rgb[2]);
      gl.bindBuffer(gl.ARRAY_BUFFER, waveBuf);
      gl.enableVertexAttribArray(waveP.aPos);
      gl.vertexAttribPointer(waveP.aPos, 2, gl.FLOAT, false, 0, 0);

      /* thickness = the same line drawn again a pixel or two over. A real
         line width is not available: WebGL implementations are entitled to
         ignore lineWidth, and every desktop one does. */
      var thick = Math.max(1, Math.min(THICK_MAX, Math.round(cur.waveThick || 1)));
      for (var w = 0; w < thick; w++) {
        var off = 0.0035 * w;
        gl.uniform2f(waveP.u.uOffset, off, off);
        gl.uniform1f(waveP.u.uAlpha, (w === 0 ? 0.95 : 0.5) * (0.45 + a.level * 1.4));
        gl.drawArrays(gl.LINE_STRIP, 0, WAVE_POINTS);
      }

      /* 3. out to the screen through the post chain */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.BLEND);
      gl.useProgram(postP);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, rtB.tex);
      gl.uniform1i(postP.u.tDiffuse, 0);
      gl.uniform1f(postP.u.uEcho, cur.echo);
      gl.uniform1f(postP.u.uEchoZoom, cur.echoZoom);
      gl.uniform1f(postP.u.uSolarize, cur.solarize);
      gl.uniform1f(postP.u.uInvert, cur.invert);
      gl.uniform1f(postP.u.uGamma, cur.gamma);
      drawQuad(postP);

      /* 4. this frame becomes the previous one */
      var t = rtA; rtA = rtB; rtB = t;
    }

    function free(rt) {
      if (!rt) return;
      gl.deleteTexture(rt.tex);
      gl.deleteFramebuffer(rt.fb);
    }

    function resize(w, h) {
      width = Math.max(2, Math.floor(w));
      height = Math.max(2, Math.floor(h));
      canvas.width = width;
      canvas.height = height;

      var tw = Math.max(2, Math.floor(width * scale));
      var th = Math.max(2, Math.floor(height * scale));
      if (!rtA || rtA.w !== tw || rtA.h !== th) {
        free(rtA); free(rtB);
        rtA = target(gl, tw, th);
        rtB = target(gl, tw, th);
        /* Both start black, or the first warp samples undefined memory. */
        [rtA, rtB].forEach(function (rt) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb);
          gl.clearColor(0, 0, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
        });
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }

      /* keep the warp circular rather than oval on a wide canvas */
      var ar = width / height;
      aspect = ar >= 1 ? [ar, 1] : [1, 1 / ar];
    }

    resize(width, height);

    return {
      render: render,
      resize: resize,
      next: next,
      gl: gl,
      setAuto: function (on) { auto = !!on; since = 0; },
      auto: function () { return auto; },
      setSpeed: function (s) { speed = s > 0 ? s : 1; },
      setScale: function (s) {
        scale = Math.max(0.25, Math.min(1, s));
        var w = width, h = height;
        rtA = null;                       /* force the targets to be rebuilt */
        resize(w, h);
      },
      presetName: function () { return (to ? to.name : cur.name) || PRESETS[index].name; },
      presetIndex: function () { return index; },
      count: PRESETS.length,
      goToIndex: function (i) {
        index = ((i % PRESETS.length) + PRESETS.length) % PRESETS.length;
        goTo(PRESETS[index]);
      },
      destroy: function () {
        free(rtA); free(rtB);
        gl.deleteBuffer(quad);
        gl.deleteBuffer(waveBuf);
        [warpP, postP, waveP].forEach(function (p) { gl.deleteProgram(p); });
      }
    };
  };

})();
