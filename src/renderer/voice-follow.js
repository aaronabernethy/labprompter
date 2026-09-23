// Voice-follow word matching: turns recognized speech (from the native
// speech-helper, see src/main/voice.js) into a scroll target for Present
// Mode. Pure logic, no DOM — takes the line geometry `measureLines()`
// already produces, so it's the same thing driving live-edit reflow.

import { stripDirections } from './render.js';

function normalizeWord(w) {
  return w.toLowerCase().replace(/[^a-z0-9']/g, '');
}

// How far ahead of the current position to search for a recognized word.
// Wide enough to survive a skipped sentence or a paraphrase; narrow enough
// that a stray recognized word (background noise, a filler "the") doesn't
// snap the scroll far down the script.
const LOOKAHEAD = 40;

// Builds one entry per spoken word, in script order, from measureLines()
// output ({ top, line, text }[], sorted by `top`). Screen directions are
// excluded, matching the word count and pacing readout.
export function buildWordIndex(lines) {
  const words = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextTop = i + 1 < lines.length ? lines[i + 1].top : line.top + 1;
    const raw = stripDirections(line.text).trim().split(/\s+/).filter(Boolean);
    raw.forEach((w, wi) => {
      const norm = normalizeWord(w);
      if (!norm) return;
      words.push({
        norm,
        // Spread a line's words evenly across its vertical span so the
        // target eases down smoothly instead of jumping line-to-line.
        top: line.top + (nextTop - line.top) * (raw.length > 1 ? wi / (raw.length - 1) : 0),
      });
    });
  }
  return words;
}

export class VoiceFollowMatcher {
  constructor(words) {
    this.words = words || [];
    this.cursor = -1; // index of the last matched word
  }

  // Feed a chunk of recognized text — a partial or final result from the
  // speech helper. Partial results are cumulative (the whole utterance so
  // far, not just what's new), which is fine here: matching always resumes
  // searching just after the current cursor, so replayed earlier words
  // can't match again and only genuinely new words move it forward.
  // Returns the target scroll position for the furthest match in this
  // chunk, or null if nothing in it matched (an ad-lib, or noise).
  feed(text) {
    const heard = (text || '').split(/\s+/).map(normalizeWord).filter(Boolean);
    if (!heard.length || !this.words.length) return null;

    let matched = false;
    for (const h of heard) {
      const start = this.cursor + 1;
      const end = Math.min(this.words.length, start + LOOKAHEAD);
      for (let i = start; i < end; i++) {
        if (this.words[i].norm === h) {
          this.cursor = i;
          matched = true;
          break;
        }
      }
    }
    return matched ? this.words[this.cursor].top : null;
  }

  reset() {
    this.cursor = -1;
  }
}
