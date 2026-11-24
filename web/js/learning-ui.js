/**
 * learning-ui.js — 학습 모드 시험용 패널 (우리가 새로 작성)
 *
 * learning.js가 제대로 도는지 화면에서 확인하기 위한 최소 화면이다.
 * 연습할 단어 고르기, 시작·그만, 판정 결과, 기준 동작 비교 결과만 보여준다.
 * 실제 서비스 화면은 따로 디자인해서 이 파일을 바꾸면 된다 (app.js 쪽 연결은 그대로 둔다).
 */
export function mountLearningPanel() {
  const panel = document.createElement('section');
  panel.id = 'learn-panel';
  panel.setAttribute('aria-label', '수어 연습');
  panel.innerHTML = `
    <div class="row head">
      <h2>수어 연습 (시험판)</h2>
      <button type="button" class="toggle" aria-expanded="true">접기</button>
    </div>
    <div class="body">
      <div class="row">
        <select class="word" aria-label="연습할 단어"></select>
        <button type="button" class="start">시작</button>
        <button type="button" class="stop">그만</button>
      </div>
      <p class="hint">먼저 사이트의 카메라를 켠 다음 시작을 누르세요.</p>
      <p class="verdict" role="status"></p>
      <div><span class="score"></span> <span class="score-label"></span></div>
      <ul class="report"></ul>
    </div>`;
  document.body.appendChild(panel);
  // 사이트 보안 정책(style-src 'self') 때문에 인라인 <style> 대신 같은 사이트의 CSS 파일을 연결한다
  if (!document.querySelector('link[href="learning.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'learning.css';
    document.head.appendChild(link);
  }

  const $ = sel => panel.querySelector(sel);
  const ui = { onStart: null, onStop: null };

  $('.toggle').addEventListener('click', () => {
    const collapsed = panel.dataset.collapsed !== 'true';
    panel.dataset.collapsed = String(collapsed);
    $('.toggle').textContent = collapsed ? '펼치기' : '접기';
    $('.toggle').setAttribute('aria-expanded', String(!collapsed));
  });
  $('.start').addEventListener('click', async () => {
    const word = $('.word').value;
    if (!word || !ui.onStart) return;
    $('.verdict').textContent = '동작을 기다리고 있어요.';
    $('.verdict').dataset.v = 'waiting';
    $('.score').textContent = ''; $('.score-label').textContent = ''; $('.report').innerHTML = '';
    const info = await ui.onStart(word);
    $('.hint').textContent = info && !info.hasReference
      ? '이 단어는 기준 동작 파일이 없어서 정답 판정만 해요.'
      : '동작을 한 번 하고 손을 내리면 기준 동작과 비교해요.';
  });
  $('.stop').addEventListener('click', () => {
    ui.onStop?.();
    $('.verdict').textContent = ''; $('.hint').textContent = '먼저 사이트의 카메라를 켠 다음 시작을 누르세요.';
  });

  /** labels.json 내용으로 단어 목록 채우기 */
  ui.fillWords = labels => {
    const words = Object.keys(labels).sort((a, b) => Number(a) - Number(b)).map(k => labels[k]);
    $('.word').innerHTML = words.map(w => `<option>${w.replace(/[<&>]/g, '')}</option>`).join('');
  };
  /** 정답 판정 표시 (learning.js onVerdict) */
  ui.showVerdict = v => {
    $('.verdict').textContent = v.message;
    $('.verdict').dataset.v = v.verdict;
    if (v.done) { $('.score').textContent = v.score; $('.score-label').textContent = '점 (정답 판정)'; }
  };
  /** 기준 동작 비교 표시 (learning.js onReport) */
  ui.showReport = r => {
    $('.score').textContent = r.score;
    $('.score-label').textContent = '점 (기준 동작과 비슷한 정도)';
    $('.report').innerHTML = r.messages.map(m => `<li>${m.replace(/[<&>]/g, '')}</li>`).join('');
  };
  return ui;
}
