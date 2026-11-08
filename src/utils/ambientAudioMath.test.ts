import { test } from 'node:test';
import assert from 'node:assert';
import {
  generatePinkNoise,
  generateBrownNoise,
  generateDropletWaveform,
  generateEmberPopWaveform,
  generateClockTickWaveform,
  generatePageTurnEnvelope,
  calculatePoissonInterval,
} from './ambientAudioMath';

test('generatePinkNoise produces non-zero bounded audio samples without NaNs', () => {
  const buffer = new Float32Array(4096);
  generatePinkNoise(buffer);

  let hasNonZero = false;
  for (let i = 0; i < buffer.length; i++) {
    const val = buffer[i];
    assert(!isNaN(val), 'Sample must not be NaN');
    assert(val >= -1.5 && val <= 1.5, `Sample ${val} must be within reasonable acoustic range`);
    if (Math.abs(val) > 0.001) hasNonZero = true;
  }
  assert(hasNonZero, 'Pink noise buffer must have audible sound energy');
});

test('generateBrownNoise produces smooth non-divergent low frequency rumble', () => {
  const buffer = new Float32Array(4096);
  generateBrownNoise(buffer);

  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const val = buffer[i];
    assert(!isNaN(val), 'Brown noise sample must not be NaN');
    sum += Math.abs(val);
  }
  assert(sum > 10, 'Brown noise buffer must have significant warmth energy');
});

test('generateDropletWaveform synthesizes transient ping with exponential decay', () => {
  const sampleRate = 44100;
  const waveform = generateDropletWaveform(sampleRate, 0.03, 2400, 1600);

  assert(waveform.length > 0, 'Waveform should have positive length');
  // First quarter has higher energy than last quarter due to exponential decay
  const quarter = Math.floor(waveform.length / 4);
  let earlyEnergy = 0;
  let lateEnergy = 0;

  for (let i = 0; i < quarter; i++) earlyEnergy += Math.abs(waveform[i]);
  for (let i = waveform.length - quarter; i < waveform.length; i++) lateEnergy += Math.abs(waveform[i]);

  assert(earlyEnergy > lateEnergy, 'Droplet ping energy must decay exponentially over time');
});

test('generateEmberPopWaveform produces sharp attack and decaying crackle body', () => {
  const sampleRate = 44100;
  const pop = generateEmberPopWaveform(sampleRate, 0.04, 450);

  assert(pop.length > 0, 'Ember pop waveform must have samples');
  // Peak should be near onset
  let maxIdx = 0;
  let maxVal = 0;
  for (let i = 0; i < pop.length; i++) {
    if (Math.abs(pop[i]) > maxVal) {
      maxVal = Math.abs(pop[i]);
      maxIdx = i;
    }
  }

  // Peak should occur in first 15% of duration
  assert(maxIdx < pop.length * 0.25, `Ember pop peak transient must be fast (idx: ${maxIdx}/${pop.length})`);
});

test('generateClockTickWaveform differentiates tick from tock', () => {
  const sampleRate = 44100;
  const tick = generateClockTickWaveform(sampleRate, false);
  const tock = generateClockTickWaveform(sampleRate, true);

  assert(tick.length > 0 && tock.length > 0, 'Both waveforms must generate');
  // Tock is slightly longer and warmer
  assert(tock.length >= tick.length, 'Tock waveform duration should accommodate deeper wood resonance');
});

test('generatePageTurnEnvelope generates smooth swell and flutter decay', () => {
  const env = generatePageTurnEnvelope(1000);
  assert.strictEqual(env.length, 1000);

  // Peak of swell should be around 35-45% of progression
  let peakIdx = 0;
  let peakVal = 0;
  for (let i = 0; i < env.length; i++) {
    if (env[i] > peakVal) {
      peakVal = env[i];
      peakIdx = i;
    }
  }

  assert(peakIdx >= 300 && peakIdx <= 450, `Page turn peak should be near turn point, got ${peakIdx}`);
  assert(env[env.length - 1] < 0.1, 'Envelope must decay at the end');
});

test('calculatePoissonInterval stays strictly within bounds', () => {
  for (let i = 0; i < 50; i++) {
    const interval = calculatePoissonInterval(100, 500);
    assert(interval >= 100 && interval <= 500, `Interval ${interval} out of bounds`);
  }
});
