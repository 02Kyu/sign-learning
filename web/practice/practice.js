import { WORDS } from './words.mjs';
import { CAPTURE_MS, FeatureExtractor, PASS_SCORE, prepareAttempt } from './recognition.mjs';
import { drawHandOverlay } from './hand-overlay.mjs';

const byId = id => document.getElementById(id);
const camera = byId('camera');
const handOverlay = byId('hand-overlay');
const handContext = handOverlay.getContext('2d');
const handLegend = byId('hand-legend');
const demo = byId('demo');
const startButton = byId('attempt-start');
const cameraButton = byId('camera-toggle');
const modelRetry = byId('model-reload');
const countdown = byId('countdown');
const labelButtons = new Map();
const captureCanvas = document.createElement('canvas');
const captureContext = captureCanvas.getContext('2d');

let word;
let stream;
let cameraLoading = false;
let cameraRequest = 0;
let tracker;
let trackerLoading;
let frameInFlight = false;
let cancelTrackingFrame;
let lastMediaTime;
let lastTrackingAt;
let model;
let modelReady = false;
let modelTimer;
let attempt;
let attemptId = 0;

function showResult(message, result) {
  const mark = byId('result-mark');
  const score = byId('result-score');
  mark.hidden = score.hidden = !result;
  mark.textContent = result ? (result.verdict === 'pass' ? 'O' : 'X') : '';
  mark.dataset.verdict = result?.verdict ?? '';
  score.textContent = result ? `인식 점수 ${result.score}%` : '';
  byId('result-message').textContent = message;
}

function updateButtons() {
  cameraButton.disabled = cameraLoading;
  cameraButton.textContent = cameraLoading ? '카메라 연결 중' : stream ? '카메라 끄기' : '카메라 켜기';
  cameraButton.setAttribute('aria-pressed', String(Boolean(stream)));
  byId('camera-state').textContent = stream ? '카메라 켜짐' : '카메라 꺼짐';
  startButton.disabled = !stream || cameraLoading || !modelReady || Boolean(attempt);
}

function showDemo() {
  demo.hidden = true;
  byId('demo-message').hidden = false;
  byId('demo-message').textContent = '시범 영상을 불러오는 중입니다.';
  byId('demo-reload').hidden = true;
  demo.src = word.video;
  demo.load();
}

function chooseWord(nextWord) {
  if (word === nextWord) return;
  cancelAttempt();
  word = nextWord;
  for (const [label, button] of labelButtons) {
    button.setAttribute('aria-pressed', String(label === word.label));
  }
  byId('demo-word').textContent = word.name;
  demo.setAttribute('aria-label', `${word.name} 시범 영상`);
  byId('demo-source').href = word.source;
  byId('demo-source').hidden = false;
  showDemo();
  showResult('동작을 마치면 이곳에서 결과를 확인할 수 있어요.');
  startButton.textContent = '연습 시작';
  if (stream) byId('camera-help').textContent = '손과 상체가 화면에 들어오면 연습을 시작하세요.';
}

demo.addEventListener('loadedmetadata', () => {
  demo.hidden = false;
  byId('demo-message').hidden = true;
});
demo.addEventListener('error', () => {
  demo.hidden = true;
  byId('demo-message').hidden = false;
  byId('demo-message').textContent = '영상을 불러오지 못했습니다. 다시 불러오거나 사전에서 확인해 주세요.';
  byId('demo-reload').hidden = false;
});
byId('demo-reload').addEventListener('click', showDemo);

function modelUnavailable() {
  clearTimeout(modelTimer);
  model?.terminate();
  model = undefined;
  modelReady = false;
  cancelAttempt();
  modelRetry.hidden = false;
  showResult('한국수어 인식 모델을 불러오지 못했습니다. 다시 불러와 주세요.');
}

function loadModel() {
  model?.terminate();
  modelReady = false;
  modelRetry.hidden = true;
  updateButtons();
  try {
    model = new Worker(new URL('./model-worker.mjs', import.meta.url), { type: 'module' });
    model.addEventListener('error', modelUnavailable);
    model.addEventListener('message', ({ data }) => {
      if (data.type === 'ready') {
        clearTimeout(modelTimer);
        modelReady = true;
        updateButtons();
      } else if (data.id && data.id === attempt?.id) {
        if (data.type === 'result') {
          const { result } = data;
          showResult(result.verdict === 'pass' ? '목표 단어로 인식했어요.' : `통과 기준은 ${PASS_SCORE}%입니다. 시범을 보고 다시 해보세요.`, result);
        } else {
          showResult('이번 동작을 분석하지 못했습니다. 다시 시도해 주세요.');
        }
        cancelAttempt();
      } else if (data.type === 'error' && !data.id) {
        modelUnavailable();
      }
    });
    modelTimer = setTimeout(modelUnavailable, 15000);
    model.postMessage({ type: 'load', labels: WORDS.map(item => item.label) });
  } catch {
    modelUnavailable();
  }
}

function within(promise, milliseconds) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('처리 시간 초과')), milliseconds);
  })]).finally(() => clearTimeout(timer));
}

function prepareTracker() {
  if (!trackerLoading) {
    trackerLoading = (async () => {
      if (typeof window.Holistic !== 'function') throw new Error('동작 추적 모듈이 없습니다.');
      tracker = new window.Holistic({
        locateFile: file => new URL(`../vendor/holistic/${file}`, import.meta.url).href,
      });
      tracker.setOptions({ modelComplexity: 1, smoothLandmarks: true, selfieMode: false });
      await within(tracker.initialize(), 15000);
    })().catch(error => {
      trackerLoading = undefined;
      tracker = undefined;
      throw error;
    });
  }
  return trackerLoading;
}

function stopCamera(message = '카메라가 꺼졌습니다.') {
  const interrupted = Boolean(attempt);
  cameraRequest++;
  cancelTrackingFrame?.();
  cancelTrackingFrame = undefined;
  cameraLoading = false;
  stream?.getTracks().forEach(track => track.stop());
  stream = undefined;
  camera.srcObject = null;
  camera.hidden = true;
  handOverlay.hidden = handLegend.hidden = true;
  handContext.clearRect(0, 0, handOverlay.width, handOverlay.height);
  byId('camera-placeholder').hidden = false;
  byId('camera-help').textContent = message;
  cancelAttempt();
  if (interrupted) showResult('카메라를 다시 켜고 새 시도를 시작해 주세요.');
}

function cameraError(error) {
  const messages = {
    NotAllowedError: '브라우저에서 카메라 사용 권한을 허용한 뒤 다시 시도해 주세요.',
    NotFoundError: '연결된 카메라를 찾을 수 없습니다.',
    NotReadableError: '카메라를 사용하는 다른 앱이 있다면 닫고 다시 시도해 주세요.',
  };
  return messages[error?.name] || '웹캠 또는 동작 추적을 시작하지 못했습니다. 다시 시도해 주세요.';
}

async function startCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    byId('camera-help').textContent = '웹캠은 HTTPS 또는 localhost에서 사용할 수 있습니다.';
    return;
  }
  const request = ++cameraRequest;
  cameraLoading = true;
  updateButtons();
  byId('camera-help').textContent = '연결을 기다리는 중입니다.';
  try {
    const opened = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    });
    if (request !== cameraRequest) {
      opened.getTracks().forEach(track => track.stop());
      return;
    }
    stream = opened;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        if (stream === opened) stopCamera('카메라 연결이 끊겼습니다. 연결을 확인해 주세요.');
      });
    }
    camera.srcObject = stream;
    await within(camera.play(), 8000);
    await prepareTracker();
    if (request !== cameraRequest) return;
    lastMediaTime = lastTrackingAt = -Infinity;
    camera.hidden = false;
    handOverlay.hidden = handLegend.hidden = false;
    byId('camera-placeholder').hidden = true;
    byId('camera-help').textContent = '손과 상체가 화면에 들어오면 연습을 시작하세요.';
    scheduleTracking(request);
  } catch (error) {
    if (request === cameraRequest) stopCamera(cameraError(error));
  } finally {
    if (request === cameraRequest) {
      cameraLoading = false;
      updateButtons();
    }
  }
}

function cancelAttempt() {
  if (attempt) {
    clearTimeout(attempt.timer);
    attempt = undefined;
    startButton.textContent = '다시 시도';
  }
  countdown.hidden = true;
  updateButtons();
}

function finishCapture(current) {
  if (attempt !== current) return;
  current.phase = 'analysis';
  countdown.hidden = true;
  const capture = prepareAttempt(current.samples);
  if (capture.reason) {
    showResult(capture.reason === 'motion'
      ? '동작을 감지하지 못했어요. 시작 표시가 나온 뒤 동작을 한 번 해 주세요.'
      : '손과 상체를 충분히 포착하지 못했어요. 화면 안에 들어오게 하고 다시 해 주세요.');
    cancelAttempt();
    return;
  }
  showResult('동작을 확인하는 중입니다.');
  current.timer = setTimeout(() => {
    if (attempt !== current) return;
    showResult('분석 시간이 길어졌어요. 다시 시도해 주세요.');
    cancelAttempt();
  }, 8000);
  model.postMessage({ type: 'classify', id: current.id, label: current.label, sequence: capture.sequence });
}

function updateCountdown(current, now) {
  const readySeconds = Math.ceil((current.startsAt - now) / 1000);
  if (readySeconds <= 0 && current.phase === 'ready') showResult('지금 동작을 한 번 해 주세요.');
  current.phase = readySeconds > 0 ? 'ready' : 'capture';
  const remaining = Math.max(1, Math.ceil((current.endsAt - now) / 1000));
  countdown.textContent = readySeconds > 0 ? `준비 ${readySeconds}` : `동작 입력 ${remaining}초`;
}

function syncCaptureSize() {
  const scale = Math.min(1, 640 / camera.videoWidth);
  const width = Math.round(camera.videoWidth * scale);
  const height = Math.round(camera.videoHeight * scale);
  if (width === captureCanvas.width && height === captureCanvas.height && width === handOverlay.width && height === handOverlay.height) return;
  captureCanvas.width = handOverlay.width = width;
  captureCanvas.height = handOverlay.height = height;
}

function scheduleTracking(request) {
  const callback = now => trackFrame(request, now);
  if (typeof camera.requestVideoFrameCallback === 'function') {
    const frame = camera.requestVideoFrameCallback(callback);
    cancelTrackingFrame = () => camera.cancelVideoFrameCallback(frame);
  } else {
    const frame = requestAnimationFrame(callback);
    cancelTrackingFrame = () => cancelAnimationFrame(frame);
  }
}

async function trackFrame(request, now) {
  if (request !== cameraRequest || !stream) return;
  const current = attempt;
  if (current && current.phase !== 'analysis') updateCountdown(current, now);

  const minimumDelay = current?.phase === 'capture' ? 32 : 85;
  if (!frameInFlight && camera.readyState >= 2 && camera.currentTime !== lastMediaTime && now - lastTrackingAt >= minimumDelay) {
    lastMediaTime = camera.currentTime;
    lastTrackingAt = now;
    const activeTracker = tracker;
    activeTracker.onResults(results => {
      if (request !== cameraRequest) return;
      drawHandOverlay(handContext, results, window.HAND_CONNECTIONS);
      if (!current || attempt !== current || current.phase === 'analysis' || now >= current.endsAt) return;
      const row = current.extractor.extract(results, now);
      if (now >= current.startsAt) current.samples.push({ at: now, row });
    });
    frameInFlight = true;
    try {
      syncCaptureSize();
      captureContext.drawImage(camera, 0, 0, captureCanvas.width, captureCanvas.height);
      await within(activeTracker.send({ image: captureCanvas }), 5000);
    } catch {
      if (request === cameraRequest) {
        trackerLoading = undefined;
        tracker = undefined;
        stopCamera('동작 추적이 중단됐어요. 카메라를 다시 켜 주세요.');
      }
    } finally {
      frameInFlight = false;
    }
  }

  if (request === cameraRequest) {
    scheduleTracking(request);
  }
}

function startAttempt() {
  if (!stream || !modelReady || attempt || cameraLoading) return;
  demo.pause();
  const startsAt = performance.now() + 2000;
  const current = {
    id: ++attemptId, label: word.label, phase: 'ready', startsAt, endsAt: startsAt + CAPTURE_MS,
    extractor: new FeatureExtractor(), samples: [],
  };
  attempt = current;
  countdown.hidden = false;
  countdown.textContent = '준비 2';
  showResult('준비 시간이 끝나면 동작을 한 번 해 주세요.');
  updateButtons();
  current.timer = setTimeout(() => finishCapture(current), current.endsAt - performance.now());
}

for (const item of WORDS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = item.name;
  button.addEventListener('click', () => chooseWord(item));
  labelButtons.set(item.label, button);
  byId('word-list').append(button);
}

modelRetry.addEventListener('click', loadModel);
cameraButton.addEventListener('click', () => {
  if (stream) stopCamera();
  else void startCamera();
});
startButton.addEventListener('click', startAttempt);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (stream || cameraLoading)) {
    stopCamera('탭을 벗어나 카메라를 껐습니다.');
  }
});
window.addEventListener('pagehide', () => {
  if (stream || cameraLoading) stopCamera();
});

chooseWord(WORDS[0]);
loadModel();
