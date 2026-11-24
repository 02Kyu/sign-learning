import { classifyTarget, loadTemplates } from './recognition.mjs';

let templates;

self.addEventListener('message', async ({ data }) => {
  try {
    if (data.type === 'load') {
      const response = await fetch('./model.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('한국수어 모델 파일을 불러올 수 없습니다.');
      templates = loadTemplates(await response.json());
      if (!data.labels.every(label => templates.has(label))) {
        throw new Error('한국수어 모델에 지원 단어가 빠져 있습니다.');
      }
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'classify' && templates) {
      const result = classifyTarget(data.sequence, data.label, templates);
      self.postMessage({ type: 'result', id: data.id, result });
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: data.id, message: error.message });
  }
});
