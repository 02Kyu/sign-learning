import { dtw } from '../js/signbridge/dtw.js';

export const PASS_SCORE = 90;
export const CAPTURE_MS = 2600;
const MODEL_ROWS = 30;
const DIRECTION_COUNT = 75;
const JOINTS_PER_HAND = 16;
const FEATURE_COUNT = DIRECTION_COUNT + JOINTS_PER_HAND * 2;
const MATCH_DISTANCE_LIMIT = 4.75;
const HAND_SHAPE_LIMIT = 0.4;
const MIN_CLASS_GAP = 0.21;
const FINGERTIPS = [4, 8, 12, 16, 20];
const NO_HAND = Array(JOINTS_PER_HAND).fill(0);
const FEATURE_SCALE = [
  ...Array(12).fill(Math.sqrt(1.5)),
  ...Array(30).fill(Math.sqrt(2.5)),
  ...Array(9).fill(Math.sqrt(2)),
  ...Array(6).fill(Math.sqrt(3)),
  ...Array(18).fill(Math.sqrt(2)),
];

function direction(from, to) {
  const vector = [to.x - from.x, to.y - from.y, to.z - from.z];
  const length = Math.hypot(...vector);
  return length ? vector.map(value => value / length) : [0, 0, 0];
}

function midpoint(points) {
  const average = axis => points.reduce((sum, point) => sum + point[axis], 0) / points.length;
  return { x: average('x'), y: average('y'), z: average('z') };
}

function inFrame(point) {
  return point && Number.isFinite(point.z) && point.x > 0 && point.x < 1 && point.y > 0 && point.y < 1;
}

function handFeatures(hand, fallback) {
  if (hand?.length !== 21) {
    return { visible: false, values: fallback };
  }
  if (!inFrame(hand[0]) || !FINGERTIPS.every(index => inFrame(hand[index]))) {
    return { visible: false, cropped: true, values: fallback };
  }
  return { visible: true, values: FINGERTIPS.flatMap(index => direction(hand[0], hand[index])) };
}

function jointBend(previous, joint, next) {
  const first = direction(previous, joint);
  const second = direction(joint, next);
  const cosine = first.reduce((sum, value, coordinate) => sum + value * second[coordinate], 0);
  return (1 - Math.max(-1, Math.min(1, cosine))) / 2;
}

function jointFeatures(hand) {
  if (hand?.length !== 21 || !hand.every(inFrame)) return NO_HAND;
  return [1, ...FINGERTIPS.flatMap(tip => {
    const base = tip - 3;
    return [
      jointBend(hand[0], hand[base], hand[base + 1]),
      jointBend(hand[base], hand[base + 1], hand[base + 2]),
      jointBend(hand[base + 1], hand[base + 2], hand[tip]),
    ];
  })];
}

export class FeatureExtractor {
  // The reference set records MediaPipe on unmirrored frames.
  constructor() {
    this.left = Array(15).fill(0);
    this.right = Array(15).fill(0);
    this.lastSeen = [-Infinity, -Infinity];
  }

  extract(results, at) {
    const pose = results.poseLandmarks;
    if (pose?.length !== 33 || ![0, 11, 12].every(index =>
      inFrame(pose[index]) && (pose[index].visibility ?? 1) >= 0.5)) return null;
    if (![13, 14, 15, 16, 23, 24].every(index => Number.isFinite(pose[index]?.x) &&
      Number.isFinite(pose[index]?.y) && Number.isFinite(pose[index]?.z))) return null;

    const left = handFeatures(results.leftHandLandmarks, at - this.lastSeen[0] < 220 ? this.left : Array(15).fill(0));
    const right = handFeatures(results.rightHandLandmarks, at - this.lastSeen[1] < 220 ? this.right : Array(15).fill(0));
    const leftJoints = jointFeatures(results.leftHandLandmarks);
    const rightJoints = jointFeatures(results.rightHandLandmarks);
    if (left.cropped || right.cropped || (!leftJoints[0] && !rightJoints[0])) return null;
    this.left = left.values;
    this.right = right.values;
    if (left.visible) this.lastSeen[0] = at;
    if (right.visible) this.lastSeen[1] = at;

    const [head, leftShoulder, rightShoulder, leftElbow, rightElbow, leftWrist, rightWrist, leftHip, rightHip] =
      [0, 11, 12, 13, 14, 15, 16, 23, 24].map(index => pose[index]);
    const center = midpoint([leftShoulder, rightShoulder]);
    const torso = midpoint([leftShoulder, rightShoulder, leftHip, rightHip]);
    return [
      ...direction(leftShoulder, leftElbow), ...direction(rightShoulder, rightElbow),
      ...direction(leftElbow, leftWrist), ...direction(rightElbow, rightWrist),
      ...left.values, ...right.values,
      ...direction(leftWrist, rightWrist), ...direction(center, leftWrist), ...direction(center, rightWrist),
      ...direction(head, leftWrist), ...direction(head, rightWrist),
      ...[leftShoulder, rightShoulder, torso].flatMap(point =>
        [...direction(point, leftWrist), ...direction(point, rightWrist)]),
      ...leftJoints, ...rightJoints,
    ];
  }
}

function frameDifference(first, second) {
  let difference = 0;
  for (let feature = 0; feature < DIRECTION_COUNT; feature++) {
    difference += (first[feature] - second[feature]) ** 2;
  }
  return Math.sqrt(difference);
}

function motionRange(samples) {
  const motion = samples.slice(1).map((sample, index) => frameDifference(sample.row, samples[index].row));
  const strongest = Math.max(...motion);
  const average = motion.reduce((sum, value) => sum + value, 0) / motion.length;
  if (strongest < 0.27 || average < 0.075) return null;

  const active = motion.flatMap((value, index) => value >= strongest * 0.22 ? [index] : []);
  return samples.slice(Math.max(0, active[0] - 2), Math.min(samples.length, active.at(-1) + 4));
}

function resample(samples) {
  const start = samples[0].at;
  const duration = samples.at(-1).at - start;
  let index = 0;
  return Array.from({ length: MODEL_ROWS }, (_, row) => {
    const time = start + duration * row / (MODEL_ROWS - 1);
    while (index < samples.length - 2 && samples[index + 1].at < time) index++;
    const first = samples[index];
    const second = samples[index + 1];
    const fraction = (time - first.at) / (second.at - first.at);
    return first.row.map((value, feature) => value + fraction * (second.row[feature] - value));
  });
}

export function prepareAttempt(samples) {
  const available = samples.filter(sample => sample.row);
  if (available.length < 8) return { reason: 'framing' };

  const active = motionRange(available);
  if (!active || active.at(-1).at - active[0].at < 320) return { reason: 'motion' };
  const start = active[0].at;
  const end = active.at(-1).at;
  const expectedFrames = samples.filter(sample => sample.at >= start && sample.at <= end).length;
  if (active.length < 8 || active.length / expectedFrames < 0.7 ||
      active.slice(1).some((sample, index) => sample.at - active[index].at > 450)) {
    return { reason: 'framing' };
  }
  return { sequence: resample(active) };
}

function weighted(row) {
  return row.slice(0, DIRECTION_COUNT).map((value, index) => value * FEATURE_SCALE[index]);
}

export function loadTemplates(pack) {
  const hasJoints = pack?.format === 'itda-joints-v2';
  if ((!hasJoints && pack?.format !== 'itda-direction-v1') || !pack.templates || typeof pack.templates !== 'object') {
    throw new Error('한국수어 모델 형식을 확인할 수 없습니다.');
  }
  const size = hasJoints ? FEATURE_COUNT : DIRECTION_COUNT;
  const templates = new Map();
  for (const [label, examples] of Object.entries(pack.templates)) {
    if (!examples.length || !examples.every(sequence => sequence.length === MODEL_ROWS &&
      sequence.every(row => row.length === size && row.every(Number.isFinite)))) {
      throw new Error(`한국수어 모델의 ${label} 데이터가 올바르지 않습니다.`);
    }
    templates.set(label, examples.map(sequence => ({
      directions: sequence.map(weighted),
      joints: hasJoints ? sequence : null,
    })));
  }
  return templates;
}

function handShapeDifference(actual, reference, path, offset) {
  const fingers = Array(5).fill(0);
  let expected = 0;
  let seen = 0;
  for (const [first, second] of path) {
    const target = reference[second];
    if (target[offset] < 0.55) continue;
    expected++;
    const observed = actual[first];
    if (observed[offset] < 0.55) continue;
    seen++;
    for (let finger = 0; finger < fingers.length; finger++) {
      const joint = offset + 1 + finger * 3;
      fingers[finger] += 0.2 * Math.abs(observed[joint] - target[joint]) +
        0.5 * Math.abs(observed[joint + 1] - target[joint + 1]) +
        0.3 * Math.abs(observed[joint + 2] - target[joint + 2]);
    }
  }
  if (expected < 10) return 0;
  if (seen < expected * 0.6) return 1;
  return Math.max(...fingers) / seen;
}

function compareTemplate(sequence, directions, example) {
  const { distance, path } = dtw(directions, example.directions);
  const directionDistance = distance / MODEL_ROWS;
  if (!example.joints) return { directions: directionDistance, handShape: 0, total: directionDistance };

  const handShape = Math.max(
    handShapeDifference(sequence, example.joints, path, DIRECTION_COUNT),
    handShapeDifference(sequence, example.joints, path, DIRECTION_COUNT + JOINTS_PER_HAND),
  );
  return { directions: directionDistance, handShape, total: directionDistance + 2 * handShape };
}

export function classifyTarget(sequence, target, templates) {
  const examples = templates.get(target);
  if (!examples) throw new Error('모델에 선택한 단어가 없습니다.');
  const inputSize = examples[0].joints ? FEATURE_COUNT : DIRECTION_COUNT;
  if (sequence.length !== MODEL_ROWS || sequence.some(row => row.length < inputSize || !row.every(Number.isFinite))) {
    throw new Error('이번 동작의 특징 자료가 부족합니다.');
  }
  const directions = sequence.map(weighted);
  let bestTarget;
  let rivalDistance = Infinity;
  for (const [label, examples] of templates) {
    for (const example of examples) {
      const match = compareTemplate(sequence, directions, example);
      if (label !== target) rivalDistance = Math.min(rivalDistance, match.total);
      else if (!bestTarget || match.total < bestTarget.total) bestTarget = match;
    }
  }

  // A similar trajectory cannot make up for a different finger shape or an ambiguous label.
  const separation = PASS_SCORE + 16 * (rivalDistance - bestTarget.total - MIN_CLASS_GAP);
  const closeness = PASS_SCORE + 12 * (MATCH_DISTANCE_LIMIT - bestTarget.directions);
  const handShape = PASS_SCORE + 60 * (HAND_SHAPE_LIMIT - bestTarget.handShape);
  const score = Math.max(0, Math.min(100, Math.floor(Math.min(separation, closeness, handShape))));
  return { score, verdict: score >= PASS_SCORE ? 'pass' : 'fail' };
}
