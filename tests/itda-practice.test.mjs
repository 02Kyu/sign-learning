import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { classifyTarget, FeatureExtractor, loadTemplates, prepareAttempt } from '../web/practice/recognition.mjs';
import { WORDS } from '../web/practice/words.mjs';

const pack = JSON.parse(await readFile(new URL('../web/practice/model.json', import.meta.url), 'utf8'));
const templates = loadTemplates(pack);

test('the ten lessons have distinct model labels, dictionary entries, and videos', () => {
  assert.equal(WORDS.length, 10);
  assert.equal(new Set(WORDS.map(word => word.label)).size, 10);
  assert.equal(new Set(WORDS.map(word => word.video)).size, 10);
  for (const word of WORDS) {
    assert.ok(templates.has(word.label));
    assert.equal(new URL(word.source).hostname, 'sldict.korean.go.kr');
    assert.match(word.video, /\.mp4$/);
  }
});

test('model references exercise both output states and the scores agree with the verdicts', () => {
  for (const [index, word] of WORDS.entries()) {
    const other = WORDS[(index + 1) % WORDS.length];
    const consistent = classifyTarget(pack.templates[word.label][0], word.label, templates);
    const different = classifyTarget(pack.templates[other.label][0], word.label, templates);
    assert.equal(consistent.verdict, 'pass', word.name);
    assert.ok(consistent.score >= 90 && consistent.score <= 100, word.name);
    assert.equal(different.verdict, 'fail', word.name);
    assert.ok(different.score < 90 && different.score >= 0, word.name);
  }
});

test('incorrect finger bends cannot pass with the original wrist and fingertip trajectories', () => {
  const offsets = [75, 91];
  for (const word of WORDS) {
    const correct = pack.templates[word.label][0];
    for (const offset of offsets) {
      if (correct.filter(row => row[offset] >= 0.55).length < 14) continue;
      for (let finger = 0; finger < 5; finger++) {
        const changed = correct.map(row => {
          if (row[offset] < 0.55) return row;
          const frame = row.slice();
          const first = offset + 1 + finger * 3;
          for (let joint = first; joint < first + 3; joint++) {
            frame[joint] = frame[joint] > 0.5 ? 0 : 1;
          }
          return frame;
        });
        const result = classifyTarget(changed, word.label, templates);
        assert.equal(result.verdict, 'fail', `${word.label}, hand ${offset}, finger ${finger}`);
        assert.ok(result.score < 90);
      }
    }
  }
});

test('a fractionally closer target is not enough for a positive verdict', () => {
  const target = WORDS[0].label;
  const reference = pack.templates[target][0];
  const closeRival = reference.map(row => row.map((value, index) => index === 0 ? value + 0.002 : value));
  const almostIdentical = loadTemplates({
    format: 'itda-joints-v2', templates: { [target]: [reference], rival: [closeRival] },
  });
  assert.equal(classifyTarget(reference, target, almostIdentical).verdict, 'fail');
});

test('too little capture or a long interruption produces a retry', () => {
  const sequence = pack.templates[WORDS[0].label][0];
  assert.deepEqual(prepareAttempt(sequence.map((_, index) => ({ at: index * 90, row: null }))), { reason: 'framing' });
  const interrupted = sequence.map((row, index) => ({ at: index * 85, row: index >= 10 && index < 18 ? null : row }));
  assert.deepEqual(prepareAttempt(interrupted), { reason: 'framing' });
});

test('a stationary pose is not judged as a sign', () => {
  const row = pack.templates[WORDS[0].label][0][0];
  const samples = Array.from({ length: 18 }, (_, index) => ({ at: index * 90, row }));
  assert.deepEqual(prepareAttempt(samples), { reason: 'motion' });
});

test('a visible dynamic capture is converted to the model time and feature dimensions', () => {
  const samples = pack.templates[WORDS[0].label][0].map((row, index) => ({ at: index * 85, row }));
  const { sequence } = prepareAttempt(samples);
  assert.equal(sequence.length, 30);
  assert.ok(sequence.every(row => row.length === 107 && row.every(Number.isFinite)));
});

test('one complete hand is accepted and a clipped detected hand is rejected', () => {
  const poseLandmarks = Array.from({ length: 33 }, (_, index) => ({
    x: 0.1 + index / 60, y: 0.2 + index / 60, z: 0, visibility: 1,
  }));
  const leftHandLandmarks = Array.from({ length: 21 }, (_, index) => ({ x: 0.25 + index / 50, y: 0.5, z: 0 }));
  const extractor = new FeatureExtractor();
  const features = extractor.extract({ poseLandmarks, leftHandLandmarks }, 0);
  assert.equal(features.length, 107);
  assert.equal(features[75], 1);
  assert.equal(features[91], 0);
  leftHandLandmarks[20] = { x: 1.1, y: 0.5, z: 0 };
  assert.equal(extractor.extract({ poseLandmarks, leftHandLandmarks }, 100), null);
});
