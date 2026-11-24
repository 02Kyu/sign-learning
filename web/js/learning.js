/**
 * learning.js — 수어 학습용 정확도 판정 + 기준 동작 비교 (우리가 새로 작성)
 *
 * 대만 수어 인식(Meganlin0000/taiwan-sign-language-recognition, MIT)과
 * SignBridge(mhmdtaha091/SignBridge, MIT)의 비교 엔진을 이어 붙이는 모듈이다.
 *
 *   AccuracyJudge       목표 단어를 맞게 했는지 판정 (통과 / 오답 / 시간 초과, 0~100점)
 *                       ← 대만 모델의 단어별 확률을 받는다
 *   MotionRecorder      손이 움직이기 시작해서 멈출 때까지를 시도 하나로 자동 기록
 *   compareToReference  기준 동작과 비교해 무엇이 얼마나 다른지
 *                       ← signbridge/normalize.js(특징 159개) → signbridge/dtw.js(시간 맞추기, 점수)
 *                         → signbridge/feedback.js(차이 설명: 손 위치·손바닥·움직임 크기·속도·가장 다른 구간,
 *                           마디별 굽힘·손가락 사이 벌림·손가락 끝 닿음·엄지 접힘)
 *   LearningSession     위 셋을 묶어 app.js에 몇 줄만 넣으면 되게 한 것
 *
 * 쓰는 파일: 대만 preprocess.js, signbridge/dtw.js, signbridge/normalize.js, signbridge/feedback.js
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ※ 이 저장소(korean-learning 브랜치)에는 아래 설치 1~3이 이미 적용돼 있다.
 *   다른 사본에 옮길 때만 참고한다. 테스트: node tests/learning.test.mjs, node tests/signbridge.test.mjs
 *
 * 설치 1. 이 파일을 web/js/learning.js로, signbridge 폴더를 web/js/signbridge/로 넣는다.
 *
 * 설치 2. 대만 코드에 박혀 있는 단어 수 25를 우리 모델에 맞게 고친다 (안 고치면 판정이 안 된다).
 *   web/js/recognition-core.js 25행
 *     scores.length !== 25                →  scores.length !== Object.keys(labels).length
 *   web/js/inference-worker.js 28행
 *     d.先驗.length === 25                 →  d.先驗.length === model.outputs[0].shape[1]
 *   web/js/inference-worker.js 54행
 *     : Array.from({length:25}, (_,k) => (flat[k] + flat[25+k]) / 2);
 *                                         →  : Array.from({length:flat.length/2}, (_,k) => (flat[k] + flat[flat.length/2+k]) / 2);
 *   web/js/inference-worker.js 60행
 *     scores.length !== 25                →  scores.length !== model.outputs[0].shape[1]
 *   web/js/continuous-core.js 168행
 *     index < 25                          →  index < 10000
 *   web/js/continuous-core.js 457행
 *     scores.length !== 25                →  scores.length < 2
 *
 * 설치 3. web/js/app.js에 네 군데를 넣는다.
 *   (1) 맨 위 import 아래
 *         import { LearningSession } from './learning.js';
 *         const learning = new LearningSession({
 *           continuous,                                   // ← 45행의 const continuous 아래에 두기
 *           onVerdict: v => showVerdict(v),   // v.verdict, v.message, v.score → 화면 표시 함수는 직접 작성
 *           onReport:  r => showReport(r),    // r.score, r.messages
 *         });
 *   (2) dataReady 안 `labels = names;` 바로 아래 (480행 부근)
 *         learning.setLabels(names);
 *   (3) onResults 안 1079행 `const state = continuous.push(extractKeypoints(results), latestFrameValid, now);` 를
 *         const frame = extractKeypoints(results);
 *         learning.onFrame(frame, latestFrameValid, now);
 *         const state = continuous.push(frame, latestFrameValid, now);
 *   (4) predictLatest 안 `const decision = continuous.observe(...);` 바로 아래 (1176행 부근)
 *         learning.onPrediction(result.scores, decision);
 *   단어를 고를 때:  await learning.start('학교');    끝낼 때:  learning.stop();
 *
 * 설치 4. 기준 동작 파일 web/references/{단어}.json 을 만든다.
 *   tools/抽關鍵點.py로 좌표를 뽑은 뒤 tools/make_reference.py를 실행한다 (Python 도구라 별도 파일).
 *   기준 동작 파일이 없는 단어는 정확도 판정만 하고 비교 결과(onReport)는 나오지 않는다.
 *
 * 처음에 맞출 것
 *   - HAND_NAMES (signbridge/feedback.js): 오른손만 들고 한 번 확인해서, "왼손"으로 나오면 두 이름을 바꾼다.
 *   - COMPARE_OPTIONS.scoreScale: 1이면 SignBridge 원본 점수 식. 손가락 하나만 틀려도 0점이 되면 2~3으로 올린다.
 *   - FEEDBACK_OPTIONS (signbridge/feedback.js)의 알림 기준: 팀원의 "맞게 한 동작"에서 지적이 나오지 않을
 *     정도로 맞춘다. 판정 기준은 AccuracyJudge 옵션(passScore 등).
 * ────────────────────────────────────────────────────────────────────────────
 */
import { resampleActive, frameAspectScaleY, REF_ASPECT, RAW_DIM } from './preprocess.js';
import { dtw } from './signbridge/dtw.js';
import { taiwanToFeatures, featureDistance, FEATURE_SIZE, POSE_UPPER_SIZE } from './signbridge/normalize.js';
import { handGeometry, generateFeedback } from './signbridge/feedback.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1부. 정확도 판정 (AccuracyJudge)
   result.scores는 워커가 좌우 반전 평균과 사전확률 보정을 끝낸 "모든 단어의 확률"이라
   목표 단어의 확률을 바로 읽어 점수로 쓴다.
   ═══════════════════════════════════════════════════════════════════════════ */

export const Verdict = Object.freeze({
  IDLE: 'idle',         // 연습 단어를 아직 고르지 않음
  WAITING: 'waiting',   // 손이 안 잡히거나 아직 움직이지 않음
  CHECKING: 'checking', // 판정 중
  WRONG: 'wrong',       // 다른 단어로 보임 (계속 시도 가능)
  PASS: 'pass',         // 통과 (최종)
  TIMEOUT: 'timeout',   // 시간 초과 (최종)
});

export class AccuracyJudge {
  constructor(options = {}) {
    this.options = Object.freeze({
      passScore: 0.90,   // 목표 단어 확률 기준 (대만 사이트의 확정 기준 CONFIRM_THRESHOLD와 같음)
      passCount: 3,      // 기준 이상이 연속 몇 번이면 통과 (추론은 약 0.25초마다)
      wrongScore: 0.60,  // 다른 단어 확률이 이 이상이면 "다른 단어로 보임"
      timeoutMs: 15000,
      ...options,
    });
    this.labels = {};
    this.target = null;
    this.targetIndex = -1;
    this._final = null;
  }

  /** labels.json 내용({"0": "학교", ...})을 넘긴다. */
  setLabels(labels) {
    this.labels = labels || {};
  }

  /** 연습할 단어를 정하고 새 시도를 시작한다. 호출한 쪽에서 continuous.reset()도 함께 해 준다. */
  start(targetLabel, now = performance.now()) {
    const entry = Object.entries(this.labels).find(([, label]) => label === targetLabel);
    if (!entry) throw new Error(`모델 단어 목록에 없는 단어입니다: ${targetLabel}`);
    this.target = targetLabel;
    this.targetIndex = Number(entry[0]);
    this.startedAt = now;
    this.streak = 0;
    this.best = 0;          // 이번 시도에서 목표 단어가 받은 최고 확률
    this.bestRank = null;   // 그때의 순위 (1 = 1등)
    this._final = null;
  }

  /** 예측 결과가 나올 때마다 호출. predictLatest()의 observe() 바로 아래. */
  update(scores, decision, now = performance.now()) {
    if (this._final) return this._final;
    if (this.targetIndex < 0) return this._result(Verdict.IDLE, '연습할 단어를 골라주세요.');
    const timeout = this._checkTimeout(now);
    if (timeout) return timeout;

    // 손이 덜 잡혔거나 움직이지 않으면 판정하지 않는다 (observe가 알려준다)
    if (decision && (decision.reason === 'not_ready' || decision.reason === 'not_moving')) {
      this.streak = 0;
      return this._result(Verdict.WAITING, decision.reason === 'not_moving'
        ? '동작을 시작해주세요.'
        : '상체와 두 손이 화면에 들어오게 해주세요.');
    }
    if (!scores || scores.length <= this.targetIndex) {
      return this._result(Verdict.WAITING, '인식 결과를 기다리는 중이에요.');
    }

    const targetScore = scores[this.targetIndex];
    let top = 0;
    for (let i = 1; i < scores.length; i += 1) if (scores[i] > scores[top]) top = i;
    const rank = 1 + Array.from(scores).filter(s => s > targetScore).length;

    if (targetScore > this.best) { this.best = targetScore; this.bestRank = rank; }
    this.streak = targetScore >= this.options.passScore ? this.streak + 1 : 0;

    const extra = { targetScore, rank, topLabel: this.labels[String(top)], topScore: scores[top] };

    // 통과: 목표 확률이 기준 이상으로 연속 passCount번, 또는 인식기가 목표 단어를 확정했을 때
    const confirmedTarget = decision?.confirmed && decision.confirmed.index === this.targetIndex;
    if (this.streak >= this.options.passCount || confirmedTarget) {
      this._final = this._result(Verdict.PASS, this._passMessage(), extra);
      return this._final;
    }

    if (top !== this.targetIndex && scores[top] >= this.options.wrongScore) {
      return this._result(Verdict.WRONG,
        `'${extra.topLabel}'(으)로 보여요. '${this.target}' 동작을 다시 확인해보세요.`, extra);
    }
    return this._result(Verdict.CHECKING,
      rank <= 3 ? '거의 맞아요. 동작을 조금 더 또렷하게 해보세요.' : '동작을 확인하고 있어요.', extra);
  }

  /** 예측이 안 나오는 동안(손이 화면 밖 등)에도 시간 초과를 확인하려면 프레임마다 호출. */
  tick(now = performance.now()) {
    return this._final || this._checkTimeout(now);
  }

  get finished() { return Boolean(this._final); }

  /** 0~100점. 이번 시도에서 목표 단어가 받은 최고 확률 기준. */
  get score() { return Math.round(this.best * 100); }

  _checkTimeout(now) {
    if (now - this.startedAt <= this.options.timeoutMs) return null;
    const hint = this.bestRank && this.bestRank <= 3
      ? '비슷했지만 확실하지 않았어요.' : '예시 동작을 한 번 더 보고 해보세요.';
    this._final = this._result(Verdict.TIMEOUT, `시간이 지났어요. ${hint} (최고 ${this.score}점)`);
    return this._final;
  }

  _passMessage() {
    const s = this.score;
    if (s >= 97) return `정확해요! (${s}점)`;
    if (s >= 93) return `잘했어요! (${s}점)`;
    return `통과예요. 동작을 조금 더 또렷하게 하면 더 좋아요. (${s}점)`;
  }

  _result(verdict, message, extra = {}) {
    return {
      verdict, message, target: this.target, score: this.score,
      streak: this.streak, done: verdict === Verdict.PASS || verdict === Verdict.TIMEOUT,
      ...extra,
    };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   2부. 기준 동작 비교 (MotionRecorder, compareToReference) — SignBridge 비교 엔진 사용
   1) 대만 258개 좌표 → SignBridge 159개 특징 (signbridge/normalize.js의 어댑터)
   2) SignBridge DTW로 시간 맞추기 (signbridge/dtw.js)
   3) 점수 = SignBridge 식 (1 - 정규화 거리) × 100 (scoreScale로 폭 조절 가능)
   4) 차이 설명 = signbridge/feedback.js (SignBridge 규칙 흐름 + 고친 점 + 관절 규칙)
   ═══════════════════════════════════════════════════════════════════════════ */

export { HAND_NAMES, FEEDBACK_OPTIONS } from './signbridge/feedback.js';

const HAND_OFFSETS = [132, 195];   // 258개 좌표 안에서 손 블록 A(사용자 오른손), B(왼손)의 시작 위치

export const COMPARE_OPTIONS = Object.freeze({
  rows: 40,          // 비교할 때 두 동작을 맞추는 길이 (프레임 수)
  centerPose: true,  // 시간 맞추기 전에 상체 좌표의 평균을 빼서, 손이 전체적으로 낮은 차이가
                     // 시간 어긋남으로 흡수되지 않게 한다 (점수와 피드백은 평균을 빼기 전 좌표로 잰다)
  scoreScale: 1,     // 점수 = 100 × (1 - 정규화 거리 / scoreScale). 1이면 SignBridge 원본 식 그대로.
                     // 실제 데이터에서 손가락 하나만 틀려도 0점이 되면 2~3으로 올려 점수 폭을 넓힌다
  // 피드백 기준값(maxMessages, posThreshold, bendThreshold …)도 여기에 같이 넘기면 된다. 기본값은 FEEDBACK_OPTIONS
});

/* ── 기준 동작 불러오기 ───────────────────────────────── */

/** references/{단어}.json → 비교에 쓰는 형태. 파일은 make_reference.py가 만든다. */
export function loadReference(json) {
  return {
    word: json.word,
    fps: json.fps || 30,
    aspect: json.aspect || REF_ASPECT,   // 기준 영상의 가로÷세로
    frames: json.frames.map(f => Float32Array.from(f)),
  };
}

/* ── 시도 구간 자동 기록 ──────────────────────────────── */

/**
 * 손이 움직이기 시작하면 기록을 시작하고, 손을 내리거나 멈추면 시도 하나로 잘라서 돌려준다.
 * 속도 단위는 "화면 너비 / 초"다.
 */
export class MotionRecorder {
  constructor(options = {}) {
    this.o = { keepMs: 6000, startSpeed: 0.15, stillSpeed: 0.06, stillMs: 500, goneMs: 300,
               minActiveMs: 400, preMs: 300, ...options };
    this.reset();
  }

  reset() {
    this.buf = [];            // {frame, valid, time}
    this.active = false;
    this.startAt = 0;
    this.lastMoveAt = 0;
    this.lastHandAt = 0;
    this.speed = 0;
    this.prevWrists = null;
  }

  push(frame, valid, now) {
    this.buf.push({ frame: valid ? Float32Array.from(frame) : null, valid, time: now });
    while (this.buf.length && now - this.buf[0].time > this.o.keepMs) this.buf.shift();

    const wrists = valid ? HAND_OFFSETS.map(off => (frame[off] || frame[off + 1]) ? [frame[off], frame[off + 1]] : null) : [null, null];
    const anyHand = wrists.some(Boolean);
    if (anyHand) this.lastHandAt = now;

    // 손목 속도 (두 손 중 빠른 쪽), 지수 평균으로 흔들림 줄이기
    let v = 0;
    if (this.prevWrists && anyHand) {
      const dt = Math.max(1, now - this.prevWrists.time) / 1000;
      wrists.forEach((w, h) => {
        const p = this.prevWrists.w[h];
        if (w && p) v = Math.max(v, Math.hypot(w[0] - p[0], w[1] - p[1]) / dt);
      });
    }
    this.speed = 0.6 * this.speed + 0.4 * v;
    this.prevWrists = { w: wrists, time: now };

    if (!this.active) {
      if (anyHand && this.speed > this.o.startSpeed) {
        this.active = true;
        this.startAt = now - this.o.preMs;
        this.lastMoveAt = now;
      }
      return null;
    }

    if (this.speed > this.o.stillSpeed) this.lastMoveAt = now;
    const gone = now - this.lastHandAt > this.o.goneMs;
    const still = now - this.lastMoveAt > this.o.stillMs;
    if (!gone && !still) return null;

    // 시도 끝
    this.active = false;
    const endAt = gone ? this.lastHandAt : this.lastMoveAt;
    if (endAt - this.startAt < this.o.minActiveMs) return null;
    const seg = this.buf.filter(x => x.time >= this.startAt && x.time <= endAt + 100);
    return {
      frames: seg.map(x => x.frame || new Float32Array(RAW_DIM)),
      times: seg.map(x => x.time),
    };
  }
}

/* ── 비교 ──────────────────────────────────────────────── */

const hasAny = (f, from, to) => { for (let i = from; i < to; i += 1) if (f[i] !== 0) return true; return false; };

/** 손이 보이는 구간만 잘라 rows개로 맞춘 원본 좌표 프레임들 (대만 preprocess.js의 resampleActive 사용) */
function activeRows(frames, rows) {
  const flat = resampleActive(frames, rows);
  const out = [];
  for (let r = 0; r < rows; r += 1) out.push(flat.subarray(r * RAW_DIM, (r + 1) * RAW_DIM));
  return out;
}

/** 시간 맞추기용: 상체 특징(마지막 33개)에서 그 동작 전체의 평균을 뺀다 */
function centerPosePart(features) {
  const from = FEATURE_SIZE * 2, n = features.length;
  const mean = new Array(POSE_UPPER_SIZE).fill(0);
  for (const f of features) for (let k = 0; k < POSE_UPPER_SIZE; k += 1) mean[k] += f[from + k] / n;
  return features.map(f => f.map((v, k) => (k >= from ? v - mean[k - from] : v)));
}

function activeSeconds(frames, timesMs) {
  const idx = frames.map((f, k) => (hasAny(f, 132, 258) ? k : -1)).filter(k => k >= 0);
  if (idx.length < 2) return 0;
  return Math.round(((timesMs[idx[idx.length - 1]] - timesMs[idx[0]]) / 1000) * 10) / 10;
}

/**
 * 기준 동작과 사용자 동작 비교.
 * reference: loadReference() 결과
 * attempt:   MotionRecorder.push()가 돌려준 { frames, times } (times는 ms)
 * options.attemptAspect: 사용자 카메라의 가로÷세로 (없으면 preprocess.js에 설정된 값으로 계산)
 * 반환: { score, normalizedDistance, messages(문장 배열), feedback({message, kind} 배열), items, phase, duration }
 */
export function compareToReference(reference, attempt, options = {}) {
  const o = { ...COMPARE_OPTIONS, ...options };
  const attemptAspect = o.attemptAspect || REF_ASPECT / frameAspectScaleY();
  const kyA = 1 / attemptAspect, kyR = 1 / reference.aspect;

  const attRows = activeRows(attempt.frames, o.rows);
  const refRows = activeRows(reference.frames, o.rows);

  // 1) SignBridge 특징 159개
  const attF = attRows.map(r => taiwanToFeatures(r, kyA));
  const refF = refRows.map(r => taiwanToFeatures(r, kyR));

  // 2) SignBridge DTW로 시간 맞추기 → path: [사용자 번호, 기준 번호]
  const aligned = o.centerPose ? dtw(centerPosePart(attF), centerPosePart(refF)) : dtw(attF, refF);
  const path = aligned.path;

  // 3) 점수: SignBridge 식. 거리는 평균을 빼기 전 좌표로 같은 경로를 따라 다시 잰다
  const costs = path.map(([i, j]) => featureDistance(attF[i], refF[j]));
  const rawDistance = costs.reduce((a, b) => a + b, 0) / Math.sqrt(attF.length * refF.length);
  const normalizedDistance = Math.min(1, rawDistance);                         // SignBridge와 같은 0~1 값
  const score = Math.round(100 * (1 - Math.min(1, rawDistance / o.scoreScale)));

  // 4) 피드백
  const refTimes = reference.frames.map((_, k) => (k * 1000) / reference.fps);
  const duration = { attempt: activeSeconds(attempt.frames, attempt.times), reference: activeSeconds(reference.frames, refTimes) };
  const fb = generateFeedback({
    learner: { geometry: attRows.map(r => handGeometry(r, kyA)), seconds: duration.attempt },
    reference: { geometry: refRows.map(r => handGeometry(r, kyR)), seconds: duration.reference },
    path, costs, score,
  }, o);

  return {
    score,
    normalizedDistance: Math.round(normalizedDistance * 1000) / 1000,
    messages: fb.messages.map(m => m.message),
    feedback: fb.messages,
    items: fb.items,
    phase: fb.phase,
    duration,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3부. 묶음 (LearningSession) — app.js에는 이것만 연결하면 된다
   ═══════════════════════════════════════════════════════════════════════════ */

export class LearningSession {
  /**
   * continuous: app.js의 ContinuousRecognition 인스턴스 (단어를 바꿀 때 구간을 비우려고 받는다)
   * referenceDir: 기준 동작 JSON 폴더 (index.html 기준 경로)
   * onVerdict(v): 판정이 나올 때마다. v = { verdict, message, score, done, targetScore, rank, topLabel }
   * onReport(r):  시도 하나가 끝날 때마다. r = compareToReference() 결과 + word
   */
  constructor({ continuous = null, referenceDir = 'references', judge = {}, recorder = {}, compare = {},
                onVerdict = null, onReport = null } = {}) {
    this.continuous = continuous;
    this.referenceDir = referenceDir;
    this.judge = new AccuracyJudge(judge);
    this.recorder = new MotionRecorder(recorder);
    this.compareOptions = compare;
    this.onVerdict = onVerdict;
    this.onReport = onReport;
    this.word = null;
    this.reference = null;
    this.lastVerdict = null;
    this.lastReport = null;
    this._token = 0;
  }

  setLabels(labels) { this.judge.setLabels(labels); }

  /** 연습할 단어 시작. 기준 동작 파일이 없으면 판정만 한다. */
  async start(word, now = performance.now()) {
    const token = ++this._token;
    this.judge.start(word, now);
    this.recorder.reset();
    this.continuous?.reset();
    this.word = word;
    this.reference = null;
    this.lastVerdict = null;
    this.lastReport = null;
    try {
      const r = await fetch(`${this.referenceDir}/${encodeURIComponent(word)}.json`, { cache: 'no-cache' });
      if (r.ok && token === this._token) this.reference = loadReference(await r.json());
    } catch { /* 기준 동작이 없으면 비교만 건너뛴다 */ }
    return { word, hasReference: Boolean(this.reference) };
  }

  stop() {
    this._token += 1;
    this.word = null;
    this.reference = null;
    this.recorder.reset();
  }

  get hasReference() { return Boolean(this.reference); }

  /** onResults에서 매 프레임. 시도가 끝나 비교했으면 그 결과를 돌려준다. */
  onFrame(frame, valid, now = performance.now()) {
    if (!this.word) return null;
    const timeout = this.judge.tick(now);
    if (timeout && timeout !== this.lastVerdict) this._emitVerdict(timeout);
    const attempt = this.recorder.push(frame, valid, now);
    if (!attempt || !this.reference) return null;
    const report = { word: this.word, ...compareToReference(this.reference, attempt, this.compareOptions) };
    this.lastReport = report;
    this.onReport?.(report);
    return report;
  }

  /** predictLatest에서 continuous.observe() 바로 아래. */
  onPrediction(scores, decision, now = performance.now()) {
    if (!this.word) return null;
    const v = this.judge.update(scores, decision, now);
    if (v !== this.lastVerdict) this._emitVerdict(v);
    return v;
  }

  _emitVerdict(v) {
    this.lastVerdict = v;
    this.onVerdict?.(v);
  }
}
