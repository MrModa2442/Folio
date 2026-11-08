/**
 * Cozy Ambient Audio Synthesizer using Web Audio API
 * Generates natural, authentic soundscapes:
 * - Rain: Multi-layered wash, wind swells, and realistic windowpane droplet impacts
 * - Fireplace: Deep warm hearth rumble, flame draft flutter, micro-crackles, and satisfying ember snaps
 * - Library: Sanctuary room acoustics, soothing grandfather clock pendulum, and gentle paper page turns
 * Zero external audio files or network dependencies.
 */

import {
  generatePinkNoise,
  generateBrownNoise,
  generateDropletWaveform,
  generateEmberPopWaveform,
  generateClockTickWaveform,
  generatePageTurnEnvelope,
  calculatePoissonInterval,
} from '../utils/ambientAudioMath';

export type AmbientSoundType = 'none' | 'rain' | 'fireplace' | 'library';

class AmbientSoundEngine {
  private ctx: AudioContext | null = null;
  private currentType: AmbientSoundType = 'none';
  private masterGain: GainNode | null = null;
  private activeTimers: number[] = [];
  private activeNodes: (AudioNode | { stop?: () => void; disconnect: () => void })[] = [];
  private clockIsTock: boolean = false;

  private initContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    return this.ctx;
  }

  public play(type: AmbientSoundType, volume: number = 0.35) {
    this.stop();

    if (type === 'none') {
      this.currentType = 'none';
      return;
    }

    try {
      const ctx = this.initContext();
      if (!ctx) return;

      this.currentType = type;

      // Master output gain with smooth fade-in
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.001, ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(Math.max(0.01, Math.min(1, volume)), ctx.currentTime + 0.35);
      master.connect(ctx.destination);
      this.masterGain = master;

      if (type === 'rain') {
        this.startRain(ctx, master);
      } else if (type === 'fireplace') {
        this.startFireplace(ctx, master);
      } else if (type === 'library') {
        this.startLibrary(ctx, master);
      }
    } catch (err) {
      console.warn('Ambient audio could not initialize', err);
      this.currentType = 'none';
    }
  }

  public setVolume(volume: number) {
    if (this.masterGain && this.ctx) {
      const safeVol = Math.max(0.0001, Math.min(1, volume));
      this.masterGain.gain.setValueAtTime(safeVol, this.ctx.currentTime);
    }
  }

  public stop() {
    this.currentType = 'none';

    // Clear all scheduled timers
    for (const timer of this.activeTimers) {
      window.clearTimeout(timer);
      window.clearInterval(timer);
    }
    this.activeTimers = [];

    // Smooth fade out master before stopping
    if (this.masterGain && this.ctx) {
      try {
        const currentTime = this.ctx.currentTime;
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, currentTime);
        this.masterGain.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.15);
      } catch {
        // ignore
      }
    }

    // Disconnect and stop all nodes after short ramp
    const nodesToClean = [...this.activeNodes];
    this.activeNodes = [];

    window.setTimeout(() => {
      for (const node of nodesToClean) {
        try {
          if ('stop' in node && typeof node.stop === 'function') {
            node.stop();
          }
          node.disconnect();
        } catch {
          // ignore
        }
      }
    }, 160);

    if (this.ctx) {
      try {
        this.ctx.close();
      } catch {
        // ignore
      }
      this.ctx = null;
      this.masterGain = null;
    }
  }

  public getCurrentType(): AmbientSoundType {
    return this.currentType;
  }

  /**
   * RAIN SOUND ENGINE
   * 1. Pink noise deep rain bed with slow wind swell LFO
   * 2. Medium drizzle texture (bandpassed resonance)
   * 3. Distinct windowpane raindrop pings & splash transients
   */
  private startRain(ctx: AudioContext, master: GainNode) {
    const sampleRate = ctx.sampleRate;

    // --- Layer 1: Continuous Rain Bed (Pink Noise) ---
    const bedDuration = 4;
    const bedBuffer = ctx.createBuffer(2, sampleRate * bedDuration, sampleRate);
    generatePinkNoise(bedBuffer.getChannelData(0));
    generatePinkNoise(bedBuffer.getChannelData(1));

    const bedSource = ctx.createBufferSource();
    bedSource.buffer = bedBuffer;
    bedSource.loop = true;

    // Lowpass filter for warm downpour body
    const bedFilter = ctx.createBiquadFilter();
    bedFilter.type = 'lowpass';
    bedFilter.frequency.setValueAtTime(750, ctx.currentTime);
    bedFilter.Q.setValueAtTime(0.8, ctx.currentTime);

    // Wind swell LFO modulating filter cutoff
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(0.12, ctx.currentTime); // ~8 second swell cycle
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(150, ctx.currentTime);
    lfo.connect(lfoGain);
    lfoGain.connect(bedFilter.frequency);
    lfo.start();

    const bedGain = ctx.createGain();
    bedGain.gain.setValueAtTime(0.7, ctx.currentTime);

    bedSource.connect(bedFilter);
    bedFilter.connect(bedGain);
    bedGain.connect(master);
    bedSource.start();

    this.activeNodes.push(bedSource, bedFilter, bedGain, lfo, lfoGain);

    // --- Layer 2: Medium Drizzle Texture (Bandpass Pink Noise) ---
    const drizzleSource = ctx.createBufferSource();
    drizzleSource.buffer = bedBuffer;
    drizzleSource.loop = true;

    const drizzleFilter = ctx.createBiquadFilter();
    drizzleFilter.type = 'bandpass';
    drizzleFilter.frequency.setValueAtTime(1850, ctx.currentTime);
    drizzleFilter.Q.setValueAtTime(1.4, ctx.currentTime);

    const drizzleGain = ctx.createGain();
    drizzleGain.gain.setValueAtTime(0.25, ctx.currentTime);

    drizzleSource.connect(drizzleFilter);
    drizzleFilter.connect(drizzleGain);
    drizzleGain.connect(master);
    drizzleSource.start();

    this.activeNodes.push(drizzleSource, drizzleFilter, drizzleGain);

    // --- Layer 3: Dynamic Windowpane Raindrop Impacts ---
    // Pre-cache 6 realistic droplet variants for ultra-efficient playback
    const dropletBuffers: AudioBuffer[] = [];
    const dropletConfigs = [
      { start: 2600, end: 1700, dur: 0.024 },
      { start: 2200, end: 1400, dur: 0.028 },
      { start: 2900, end: 1950, dur: 0.022 },
      { start: 1900, end: 1250, dur: 0.032 },
      { start: 3200, end: 2100, dur: 0.020 },
      { start: 2450, end: 1600, dur: 0.026 },
    ];

    for (const cfg of dropletConfigs) {
      const data = generateDropletWaveform(sampleRate, cfg.dur, cfg.start, cfg.end);
      const buf = ctx.createBuffer(1, data.length, sampleRate);
      buf.getChannelData(0).set(data);
      dropletBuffers.push(buf);
    }

    const scheduleNextDroplet = () => {
      if (this.currentType !== 'rain' || !this.ctx) return;

      const randomBuf = dropletBuffers[Math.floor(Math.random() * dropletBuffers.length)];
      const dropSource = ctx.createBufferSource();
      dropSource.buffer = randomBuf;

      const dropGain = ctx.createGain();
      // Randomized gentle droplet volume
      const dropVol = 0.06 + Math.random() * 0.12;
      dropGain.gain.setValueAtTime(dropVol, ctx.currentTime);

      // Stereo panning if supported
      if (typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime((Math.random() * 2 - 1) * 0.75, ctx.currentTime);
        dropSource.connect(panner);
        panner.connect(dropGain);
      } else {
        dropSource.connect(dropGain);
      }

      dropGain.connect(master);
      dropSource.start();

      // Schedule next drop with natural Poisson variance (40ms - 130ms)
      const nextDelay = calculatePoissonInterval(40, 130);
      const timer = window.setTimeout(scheduleNextDroplet, nextDelay);
      this.activeTimers.push(timer);
    };

    scheduleNextDroplet();
  }

  /**
   * FIREPLACE SOUND ENGINE
   * 1. Warm brown noise hearth bed with flickering flame draft modulation
   * 2. Frequent organic micro-crackles (wood fibers fracturing)
   * 3. Satisfying ember snaps and resin pops with wood resonance & steam tail
   */
  private startFireplace(ctx: AudioContext, master: GainNode) {
    const sampleRate = ctx.sampleRate;

    // --- Layer 1: Warm Hearth Flame Bed (Brown Noise) ---
    const bedDuration = 4;
    const bedBuffer = ctx.createBuffer(2, sampleRate * bedDuration, sampleRate);
    generateBrownNoise(bedBuffer.getChannelData(0));
    generateBrownNoise(bedBuffer.getChannelData(1));

    const bedSource = ctx.createBufferSource();
    bedSource.buffer = bedBuffer;
    bedSource.loop = true;

    // Deep lowpass for warm hearth combustion
    const lowFilter = ctx.createBiquadFilter();
    lowFilter.type = 'lowpass';
    lowFilter.frequency.setValueAtTime(220, ctx.currentTime);
    lowFilter.Q.setValueAtTime(0.7, ctx.currentTime);

    // Warmth bass peak at 110 Hz
    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'peaking';
    bassFilter.frequency.setValueAtTime(110, ctx.currentTime);
    bassFilter.gain.setValueAtTime(4.0, ctx.currentTime);
    bassFilter.Q.setValueAtTime(1.2, ctx.currentTime);

    // Flame draft flutter (simulating living air currents of fire)
    const flutterLFO = ctx.createOscillator();
    flutterLFO.frequency.setValueAtTime(3.8, ctx.currentTime);
    const flutterGain = ctx.createGain();
    flutterGain.gain.setValueAtTime(0.08, ctx.currentTime);
    flutterLFO.connect(flutterGain);

    const flameGain = ctx.createGain();
    flameGain.gain.setValueAtTime(0.55, ctx.currentTime);
    flutterGain.connect(flameGain.gain);
    flutterLFO.start();

    bedSource.connect(lowFilter);
    lowFilter.connect(bassFilter);
    bassFilter.connect(flameGain);
    flameGain.connect(master);
    bedSource.start();

    this.activeNodes.push(bedSource, lowFilter, bassFilter, flameGain, flutterLFO, flutterGain);

    // --- Layer 2: Frequent Micro-Crackles ---
    const scheduleMicroCrackle = () => {
      if (this.currentType !== 'fireplace' || !this.ctx) return;

      // Burst of 1-3 tiny fiber crackles
      const count = Math.random() > 0.65 ? (Math.random() > 0.5 ? 2 : 3) : 1;
      for (let c = 0; c < count; c++) {
        const crackleDuration = 0.003 + Math.random() * 0.006;
        const crackleLen = Math.floor(sampleRate * crackleDuration);
        const crackleBuf = ctx.createBuffer(1, crackleLen, sampleRate);
        const cData = crackleBuf.getChannelData(0);

        for (let j = 0; j < crackleLen; j++) {
          cData[j] = (Math.random() * 2 - 1) * Math.exp(-j / (crackleLen * 0.28));
        }

        const crackleSource = ctx.createBufferSource();
        crackleSource.buffer = crackleBuf;

        const bandpass = ctx.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.setValueAtTime(2600 + Math.random() * 2200, ctx.currentTime);
        bandpass.Q.setValueAtTime(3.0, ctx.currentTime);

        const cGain = ctx.createGain();
        cGain.gain.setValueAtTime(0.12 + Math.random() * 0.25, ctx.currentTime);

        crackleSource.connect(bandpass);
        bandpass.connect(cGain);
        cGain.connect(master);
        crackleSource.start(ctx.currentTime + c * 0.015);
      }

      const nextDelay = calculatePoissonInterval(65, 220);
      const timer = window.setTimeout(scheduleMicroCrackle, nextDelay);
      this.activeTimers.push(timer);
    };

    scheduleMicroCrackle();

    // --- Layer 3: Satisfying Wood Snaps & Ember Pops ---
    const emberBuffers: AudioBuffer[] = [];
    const emberConfigs = [
      { dur: 0.045, res: 460 },
      { dur: 0.052, res: 380 },
      { dur: 0.038, res: 540 },
      { dur: 0.060, res: 320 },
    ];

    for (const cfg of emberConfigs) {
      const data = generateEmberPopWaveform(sampleRate, cfg.dur, cfg.res);
      const buf = ctx.createBuffer(1, data.length, sampleRate);
      buf.getChannelData(0).set(data);
      emberBuffers.push(buf);
    }

    const scheduleEmberPop = () => {
      if (this.currentType !== 'fireplace' || !this.ctx) return;

      const randomEmber = emberBuffers[Math.floor(Math.random() * emberBuffers.length)];
      const emberSource = ctx.createBufferSource();
      emberSource.buffer = randomEmber;

      const emberGain = ctx.createGain();
      emberGain.gain.setValueAtTime(0.35 + Math.random() * 0.35, ctx.currentTime);

      if (typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime((Math.random() * 2 - 1) * 0.6, ctx.currentTime);
        emberSource.connect(panner);
        panner.connect(emberGain);
      } else {
        emberSource.connect(emberGain);
      }

      emberGain.connect(master);
      emberSource.start();

      // Occasional double-pop in quick succession
      if (Math.random() > 0.75) {
        window.setTimeout(() => {
          if (this.currentType === 'fireplace' && this.ctx) {
            const secondSource = ctx.createBufferSource();
            secondSource.buffer = emberBuffers[Math.floor(Math.random() * emberBuffers.length)];
            const secondGain = ctx.createGain();
            secondGain.gain.setValueAtTime(0.25 + Math.random() * 0.25, ctx.currentTime);
            secondSource.connect(secondGain);
            secondGain.connect(master);
            secondSource.start();
          }
        }, 60 + Math.random() * 90);
      }

      const nextInterval = 1200 + Math.random() * 2800; // Every 1.2 to 4 seconds
      const timer = window.setTimeout(scheduleEmberPop, nextInterval);
      this.activeTimers.push(timer);
    };

    scheduleEmberPop();
  }

  /**
   * LIBRARY SOUND ENGINE
   * 1. Deep quiet sanctuary room presence (warm acoustic air tone)
   * 2. Rhythmic antique grandfather clock pendulum ("tick... tock...")
   * 3. Organic page-turning rustles & book paper whispers
   */
  private startLibrary(ctx: AudioContext, master: GainNode) {
    const sampleRate = ctx.sampleRate;

    // --- Layer 1: Sanctuary Room Presence (Acoustic Air Tone) ---
    const bedDuration = 4;
    const roomBuffer = ctx.createBuffer(2, sampleRate * bedDuration, sampleRate);
    generateBrownNoise(roomBuffer.getChannelData(0));
    generateBrownNoise(roomBuffer.getChannelData(1));

    const roomSource = ctx.createBufferSource();
    roomSource.buffer = roomBuffer;
    roomSource.loop = true;

    const roomFilter = ctx.createBiquadFilter();
    roomFilter.type = 'lowpass';
    roomFilter.frequency.setValueAtTime(260, ctx.currentTime);
    roomFilter.Q.setValueAtTime(0.6, ctx.currentTime);

    const roomGain = ctx.createGain();
    roomGain.gain.setValueAtTime(0.18, ctx.currentTime); // Tranquil and soft

    roomSource.connect(roomFilter);
    roomFilter.connect(roomGain);
    roomGain.connect(master);
    roomSource.start();

    this.activeNodes.push(roomSource, roomFilter, roomGain);

    // --- Layer 2: Soothing Grandfather Clock Pendulum (Tick... Tock...) ---
    this.clockIsTock = false;

    // Cache tick and tock waveforms
    const tickData = generateClockTickWaveform(sampleRate, false);
    const tickBuffer = ctx.createBuffer(1, tickData.length, sampleRate);
    tickBuffer.getChannelData(0).set(tickData);

    const tockData = generateClockTickWaveform(sampleRate, true);
    const tockBuffer = ctx.createBuffer(1, tockData.length, sampleRate);
    tockBuffer.getChannelData(0).set(tockData);

    const playClockPendulum = () => {
      if (this.currentType !== 'library' || !this.ctx) return;

      const source = ctx.createBufferSource();
      source.buffer = this.clockIsTock ? tockBuffer : tickBuffer;
      this.clockIsTock = !this.clockIsTock;

      const clockGain = ctx.createGain();
      clockGain.gain.setValueAtTime(0.14, ctx.currentTime);

      source.connect(clockGain);
      clockGain.connect(master);
      source.start();
    };

    // Steady 56 BPM pendulum rhythm (approx 1.07s between beats)
    const clockInterval = window.setInterval(playClockPendulum, 1070);
    this.activeTimers.push(clockInterval);

    // --- Layer 3: Delicate Page Turning Rustles ---
    const schedulePageTurn = () => {
      if (this.currentType !== 'library' || !this.ctx) return;

      const rustleDuration = 0.38 + Math.random() * 0.15;
      const numSamples = Math.floor(sampleRate * rustleDuration);
      const rustleBuffer = ctx.createBuffer(1, numSamples, sampleRate);
      const rData = rustleBuffer.getChannelData(0);
      const envelope = generatePageTurnEnvelope(numSamples);

      for (let i = 0; i < numSamples; i++) {
        // High-frequency textured noise modulated by the two-phase paper envelope
        const white = Math.random() * 2 - 1;
        rData[i] = white * envelope[i];
      }

      const rustleSource = ctx.createBufferSource();
      rustleSource.buffer = rustleBuffer;

      const rustleFilter = ctx.createBiquadFilter();
      rustleFilter.type = 'bandpass';
      rustleFilter.frequency.setValueAtTime(2600 + Math.random() * 800, ctx.currentTime);
      rustleFilter.Q.setValueAtTime(1.8, ctx.currentTime);

      const rustleGain = ctx.createGain();
      rustleGain.gain.setValueAtTime(0.22, ctx.currentTime);

      if (typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime((Math.random() * 2 - 1) * 0.5, ctx.currentTime);
        rustleSource.connect(panner);
        panner.connect(rustleFilter);
      } else {
        rustleSource.connect(rustleFilter);
      }

      rustleFilter.connect(rustleGain);
      rustleGain.connect(master);
      rustleSource.start();

      // Next page turn in 12 - 25 seconds
      const nextDelay = 12000 + Math.random() * 13000;
      const timer = window.setTimeout(schedulePageTurn, nextDelay);
      this.activeTimers.push(timer);
    };

    // First page turn after 4 seconds
    const initialPageTimer = window.setTimeout(schedulePageTurn, 4000);
    this.activeTimers.push(initialPageTimer);
  }
}

export const ambientSound = new AmbientSoundEngine();
