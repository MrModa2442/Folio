/**
 * Procedural Audio Mathematics and Acoustic Physics Generators
 * Decoupled pure logic for realistic soundscapes (Rain, Fireplace, Library).
 */

/**
 * Generates natural Pink Noise (1/f) using Kellet's refined 7-pole IIR filter.
 * Perfectly balances low and high frequencies for natural atmospheric precipitation.
 */
export function generatePinkNoise(data: Float32Array): void {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  const len = data.length;

  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.09;
    b6 = white * 0.115926;
  }
}

/**
 * Generates natural Brown Noise (1/f^2) with DC offset leak prevention.
 * Provides deep warmth and room acoustics (fire rumble, library sanctuary).
 */
export function generateBrownNoise(data: Float32Array): void {
  let lastOut = 0.0;
  const len = data.length;

  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    // Leaky integrator prevents unbounded DC drift
    lastOut = (lastOut + 0.025 * white) / 1.025;
    data[i] = lastOut * 3.5;
  }
}

/**
 * Generates acoustic waveform for an individual raindrop impact on windowpane.
 * Physics: Transient water contact ping with rapid downward pitch drop (f0 -> fEnd)
 * and steep exponential amplitude decay, plus high-frequency splash texture.
 */
export function generateDropletWaveform(
  sampleRate: number,
  durationSec: number = 0.028,
  startFreq: number = 2200,
  endFreq: number = 1400
): Float32Array {
  const numSamples = Math.max(1, Math.floor(sampleRate * durationSec));
  const buffer = new Float32Array(numSamples);

  let phase = 0;
  for (let i = 0; i < numSamples; i++) {
    const t = i / numSamples; // 0 to 1
    // Exponential pitch glide
    const freq = startFreq + (endFreq - startFreq) * Math.pow(t, 0.7);
    phase += (2 * Math.PI * freq) / sampleRate;

    // Fast exponential decay envelope with zero-crossing onset
    const env = Math.exp(-t * 9.5) * (1 - Math.exp(-i / (sampleRate * 0.001)));

    // Combined damped sinusoidal resonance + delicate splash transient
    const sine = Math.sin(phase);
    const splash = (Math.random() * 2 - 1) * Math.exp(-t * 18);
    buffer[i] = (sine * 0.82 + splash * 0.18) * env;
  }

  return buffer;
}

/**
 * Generates acoustic waveform for a wood crackle / snap / ember pop.
 * Physics: High-velocity wood fiber fracture with sudden pressure impulse,
 * cavity resonance of the burning log, and brief sizzle of vaporizing sap.
 */
export function generateEmberPopWaveform(
  sampleRate: number,
  durationSec: number = 0.045,
  resonanceFreq: number = 420
): Float32Array {
  const numSamples = Math.max(1, Math.floor(sampleRate * durationSec));
  const buffer = new Float32Array(numSamples);

  let phase = 0;
  const snapDuration = Math.floor(sampleRate * 0.003); // 3ms initial sharp snap

  for (let i = 0; i < numSamples; i++) {
    const t = i / numSamples;
    let sample = 0;

    // 1. Initial explosive fracture snap (high frequency crack)
    if (i < snapDuration) {
      sample += (Math.random() * 2 - 1) * (1 - i / snapDuration) * 1.5;
    }

    // 2. Damped wood log cavity resonance
    phase += (2 * Math.PI * resonanceFreq) / sampleRate;
    const bodyDecay = Math.exp(-t * 14.0);
    sample += Math.sin(phase) * bodyDecay * 0.6;

    // 3. Sizzling sap / steam release tail
    const steam = (Math.random() * 2 - 1) * Math.exp(-t * 8.0) * 0.25;
    sample += steam;

    // Overall envelope
    buffer[i] = Math.max(-1, Math.min(1, sample * 0.75));
  }

  return buffer;
}

/**
 * Generates acoustic waveform for antique grandfather clock pendulum tick / tock.
 * Physics: Soft wooden escapement click with warm acoustic body resonance.
 */
export function generateClockTickWaveform(
  sampleRate: number,
  isTock: boolean = false
): Float32Array {
  const durationSec = isTock ? 0.038 : 0.032;
  const numSamples = Math.max(1, Math.floor(sampleRate * durationSec));
  const buffer = new Float32Array(numSamples);

  // Tick is crisper (~1250 Hz), Tock is warmer and slightly deeper (~920 Hz)
  const primaryFreq = isTock ? 920 : 1260;
  const secondaryFreq = isTock ? 640 : 880;

  let phase1 = 0;
  let phase2 = 0;

  for (let i = 0; i < numSamples; i++) {
    const t = i / numSamples;
    phase1 += (2 * Math.PI * primaryFreq) / sampleRate;
    phase2 += (2 * Math.PI * secondaryFreq) / sampleRate;

    // Wooden strike transient + damped acoustic decay
    const strike = i < Math.floor(sampleRate * 0.002) ? (Math.random() * 2 - 1) * 0.35 : 0;
    const tone = Math.sin(phase1) * 0.65 + Math.sin(phase2) * 0.35;
    const env = Math.exp(-t * 12.0);

    buffer[i] = (strike + tone) * env * 0.45;
  }

  return buffer;
}

/**
 * Generates organic page turning amplitude envelope.
 * Physics: Two-phase paper motion:
 * Phase 1 (0 -> 40%): Gentle lift and flex (swells softly)
 * Phase 2 (40% -> 100%): Turn over and settle onto book stack (decays with subtle flutter)
 */
export function generatePageTurnEnvelope(numSamples: number): Float32Array {
  const env = new Float32Array(numSamples);
  const turnPoint = Math.floor(numSamples * 0.38);

  for (let i = 0; i < numSamples; i++) {
    if (i < turnPoint) {
      // Swell
      const progress = i / turnPoint;
      env[i] = Math.sin((progress * Math.PI) / 2) * 0.55;
    } else {
      // Release & settle
      const progress = (i - turnPoint) / (numSamples - turnPoint);
      // Slight paper flutter
      const flutter = 1 + 0.15 * Math.sin(progress * Math.PI * 6);
      env[i] = Math.exp(-progress * 3.8) * 0.55 * flutter;
    }
  }

  return env;
}

/**
 * Generates random Poisson-like time interval for natural, non-robotic acoustic events.
 */
export function calculatePoissonInterval(minMs: number, maxMs: number): number {
  // Triangular / exponential distribution favoring natural clusters
  const r = Math.random();
  const skew = r * r; // slight bias towards smaller intervals for natural burstiness
  return minMs + (maxMs - minMs) * skew;
}
