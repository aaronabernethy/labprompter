const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeOut = (k) => 1 - Math.pow(1 - k, 3);

export class Prompter {
  constructor(els, getSettings, hooks) {
    this.els = els;
    this.s = getSettings;
    this.hooks = hooks;

    this.active = false;
    this.pos = 0;
    this.max = 1;
    this.lineY = 0;
    this.playing = false;
    this.dir = 1;
    this.shuttleDetent = 0;
    this.jumps = [];
    this.tween = null;
    this._raf = null;
    this._lastT = 0;
    this._cursorTimer = null;

    this._onResize = () => {
      if (this.active) this.measure();
    };
    this._wake = () => {
      this.els.presentView.classList.remove('hide-cursor');
      clearTimeout(this._cursorTimer);
      if (this.active) {
        this._cursorTimer = setTimeout(() => this.els.presentView.classList.add('hide-cursor'), 1800);
      }
    };
    this._tick = this._tick.bind(this);
  }

  enter() {
    this.active = true;
    this.pos = 0;
    this.playing = false;
    this.dir = 1;
    this.tween = null;
    window.addEventListener('resize', this._onResize);
    this.els.presentView.addEventListener('mousemove', this._wake);
    this.measure();
    this._wake();
    this._lastT = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  exit() {
    this.active = false;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this.els.presentView.removeEventListener('mousemove', this._wake);
    clearTimeout(this._cursorTimer);
    this.els.presentView.classList.remove('hide-cursor');
  }

  measure() {
    const s = this.s();
    this.lineY = this.els.promptViewport.clientHeight * (s.readingLinePct / 100);
    this.max = Math.max(0, this.els.promptContent.offsetHeight);
    this.jumps = [...this.els.promptContent.querySelectorAll('.jump')]
      .map((el) => el.offsetTop)
      .sort((a, b) => a - b);
    this.pos = clamp(this.pos, 0, this.max);
    this.apply();
  }

  // Re-measure after a layout-affecting change (font size, caps) while
  // keeping the reading position at the same fraction of the script.
  remeasurePreserve() {
    if (!this.active) return;
    const ratio = this.max ? this.pos / this.max : 0;
    this.tween = null;
    this.measure();
    this.pos = ratio * this.max;
    this.apply();
  }

  speed() {
    const s = this.s();
    if (this.shuttleDetent !== 0) {
      const d = this.shuttleDetent;
      return Math.sign(d) * Math.pow(Math.abs(d) / 7, 2.2) * s.maxShuttleSpeed;
    }
    return this.playing ? this.dir * s.baseSpeed : 0;
  }

  _tick(t) {
    if (!this.active) return;
    const dt = Math.min(0.05, (t - this._lastT) / 1000);
    this._lastT = t;

    if (this.tween) {
      const k = Math.min(1, (t - this.tween.t0) / this.tween.dur);
      this.pos = this.tween.from + (this.tween.to - this.tween.from) * easeOut(k);
      if (k >= 1) this.tween = null;
    } else {
      const v = this.speed();
      if (v) {
        this.pos += v * dt;
        if (this.pos >= this.max) {
          this.pos = this.max;
          if (this.playing && this.dir > 0) this.playing = false;
        }
        if (this.pos <= 0) {
          this.pos = 0;
          if (this.playing && this.dir < 0) this.playing = false;
        }
      }
    }

    this.apply();
    this._raf = requestAnimationFrame(this._tick);
  }

  apply() {
    this.els.promptContent.style.transform = `translate3d(0, ${(this.lineY - this.pos).toFixed(2)}px, 0)`;
    this.els.progressFill.style.width = (this.max ? (this.pos / this.max) * 100 : 0) + '%';
    const paused = this.active && !this.playing && this.shuttleDetent === 0 && !this.tween && this.pos > 2;
    this.els.pauseBadge.classList.toggle('show', paused);
  }

  setShuttle(v) {
    this.shuttleDetent = v;
    if (v !== 0) this.tween = null;
  }

  scrub(px) {
    this.tween = null;
    this.pos = clamp(this.pos + px, 0, this.max);
  }

  toggle() {
    this.tween = null;
    this.playing = !this.playing;
  }

  reverse() {
    this.dir *= -1;
  }

  tweenTo(to) {
    this.tween = { from: this.pos, to: clamp(to, 0, this.max), t0: performance.now(), dur: 200 };
  }

  next() {
    const target = this.jumps.find((j) => j > this.pos + 4);
    this.tweenTo(target == null ? this.max : target);
  }

  prev() {
    const before = this.jumps.filter((j) => j < this.pos - 4);
    this.tweenTo(before.length ? before[before.length - 1] : 0);
  }

  toTop() {
    this.playing = false;
    this.tweenTo(0);
  }

  handleKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const s = this.s();
    const nudge = s.fontSize * s.lineHeight;
    switch (e.key) {
      case ' ':
        this.toggle();
        break;
      case 'ArrowDown':
        this.scrub(nudge);
        break;
      case 'ArrowUp':
        this.scrub(-nudge);
        break;
      case 'ArrowRight':
        this.hooks.adjustBaseSpeed(10);
        break;
      case 'ArrowLeft':
        this.hooks.adjustBaseSpeed(-10);
        break;
      case 'PageDown':
      case ']':
        this.next();
        break;
      case 'PageUp':
      case '[':
        this.prev();
        break;
      case 'Home':
        this.toTop();
        break;
      case 'End':
        this.tweenTo(this.max);
        break;
      case '-':
      case '_':
        this.hooks.adjustFontSize(-2);
        break;
      case '=':
      case '+':
        this.hooks.adjustFontSize(2);
        break;
      case 'c':
      case 'C':
        this.hooks.toggleCaps();
        break;
      case 'r':
      case 'R':
        this.reverse();
        break;
      case 'Escape':
        this.hooks.onExit();
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
