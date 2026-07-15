export const DJ_ADVICE = Object.freeze([
  'The road gets quieter when you stop arguing with where it leads.',
  'A good life leaves room for wrong turns and honest repairs.',
  'You do not need the whole map. You need the next clear mile.',
  'Some weight belongs in the trunk. Some weight belongs by the roadside.',
  'The person you become is built in the miles nobody applauds.',
  'Drive gently through places you may never visit again.',
  'An open road cannot free you from a truth you refuse to carry.',
  'Rest is not falling behind. Even engines need the quiet.',
  'If the horizon keeps moving, let your values be the compass.',
  'There is courage in slowing down before the curve asks you to.',
  'A small kindness can outlive the journey that carried it.',
  'Do not confuse a familiar road with the only road home.',
  'What matters most rarely shouts over the noise.',
  'Leave enough silence in your life to hear what is changing.',
  'You can miss the old road and still choose the new one.',
  'The night is not empty. It is where the next direction becomes visible.',
  'A full tank is useful. A clear reason for leaving is better.',
  'You cannot steer a parked life, but you can choose the first slow turn.',
  'Patience is not waiting at the curb. It is traveling without abandoning yourself.',
  'The rear-view mirror is for learning, not for choosing every direction.',
  'A promise becomes real in the ordinary miles after the excitement fades.',
  'Not every delay is a detour. Some are the road teaching you its shape.',
  'Keep people near whom you can tell the truth before the weather turns.',
  'You are allowed to arrive as someone different from the person who departed.',
  'The strongest direction is often a quiet no spoken at the right crossroads.',
  'A destination gives a journey purpose. Attention gives the journey a life.',
  'When your plans lose the road, return to the values that drew the first line.',
  'There is no shame in taking the exit that keeps your spirit intact.',
  'Momentum is powerful, but it should never be trusted with the steering wheel.',
  'The people beside you remember how the journey felt more than how quickly it ended.',
  'Let the hard mile make you wiser, not harder.',
]);

export const DJ_ADVICE_INTERVAL_SECONDS = Object.freeze({ minimum: 34, maximum: 58 });

export const PROCEDURAL_SONGS = Object.freeze([
  Object.freeze({ id: 'dusk-mile', title: 'Dusk Mile', artist: 'The Night Signal', genre: 'warm synthwave', bpm: 92, description: 'Wide minor-nine pads and a patient neon arpeggio.' }),
  Object.freeze({ id: 'pine-rain', title: 'Pine Rain', artist: 'Low County Weather', genre: 'lo-fi night drive', bpm: 72, description: 'Soft two-step drums, round bass, and sparse glass notes.' }),
  Object.freeze({ id: 'midnight-run', title: 'Midnight Run', artist: 'Northbound Static', genre: 'outrun', bpm: 116, description: 'Four-on-the-floor urgency with a bright sawtooth chase line.' }),
  Object.freeze({ id: 'ridge-lanterns', title: 'Ridge Lanterns', artist: 'Catskill Current', genre: 'folk electronica', bpm: 84, description: 'Open fifths, low toms, and a wooden plucked pulse.' }),
  Object.freeze({ id: 'storm-signal', title: 'Storm Signal', artist: 'AM 47', genre: 'industrial downtempo', bpm: 104, description: 'Broken drums, square bass, and cold metallic syncopation.' }),
  Object.freeze({ id: 'dawn-return', title: 'Dawn Return', artist: 'Mile Zero Choir', genre: 'ambient garage', bpm: 78, description: 'A gentle garage shuffle under suspended sunrise chords.' }),
]);

export const PROCEDURAL_PLAYLIST_ORDER = Object.freeze(PROCEDURAL_SONGS.map(({ id }) => id));
export const SONG_DURATION_BARS = 32;
export const STEPS_PER_BAR = 16;
export const SONG_DURATION_STEPS = SONG_DURATION_BARS * STEPS_PER_BAR;
export const PLAYLIST_TRANSITION_SECONDS = 0.08;
export const MAX_SCHEDULED_MUSIC_SOURCES = 96;

const SONGS = Object.freeze({
  'dusk-mile': Object.freeze({
    chords: [[50, 57, 60, 64], [46, 53, 57, 60], [48, 55, 59, 62], [45, 52, 55, 60]],
    bassRoots: [50, 50, 46, 46, 48, 48, 45, 45], kick: [0, 8], snare: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14], openHats: [6, 14],
    bass: [0, 3, 8, 10, 14], arp: [0, 2, 4, 6, 8, 10, 12, 14], arpOffsets: [0, 7, 10, 14, 10, 7, 17, 14],
    bassWave: 'sawtooth', leadWave: 'triangle', padWaves: ['sawtooth', 'triangle'], drumTone: 'clean', padBars: 1,
  }),
  'pine-rain': Object.freeze({
    chords: [[53, 57, 60, 64], [48, 52, 55, 59], [50, 53, 57, 60], [46, 50, 53, 57]],
    bassRoots: [53, 48, 50, 46], kick: [0, 10], snare: [4, 12], hats: [2, 6, 10, 14], openHats: [14],
    bass: [0, 7, 10], arp: [3, 11], arpOffsets: [12, 19, 16, 24],
    bassWave: 'sine', leadWave: 'sine', padWaves: ['triangle', 'sine'], drumTone: 'soft', padBars: 2,
  }),
  'midnight-run': Object.freeze({
    chords: [[52, 59, 64, 67], [48, 55, 60, 64], [50, 57, 62, 66], [47, 54, 59, 62]],
    bassRoots: [52, 52, 48, 50, 47, 50, 48, 47], kick: [0, 4, 8, 12], snare: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14], openHats: [2, 10],
    bass: [0, 2, 4, 7, 8, 10, 12, 15], arp: [0, 1, 3, 4, 6, 8, 9, 11, 12, 14], arpOffsets: [0, 7, 12, 19, 16, 12, 7, 24],
    bassWave: 'square', leadWave: 'sawtooth', padWaves: ['sawtooth', 'square'], drumTone: 'punchy', padBars: 1,
  }),
  'ridge-lanterns': Object.freeze({
    chords: [[55, 62, 67, 71], [50, 57, 62, 66], [52, 59, 64, 67], [48, 55, 60, 64]],
    bassRoots: [43, 50, 52, 48], kick: [0, 7, 10], snare: [4, 12], hats: [0, 4, 8, 12], openHats: [12], toms: [6, 14],
    bass: [0, 6, 10], arp: [0, 5, 8, 13], arpOffsets: [12, 19, 24, 19, 16, 12],
    bassWave: 'triangle', leadWave: 'triangle', padWaves: ['triangle', 'sine'], drumTone: 'wood', padBars: 1,
  }),
  'storm-signal': Object.freeze({
    chords: [[48, 55, 58, 63], [44, 51, 56, 60], [46, 53, 58, 61], [43, 50, 55, 58]],
    bassRoots: [48, 44, 46, 43], kick: [0, 3, 8, 11, 14], snare: [5, 12], hats: [1, 3, 6, 9, 11, 14], openHats: [6], toms: [7, 15],
    bass: [0, 3, 6, 8, 11, 14], arp: [2, 5, 7, 10, 13, 15], arpOffsets: [0, 13, 6, 18, 1, 12],
    bassWave: 'square', leadWave: 'square', padWaves: ['sawtooth', 'square'], drumTone: 'metal', padBars: 2,
  }),
  'dawn-return': Object.freeze({
    chords: [[57, 61, 64, 71], [52, 56, 59, 64], [54, 57, 61, 66], [50, 54, 57, 64]],
    bassRoots: [45, 52, 54, 50], kick: [0, 10], snare: [4, 11], hats: [0, 3, 6, 8, 11, 14], openHats: [6, 14],
    bass: [0, 6, 10, 15], arp: [2, 6, 9, 14], arpOffsets: [12, 16, 19, 23, 16, 14],
    bassWave: 'sine', leadWave: 'sine', padWaves: ['sine', 'triangle'], drumTone: 'airy', padBars: 1,
  }),
});

const AudioContextClass = typeof window === 'undefined'
  ? null
  : window.AudioContext || window.webkitAudioContext;
const hasSpeech = () => typeof window !== 'undefined'
  && 'speechSynthesis' in window
  && typeof SpeechSynthesisUtterance !== 'undefined';
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const midiToHz = (note) => 440 * 2 ** ((note - 69) / 12);

export const adviceDelayFromUnit = (unit) => {
  const t = clamp(Number.isFinite(unit) ? unit : 0, 0, 1);
  const { minimum, maximum } = DJ_ADVICE_INTERVAL_SECONDS;
  return minimum + t * (maximum - minimum);
};

export const selectAdviceIndex = (previousIndex, unit) => {
  if (!DJ_ADVICE.length) return -1;
  let index = Math.min(DJ_ADVICE.length - 1, Math.floor(clamp(Number.isFinite(unit) ? unit : 0, 0, 0.999999) * DJ_ADVICE.length));
  if (index === previousIndex) index = (index + 1) % DJ_ADVICE.length;
  return index;
};

const includes = (steps, step) => steps?.includes(step) ?? false;

export function songDurationSeconds(songId, bars = SONG_DURATION_BARS) {
  const song = PROCEDURAL_SONGS.find(({ id }) => id === songId);
  if (!song) throw new RangeError(`Unknown procedural song: ${songId}`);
  if (!Number.isFinite(bars) || bars <= 0) throw new RangeError('Song bars must be a positive finite number');
  return bars * 4 * (60 / song.bpm);
}

export function playlistSongAfter(startSongId, transitionCount = 0) {
  const originIndex = PROCEDURAL_PLAYLIST_ORDER.indexOf(startSongId);
  if (originIndex < 0) throw new RangeError(`Unknown procedural song: ${startSongId}`);
  if (!Number.isSafeInteger(transitionCount) || transitionCount < 0) {
    throw new RangeError('Playlist transition count must be a non-negative safe integer');
  }
  return PROCEDURAL_PLAYLIST_ORDER[(originIndex + transitionCount) % PROCEDURAL_PLAYLIST_ORDER.length];
}

export function musicStepEvents(songId, step, intensity = 0.5) {
  const song = SONGS[songId];
  if (!song) throw new RangeError(`Unknown procedural song: ${songId}`);
  const barStep = ((step % 16) + 16) % 16;
  const bar = Math.floor(Math.max(0, step) / 16);
  const events = [];
  if (includes(song.kick, barStep)) events.push({ type: 'kick', tone: song.drumTone, accent: barStep === 0 });
  if (includes(song.snare, barStep)) events.push({ type: 'snare', tone: song.drumTone });
  if (includes(song.hats, barStep)) events.push({ type: 'hat', tone: song.drumTone, open: includes(song.openHats, barStep) });
  if (includes(song.toms, barStep)) events.push({ type: 'tom', tone: song.drumTone, high: barStep < 8 });
  if (includes(song.bass, barStep)) {
    const root = song.bassRoots[(bar + (barStep >= 8 ? 1 : 0)) % song.bassRoots.length];
    events.push({ type: 'bass', note: root, wave: song.bassWave, length: barStep === 0 ? 0.42 : 0.24 });
  }
  if (barStep === 0 && bar % song.padBars === 0) {
    events.push({ type: 'pad', notes: song.chords[bar % song.chords.length], waves: song.padWaves, length: song.padBars === 2 ? 7.4 : 3.7 });
  }
  if (includes(song.arp, barStep) && (intensity >= 0.28 || barStep % 2 === 0)) {
    const chord = song.chords[bar % song.chords.length];
    const note = chord[0] + song.arpOffsets[(barStep + bar) % song.arpOffsets.length];
    events.push({ type: 'arp', note, wave: song.leadWave, accent: barStep === 0 || barStep === 8 });
  }
  return events;
}

export class RoadRadio {
  #onStatus;
  #context = null;
  #master = null;
  #mix = null;
  #radioFilter = null;
  #noiseGain = null;
  #noiseBuffer = null;
  #persistentSources = [];
  #scheduledSources = new Set();
  #enabled = false;
  #muted = false;
  #disposed = false;
  #speaking = false;
  #speechUtterance = null;
  #nextAdviceAt = null;
  #lastAdviceIndex = -1;
  #lastDistance = null;
  #lastElapsed = null;
  #intensity = 0.2;
  #songId = PROCEDURAL_SONGS[0].id;
  #playlistOriginIndex = 0;
  #playlistIndex = 0;
  #playlistTransitionCount = 0;
  #nextTransitionAtAudioTime = null;
  #nextBeatTime = 0;
  #step = 0;
  #audioUnavailableReported = false;
  #speechUnavailableReported = false;
  #onVisibilityChange;

  constructor(onStatus = null) {
    this.#onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.#onVisibilityChange = () => this.#handleVisibility();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.#onVisibilityChange);
    }
  }

  get enabled() { return this.#enabled; }
  get muted() { return this.#muted; }
  get songId() { return this.#songId; }
  get currentSong() { return PROCEDURAL_SONGS.find((song) => song.id === this.#songId); }
  get playlistOrder() { return PROCEDURAL_PLAYLIST_ORDER; }
  get playlistIndex() { return this.#playlistIndex; }
  get playlistOriginIndex() { return this.#playlistOriginIndex; }
  get nextSong() {
    return PROCEDURAL_SONGS[(this.#playlistIndex + 1) % PROCEDURAL_SONGS.length];
  }
  get nextTransition() {
    const remainingSteps = Math.max(0, SONG_DURATION_STEPS - this.#step);
    const effectiveBpm = this.currentSong.bpm + this.#intensity * 4;
    const estimatedSeconds = remainingSteps * ((60 / effectiveBpm) / 4);
    const audioTime = this.#nextTransitionAtAudioTime
      ?? (this.#context ? this.#context.currentTime + estimatedSeconds : null);
    return Object.freeze({
      songId: this.#songId,
      nextSongId: this.nextSong.id,
      bars: SONG_DURATION_BARS,
      currentStep: this.#step,
      remainingSteps,
      estimatedSeconds,
      audioTime,
      pending: this.#nextTransitionAtAudioTime !== null,
      mode: 'clean',
      gapSeconds: PLAYLIST_TRANSITION_SECONDS,
    });
  }
  get playlistState() {
    return Object.freeze({
      order: PROCEDURAL_PLAYLIST_ORDER,
      originIndex: this.#playlistOriginIndex,
      index: this.#playlistIndex,
      transitionCount: this.#playlistTransitionCount,
      songId: this.#songId,
      nextSongId: this.nextSong.id,
      nextTransition: this.nextTransition,
      scheduledSourceCount: this.#scheduledSources.size,
      maximumScheduledSources: MAX_SCHEDULED_MUSIC_SOURCES,
    });
  }
  get rhythmState() {
    const baseBpm = this.currentSong?.bpm ?? 90;
    const bpm = Number.isFinite(baseBpm + this.#intensity * 4)
      ? baseBpm + this.#intensity * 4
      : baseBpm;
    const sixteenthSeconds = (60 / bpm) / 4;
    const contextTime = this.#context?.currentTime;
    const schedulerTime = Number.isFinite(contextTime)
      ? Math.max(0, contextTime)
      : Math.max(0, Number.isFinite(this.#lastElapsed) ? this.#lastElapsed : 0);

    let sixteenthStep;
    let sixteenthPhase;
    if (this.#enabled && Number.isFinite(this.#nextBeatTime) && this.#nextBeatTime > 0) {
      sixteenthStep = Math.max(0, this.#step - 1) % SONG_DURATION_STEPS;
      sixteenthPhase = Math.min(0.999999, Math.max(0, 1 - (this.#nextBeatTime - schedulerTime) / sixteenthSeconds));
    } else {
      const position = schedulerTime / sixteenthSeconds;
      sixteenthStep = Math.floor(position) % SONG_DURATION_STEPS;
      sixteenthPhase = position - Math.floor(position);
    }

    const stepInBar = sixteenthStep % STEPS_PER_BAR;
    return Object.freeze({
      songId: this.#songId,
      bpm,
      baseBpm,
      sixteenthStep,
      sixteenthPhase,
      beatPhase: ((stepInBar % 4) + sixteenthPhase) / 4,
      barPhase: (stepInBar + sixteenthPhase) / STEPS_PER_BAR,
      beatInBar: Math.floor(stepInBar / 4),
      bar: Math.floor(sixteenthStep / STEPS_PER_BAR),
      schedulerTime,
      playlistTransitionCount: this.#playlistTransitionCount,
    });
  }

  setSong(id) {
    if (!SONGS[id]) throw new RangeError(`Unknown procedural song: ${id}`);
    const selectedIndex = PROCEDURAL_PLAYLIST_ORDER.indexOf(id);
    this.#songId = id;
    this.#playlistOriginIndex = selectedIndex;
    this.#playlistIndex = selectedIndex;
    this.#playlistTransitionCount = 0;
    this.#nextTransitionAtAudioTime = null;
    this.#cancelScheduledMusic();
    this.#resetScheduler(true);
    const song = this.currentSong;
    this.#report(`Now playing: ${song.artist} — ${song.title}`);
    return song;
  }

  set muted(value) {
    const next = Boolean(value);
    if (next === this.#muted) return;
    this.#muted = next;
    if (next) {
      this.#silenceMusic();
      this.#cancelSpeech();
      this.#report('Radio muted');
    } else {
      void this.#resumeIfAllowed();
      this.#report('Radio unmuted');
    }
  }

  async start() {
    if (this.#disposed || this.#enabled) return this.#enabled;
    const audioAvailable = await this.#ensureAudio();
    if (!audioAvailable && !hasSpeech()) {
      this.#report('Radio unavailable in this browser');
      return false;
    }

    this.#enabled = true;
    this.#nextAdviceAt = null;
    this.#lastDistance = null;
    this.#lastElapsed = null;
    if (!this.#muted && !this.#isHidden() && this.#context) {
      try {
        await this.#context.resume();
        this.#resetScheduler(true);
        this.#restoreMusic();
      } catch {
        this.#reportAudioUnavailable();
      }
    }
    this.#report(`Night radio on · ${this.currentSong.title}`);
    return true;
  }

  async stop() {
    if (!this.#enabled) return false;
    this.#enabled = false;
    this.#nextAdviceAt = null;
    this.#cancelSpeech();
    this.#silenceMusic();
    this.#cancelScheduledMusic();
    if (this.#context?.state === 'running') {
      try { await this.#context.suspend(); } catch { /* Page teardown. */ }
    }
    this.#report('Radio off');
    return false;
  }

  async toggle() {
    return this.#enabled ? this.stop() : this.start();
  }

  update(totalDistance, elapsed) {
    if (this.#disposed || !Number.isFinite(elapsed)) return;
    const previousElapsed = this.#lastElapsed;
    if (Number.isFinite(totalDistance)) this.#updateIntensity(totalDistance, elapsed);
    else this.#lastElapsed = elapsed;

    if (!this.#enabled || this.#muted || this.#isHidden()) return;
    this.#scheduleMusic();

    if (this.#nextAdviceAt === null || (previousElapsed !== null && elapsed < previousElapsed - 1)) {
      this.#nextAdviceAt = elapsed + adviceDelayFromUnit(Math.random());
    }
    if (elapsed >= this.#nextAdviceAt && !this.#speaking) {
      const started = this.#speakAdvice();
      this.#nextAdviceAt = elapsed + (started ? adviceDelayFromUnit(Math.random()) : 4);
    }
  }

  async dispose() {
    if (this.#disposed) return;
    await this.stop();
    this.#disposed = true;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.#onVisibilityChange);
    }
    this.#cancelScheduledMusic();
    for (const source of this.#persistentSources) {
      try { source.stop(); } catch { /* Already stopped. */ }
    }
    this.#persistentSources.length = 0;
    if (this.#context && this.#context.state !== 'closed') {
      try { await this.#context.close(); } catch { /* Best effort. */ }
    }
    this.#context = null;
    this.#master = null;
    this.#mix = null;
    this.#radioFilter = null;
    this.#noiseGain = null;
    this.#noiseBuffer = null;
  }

  async #ensureAudio() {
    if (this.#context) return true;
    if (!AudioContextClass) {
      this.#reportAudioUnavailable();
      return false;
    }
    try {
      this.#context = new AudioContextClass({ latencyHint: 'interactive' });
      this.#buildAudioGraph();
      return true;
    } catch {
      this.#context = null;
      this.#reportAudioUnavailable();
      return false;
    }
  }

  #buildAudioGraph() {
    const context = this.#context;
    const now = context.currentTime;
    this.#master = context.createGain();
    this.#master.gain.setValueAtTime(0.0001, now);

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-18, now);
    compressor.knee.setValueAtTime(14, now);
    compressor.ratio.setValueAtTime(4, now);
    compressor.attack.setValueAtTime(0.008, now);
    compressor.release.setValueAtTime(0.18, now);

    this.#mix = context.createGain();
    this.#mix.gain.setValueAtTime(0.72, now);
    this.#radioFilter = context.createBiquadFilter();
    this.#radioFilter.type = 'lowpass';
    this.#radioFilter.frequency.setValueAtTime(3600, now);
    this.#radioFilter.Q.setValueAtTime(0.7, now);
    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(62, now);

    const saturation = context.createWaveShaper();
    const curve = new Float32Array(512);
    for (let index = 0; index < curve.length; index += 1) {
      const input = (index / (curve.length - 1)) * 2 - 1;
      curve[index] = Math.tanh(input * 1.35) / Math.tanh(1.35);
    }
    saturation.curve = curve;
    saturation.oversample = '2x';
    this.#mix.connect(this.#radioFilter).connect(highpass).connect(saturation).connect(compressor).connect(this.#master).connect(context.destination);

    this.#noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = this.#noiseBuffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;

    const staticSource = context.createBufferSource();
    const staticFilter = context.createBiquadFilter();
    this.#noiseGain = context.createGain();
    staticSource.buffer = this.#noiseBuffer;
    staticSource.loop = true;
    staticFilter.type = 'bandpass';
    staticFilter.frequency.setValueAtTime(2350, now);
    staticFilter.Q.setValueAtTime(0.32, now);
    this.#noiseGain.gain.setValueAtTime(0.0055, now);
    staticSource.connect(staticFilter).connect(this.#noiseGain).connect(this.#mix);
    staticSource.start();
    this.#persistentSources.push(staticSource);
  }

  #resetScheduler(restartSong = false) {
    if (!this.#context) return;
    this.#nextBeatTime = this.#context.currentTime + 0.06;
    this.#nextTransitionAtAudioTime = null;
    if (restartSong) this.#step = 0;
  }

  #scheduleMusic() {
    const context = this.#context;
    if (!context || context.state !== 'running' || this.#speaking) return;
    const now = context.currentTime;
    const horizon = now + 0.16;
    if (this.#step >= SONG_DURATION_STEPS) {
      if (now < this.#nextTransitionAtAudioTime) return;
      this.#advancePlaylist(now);
    }
    if (this.#nextBeatTime < now - 0.25 || this.#nextBeatTime > now + 2) this.#resetScheduler();

    let scheduled = 0;
    while (this.#nextBeatTime < horizon && scheduled < 8) {
      this.#scheduleStep(this.#step, this.#nextBeatTime);
      const bpm = this.currentSong.bpm + this.#intensity * 4;
      this.#nextBeatTime += (60 / bpm) / 4;
      this.#step += 1;
      scheduled += 1;
      if (this.#step >= SONG_DURATION_STEPS) {
        this.#nextTransitionAtAudioTime = this.#nextBeatTime;
        break;
      }
    }
  }

  #advancePlaylist(now) {
    this.#cancelScheduledMusic();
    this.#playlistIndex = (this.#playlistIndex + 1) % PROCEDURAL_PLAYLIST_ORDER.length;
    this.#playlistTransitionCount += 1;
    this.#songId = PROCEDURAL_PLAYLIST_ORDER[this.#playlistIndex];
    this.#step = 0;
    this.#nextTransitionAtAudioTime = null;
    this.#nextBeatTime = now + PLAYLIST_TRANSITION_SECONDS;
    const song = this.currentSong;
    this.#report(`Up next: ${song.artist} — ${song.title}`);
  }

  #scheduleStep(step, time) {
    for (const event of musicStepEvents(this.#songId, step, this.#intensity)) {
      switch (event.type) {
        case 'kick': this.#kick(time, event.tone, event.accent); break;
        case 'snare': this.#snare(time, event.tone); break;
        case 'hat': this.#hat(time, event.open, event.tone); break;
        case 'tom': this.#tom(time, event.high, event.tone); break;
        case 'bass': this.#bass(time, event.note, event.length, event.wave); break;
        case 'pad': this.#pad(time, event.notes, event.length, event.waves); break;
        case 'arp': this.#arp(time, event.note, event.accent, event.wave); break;
        default: break;
      }
    }
  }

  #kick(time, tone = 'clean', accent = false) {
    const context = this.#context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    const startFrequency = tone === 'soft' || tone === 'airy' ? 96 : tone === 'metal' ? 158 : 130;
    const endFrequency = tone === 'wood' ? 54 : 47;
    const peak = (tone === 'soft' ? 0.46 : tone === 'airy' ? 0.52 : tone === 'punchy' ? 0.82 : 0.68) * (accent ? 1.08 : 1);
    oscillator.frequency.setValueAtTime(startFrequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, time + (tone === 'punchy' ? 0.075 : 0.105));
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);
    oscillator.connect(gain).connect(this.#mix);
    this.#startOneShot(oscillator, time, time + 0.26);
  }

  #snare(time, tone = 'clean') {
    const context = this.#context;
    const noise = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    noise.buffer = this.#noiseBuffer;
    filter.type = 'highpass';
    const noiseFrequency = tone === 'metal' ? 2600 : tone === 'soft' ? 980 : tone === 'airy' ? 1850 : 1350;
    const noisePeak = tone === 'soft' ? 0.12 : tone === 'metal' ? 0.26 : 0.2;
    const noiseLength = tone === 'airy' ? 0.24 : tone === 'punchy' ? 0.12 : 0.18;
    filter.frequency.setValueAtTime(noiseFrequency, time);
    gain.gain.setValueAtTime(noisePeak, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + noiseLength);
    noise.connect(filter).connect(gain).connect(this.#mix);
    this.#startOneShot(noise, time, time + noiseLength + 0.01);

    const body = context.createOscillator();
    const bodyGain = context.createGain();
    body.type = tone === 'metal' ? 'square' : tone === 'soft' || tone === 'airy' ? 'sine' : 'triangle';
    body.frequency.setValueAtTime(tone === 'wood' ? 132 : tone === 'metal' ? 212 : 176, time);
    bodyGain.gain.setValueAtTime(tone === 'soft' ? 0.07 : 0.11, time);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.105);
    body.connect(bodyGain).connect(this.#mix);
    this.#startOneShot(body, time, time + 0.12);
  }

  #hat(time, open, tone = 'clean') {
    const context = this.#context;
    const noise = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    noise.buffer = this.#noiseBuffer;
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(tone === 'metal' ? 7600 : tone === 'soft' ? 4800 : tone === 'wood' ? 5400 : 6100, time);
    const length = open ? (tone === 'airy' ? 0.2 : 0.12) : 0.045;
    const toneGain = tone === 'soft' ? 0.7 : tone === 'metal' ? 1.25 : 1;
    gain.gain.setValueAtTime((0.035 + this.#intensity * 0.022) * toneGain, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
    noise.connect(filter).connect(gain).connect(this.#mix);
    this.#startOneShot(noise, time, time + length + 0.01);
  }

  #tom(time, high, tone = 'wood') {
    const context = this.#context;
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.type = tone === 'metal' ? 'square' : 'triangle';
    oscillator.frequency.setValueAtTime(high ? 148 : 104, time);
    oscillator.frequency.exponentialRampToValueAtTime(high ? 94 : 68, time + 0.18);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(tone === 'metal' ? 820 : 480, time);
    gain.gain.setValueAtTime(0.14, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.26);
    oscillator.connect(filter).connect(gain).connect(this.#mix);
    this.#startOneShot(oscillator, time, time + 0.28);
  }

  #bass(time, note, length, wave = 'sawtooth') {
    const context = this.#context;
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(midiToHz(note - 12), time);
    filter.type = 'lowpass';
    const rounded = wave === 'sine' || wave === 'triangle';
    filter.frequency.setValueAtTime((rounded ? 340 : 230) + this.#intensity * (rounded ? 180 : 310), time);
    filter.Q.setValueAtTime(wave === 'square' ? 4.1 : 3.2, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(rounded ? 0.2 : 0.145, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
    oscillator.connect(filter).connect(gain).connect(this.#mix);
    this.#startOneShot(oscillator, time, time + length + 0.02);
  }

  #pad(time, notes, length, waves = ['sawtooth', 'triangle']) {
    const context = this.#context;
    for (const [index, note] of notes.entries()) {
      const oscillator = context.createOscillator();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      oscillator.type = waves[index % waves.length];
      oscillator.frequency.setValueAtTime(midiToHz(note), time);
      oscillator.detune.setValueAtTime(index % 2 ? 5 : -5, time);
      filter.type = 'lowpass';
      const gentle = oscillator.type === 'sine' || oscillator.type === 'triangle';
      filter.frequency.setValueAtTime((gentle ? 680 : 480) + this.#intensity * 620, time);
      filter.frequency.linearRampToValueAtTime((gentle ? 1200 : 900) + this.#intensity * 850, time + length * 0.55);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.024, time + 0.7);
      gain.gain.setValueAtTime(0.024, time + length - 0.9);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
      oscillator.connect(filter).connect(gain).connect(this.#mix);
      this.#startOneShot(oscillator, time, time + length + 0.02);
    }
  }

  #arp(time, note, accent, wave = 'triangle') {
    const context = this.#context;
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(midiToHz(note), time);
    filter.type = 'lowpass';
    const bright = wave === 'sawtooth' || wave === 'square';
    filter.frequency.setValueAtTime((bright ? 1050 : 1550) + this.#intensity * (bright ? 2600 : 1500), time);
    gain.gain.setValueAtTime(0.0001, time);
    const peak = bright ? (accent ? 0.064 : 0.042) : (accent ? 0.085 : 0.052);
    const length = wave === 'sine' ? 0.25 : 0.16;
    gain.gain.exponentialRampToValueAtTime(peak, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
    oscillator.connect(filter).connect(gain).connect(this.#mix);
    this.#startOneShot(oscillator, time, time + length + 0.02);
  }

  #startOneShot(source, start, stop) {
    if (this.#scheduledSources.size >= MAX_SCHEDULED_MUSIC_SOURCES) {
      try { source.disconnect(); } catch { /* Never connected or already detached. */ }
      return;
    }
    this.#scheduledSources.add(source);
    source.onended = () => {
      this.#scheduledSources.delete(source);
      try { source.disconnect(); } catch { /* Already disconnected. */ }
    };
    source.start(start);
    source.stop(stop);
  }

  #cancelScheduledMusic() {
    for (const source of this.#scheduledSources) {
      try { source.stop(); } catch { /* Already ended. */ }
      try { source.disconnect(); } catch { /* Already disconnected. */ }
    }
    this.#scheduledSources.clear();
  }

  #updateIntensity(distance, elapsed) {
    if (this.#lastDistance !== null && this.#lastElapsed !== null) {
      const deltaTime = elapsed - this.#lastElapsed;
      if (deltaTime > 0.02 && deltaTime < 2) {
        const speed = Math.abs(distance - this.#lastDistance) / deltaTime;
        const target = clamp(speed / 28, 0.08, 1);
        this.#intensity += (target - this.#intensity) * clamp(deltaTime * 1.7, 0, 1);
      }
    }
    this.#lastDistance = distance;
    this.#lastElapsed = elapsed;
    if (!this.#context || !this.#radioFilter || !this.#noiseGain) return;
    const now = this.#context.currentTime;
    this.#radioFilter.frequency.setTargetAtTime(2700 + this.#intensity * 2300, now, 0.65);
    this.#noiseGain.gain.setTargetAtTime(0.007 - this.#intensity * 0.003, now, 0.8);
  }

  #speakAdvice() {
    if (!hasSpeech()) {
      if (!this.#speechUnavailableReported) {
        this.#speechUnavailableReported = true;
        this.#report('DJ voice unavailable');
      }
      return false;
    }
    const synthesis = window.speechSynthesis;
    if (this.#speaking || this.#speechUtterance || synthesis.speaking || synthesis.pending) return false;
    const index = selectAdviceIndex(this.#lastAdviceIndex, Math.random());
    this.#lastAdviceIndex = index;
    const utterance = new SpeechSynthesisUtterance(DJ_ADVICE[index]);
    utterance.lang = 'en-US';
    utterance.rate = 0.78;
    utterance.pitch = 0.67;
    utterance.volume = 0.86;
    utterance.voice = this.#selectVoice();
    const finish = () => {
      if (this.#speechUtterance !== utterance) return;
      this.#speaking = false;
      this.#speechUtterance = null;
      if (this.#enabled && !this.#muted && !this.#isHidden()) {
        this.#resetScheduler();
        this.#restoreMusic();
      }
    };
    utterance.onstart = () => {
      this.#speaking = true;
      this.#duckMusic();
      this.#report(`Night DJ: ${DJ_ADVICE[index]}`);
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    this.#speechUtterance = utterance;
    this.#duckMusic();
    try {
      synthesis.speak(utterance);
      return true;
    } catch {
      finish();
      if (!this.#speechUnavailableReported) {
        this.#speechUnavailableReported = true;
        this.#report('DJ voice unavailable');
      }
      return false;
    }
  }

  #selectVoice() {
    const voices = window.speechSynthesis.getVoices();
    const english = voices.filter((voice) => /^en[-_]/i.test(voice.lang));
    if (!english.length) return null;
    const mature = /david|daniel|george|guy|james|mark|ryan|male|arthur|graham/i;
    return english.map((voice) => ({
      voice,
      score: (mature.test(voice.name) ? 6 : 0)
        + (/en[-_]GB/i.test(voice.lang) ? 2 : 0)
        + (/en[-_]US/i.test(voice.lang) ? 1 : 0)
        + (voice.localService ? 1 : 0),
    })).sort((a, b) => b.score - a.score)[0].voice;
  }

  #duckMusic() {
    if (!this.#context || !this.#mix) return;
    const now = this.#context.currentTime;
    this.#mix.gain.cancelScheduledValues(now);
    this.#mix.gain.setTargetAtTime(0.018, now, 0.09);
  }

  #restoreMusic() {
    if (!this.#context || !this.#master || !this.#mix || this.#muted || !this.#enabled) return;
    const now = this.#context.currentTime;
    this.#master.gain.cancelScheduledValues(now);
    this.#mix.gain.cancelScheduledValues(now);
    this.#master.gain.setTargetAtTime(0.62, now, 0.22);
    this.#mix.gain.setTargetAtTime(0.7 + this.#intensity * 0.12, now, 0.38);
  }

  #silenceMusic() {
    if (!this.#context || !this.#master) return;
    const now = this.#context.currentTime;
    this.#master.gain.cancelScheduledValues(now);
    this.#master.gain.setTargetAtTime(0.0001, now, 0.06);
  }

  #cancelSpeech() {
    if (this.#speechUtterance && hasSpeech()) {
      try { window.speechSynthesis.cancel(); } catch { /* Page teardown. */ }
    }
    this.#speaking = false;
    this.#speechUtterance = null;
  }

  async #resumeIfAllowed() {
    if (!this.#enabled || this.#muted || this.#isHidden() || !this.#context) return;
    try {
      await this.#context.resume();
      this.#resetScheduler();
      this.#restoreMusic();
    } catch { this.#reportAudioUnavailable(); }
  }

  #handleVisibility() {
    if (this.#isHidden()) {
      this.#cancelSpeech();
      this.#silenceMusic();
      this.#cancelScheduledMusic();
      if (this.#context?.state === 'running') void this.#context.suspend();
    } else void this.#resumeIfAllowed();
  }

  #isHidden() { return typeof document !== 'undefined' && document.hidden; }

  #reportAudioUnavailable() {
    if (this.#audioUnavailableReported) return;
    this.#audioUnavailableReported = true;
    this.#report('Procedural audio unavailable; DJ voice may still work');
  }

  #report(message) {
    try {
      this.#onStatus(message, {
        enabled: this.#enabled,
        muted: this.#muted,
        songId: this.#songId,
        currentSong: this.currentSong,
        playlistIndex: this.#playlistIndex,
        playlistOriginIndex: this.#playlistOriginIndex,
        playlistTransitionCount: this.#playlistTransitionCount,
        playlistOrder: PROCEDURAL_PLAYLIST_ORDER,
        nextSong: this.nextSong,
        nextTransition: this.nextTransition,
      });
    }
    catch { /* UI callbacks cannot interrupt audio. */ }
  }
}
