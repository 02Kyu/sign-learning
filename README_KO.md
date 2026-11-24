# ITDA 잇다 · 한국수어 개발 기록

## ITDA 첫 연습 버전

저장소 폴더에서 `python -m http.server 8000 --bind 127.0.0.1 --directory web`을 실행한 뒤
[한국수어 연습 화면](http://127.0.0.1:8000/)을 연다. 자세한 실행 순서는 [사용 안내](README.md)에 있다.

Windows에서 `python` 명령이 설치된 Python을 찾지 못하면 실행 파일 경로를 직접 지정한다. 이 작업 폴더를 검증한 PC의 PowerShell에서는 아래 명령을 사용할 수 있다.

```powershell
& "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe" -m http.server 8000 --bind 127.0.0.1 --directory web
```

1. 단어를 골라 국립국어원 한국수어사전 시범 영상을 본다. 시범 재생에는 인터넷 연결이 필요하다.
2. 카메라를 켜고 브라우저의 카메라 권한을 허용한다. 웹캠 위의 점과 선을 보고 손가락·손마디·손바닥이 잡히는지 확인한 뒤 **연습 시작**을 누른다. 왼손은 노란색, 오른손은 민트색이다.
3. 준비 표시가 끝나면 한 번 따라 한다. 화면에서 `O` 또는 `X`와 인식 점수를 본다. 동작을 충분히 포착하지 못하면 재시도 안내가 나온다.

연습 화면에서는 카메라 영상과 특징을 브라우저 안에서 처리한다. 인식 점수는 모델이 선택한 단어로 판단한 정도다. 통과 기준은 90%다. 분류에는 공개 한국수어 시연자의 좌표를 추린 예본과 DTW를 이용한다. 동작의 방향, 손가락 굽힘, 다른 단어와 비교했을 때의 점수 차이가 각각 기준을 충족하면 `O`로 판정한다.

지원 단어 10개는 `안녕하세요`, `감사합니다`, `미안합니다`, `아니요`, `괜찮다`, `이름`, `가족`, `좋다`, `어디`, `먹다`이다. 식생활 범주의 시범으로는 자료와 동작이 일치하는 `먹다`를 선택했다. `미안합니다`는 한국수어사전의 `죄송하다·사과·미안하다` 항목이 제공하는 동작을 사용한다.

현재 판정의 개발용 녹화 자료 재검사에서 정답 19건 중 16건과 목표를 바꾼 오답 171건 중 170건이 올바르게 판정됐다. 별도 시도 1건은 포착 불충분으로 보류됐다. 오답 건수는 19개 동작에 다른 목표 단어를 반복 적용한 결과다. 신규 사용자의 실제 웹캠 평가는 별도로 진행한다.

`node --test tests/itda-practice.test.mjs`로 지원 단어 연결, 모델 출력과 판정 일치, 촬영 실패 처리를 확인할 수 있다. 예본을 입력한 테스트 결과는 신규 사용자의 웹캠 정확도와 구분한다. 모델과 미디어 출처는 [출처 고지](THIRD_PARTY_NOTICES.md)에 있다.

## 초기 인식 및 비교 기능 실험

아래는 대만 수어 원본을 바탕으로 진행한 초기 비교 기능 실험의 개발 기록이다. 해당 화면은 `/taiwan.html`에 있다. 현재 한국수어 연습에서는 O/X와 인식 점수를 제공하며, 세부 교정 기능은 추후 개발 범위다.

사용자가 웹캠으로 수어를 하면

1. 목표 단어를 맞게 했는지 판정하고 (통과·오답·시간 초과, 0~100점)
2. 기준 동작과 비교해 무엇이 얼마나 다른지 알려준다
   (손 위치, 손바닥 방향, 움직임 크기, 속도, 가장 다른 구간, 마디별 굽힘, 손가락 사이 벌림, 손가락 끝 닿음, 엄지 접힘)

## 구성: 세 부분이 역할을 나눈다

| 부분 | 맡은 일 | 출처 |
|---|---|---|
| 대만 수어 인식 | 카메라, MediaPipe 좌표 추출, 단어 인식(LSTM), 확정 판정, 학습·추출·변환 도구 | [Meganlin0000/taiwan-sign-language-recognition](https://github.com/Meganlin0000/taiwan-sign-language-recognition) (MIT) — 이 저장소의 바탕 |
| SignBridge | 비교 엔진: 좌표 정규화(159개 특징), DTW(시간 맞추기·점수), 피드백 규칙 흐름, 대표 녹화 선택 | [mhmdtaha091/SignBridge](https://github.com/mhmdtaha091/SignBridge) (MIT) — `web/js/signbridge/`, `tools/make_reference.py`에 이식 |
| 우리 코드 | 둘을 잇는 연결, 정답 판정, 시도 구간 기록, 관절 규칙, 학습 화면 | `web/js/learning.js` 등 (아래 표) |

좌표는 대만 코드에서 **한 번만** 뽑는다. SignBridge의 MediaPipe·분류기·화면 코드는 쓰지 않고, 좌표를 받는 비교 엔진만 쓴다.

```
웹캠 → [대만] Holistic + extractKeypoints  관절 좌표 258개
 ├→ [대만] continuous-core + inference-worker  단어별 확률
 │   → [우리] AccuracyJudge                    정답 판정 (통과·오답·점수)
 └→ [우리] MotionRecorder                      시도 하나 잘라내기
     → [SignBridge+어댑터] normalize.js        258개 → 159개 특징
     → [SignBridge] dtw.js                     시간 맞추기, 점수 = (1 - 정규화 거리) × 100
     → [SignBridge 기반] feedback.js           무엇이 얼마나 다른지
```

초기 실험은 원본 저장소에서 분기한 로컬 `korean-learning` 브랜치에서 진행했다.

## 초기 비교 기능 실험 다시 보기

    python3 -m http.server 8000 --directory web      # http://localhost:8000/taiwan.html
    node tests/learning.test.mjs                      # 학습 모드 (정답 판정, 비교, 관절 규칙) 15개
    node tests/signbridge.test.mjs                    # SignBridge 이식 (원본 테스트 13개 + 어댑터) 14개

초기 시험 화면 오른쪽 아래의 "수어 연습 (시험판)" 패널에서 단어를 고른다. 초기 실험에는 대만 수어 25단어 모델과 중국어 단어 목록을 사용했다.

## 파일별 역할과 상태

| 파일 | 역할 | 상태 |
|---|---|---|
| `web/vendor/holistic`, `web/vendor/tfjs` | 브라우저용 MediaPipe·TF.js | 대만 원본 그대로 |
| `web/js/preprocess.js` | 모델 입력 전처리 (`training/tslkit.py`와 짝, **수정 금지**) | 대만 원본 그대로 |
| `web/js/recognition-core.js` | 좌표 258개 추출, 손·몸이 잡혔는지 | 대만 수정: 단어 수 25 → labels 길이 |
| `web/js/inference-worker.js` | 모델로 단어별 확률 | 대만 수정: 단어 수 25 → 모델 출력 크기 (3곳) |
| `web/js/continuous-core.js` | 같은 단어가 안정적으로 나오면 확정 | 대만 수정: 단어 수 25 제한 제거 (2곳) |
| `web/js/framing-hint.js` | 카메라 위치 안내 | 대만 수정: 문구 한국어화 |
| `web/js/app.js` | 카메라·화면·인식 루프 | 대만 수정: 학습 모드 연결 5줄 (`[한국어 학습판]` 주석) |
| `web/js/signbridge/dtw.js` | 두 동작 시간 맞추기, 거리·경로 | SignBridge `dtw.ts` 그대로 이식 |
| `web/js/signbridge/normalize.js` | 손(손목 원점·손바닥 크기)·상체(어깨 기준) 정규화 → 159개 + 대만 좌표 어댑터 | SignBridge `normalize.ts` 이식 + 어댑터 추가 |
| `web/js/signbridge/feedback.js` | 차이 설명 문장 | SignBridge `feedback.ts` 기반: 버그 5개 수정 + 관절 규칙 확장 |
| `web/js/learning.js` | 정답 판정, 시도 기록, 비교 연결, `app.js`와의 접점 | **새로 작성** |
| `web/js/learning-ui.js`, `web/learning.css` | 학습 모드 시험용 패널 | **새로 작성** (실제 화면으로 교체 예정) |
| `web/references/` | 단어별 기준 동작 JSON | **새로 작성** (비어 있음, 만드는 법은 폴더 안 README) |
| `tools/make_reference.py` | 녹화들 중 대표 기준 동작을 골라 JSON으로 | SignBridge `find_medoid`·DTW·정규화 이식 + 대만 좌표 처리 |
| `tests/` | 학습 모드 테스트, SignBridge 이식 테스트, 가상 손 생성기 | **새로 작성** (SignBridge 원본 테스트 포함) |
| `training/*.py`, `tools/錄影工具.py` 등 | 학습·검증, 녹화·분할·추출·변환 | 대만 원본 그대로 (화면·메시지는 중국어) |
| `web/model/` | 초기 실험용 모델 | 대만 수어 25단어 모델 |
| `web/guide.json`, `web/js/speech.js`, `functions/` | 대만 교육 영상 링크, 문장 읽기 | 학습 모드에서는 안 씀 |

### SignBridge feedback.ts에서 고친 점

1. 손 높이: 손목을 원점으로 정규화한 좌표에서 손목 높이를 비교해 항상 0 → 어깨 기준 손목 위치로 비교 (좌우 추가)
2. 오른손만 검사 → 양손
3. 동작 전체 평균끼리 비교 → DTW로 짝지은 순간끼리
4. 속도를 프레임 수로 비교 → 초 단위
5. 영어 문구 → 한국어, React 컴포넌트에서 가져오던 메시지 타입을 파일 안에서 정의

넓힌 점: 원본의 "검지~새끼 끝 간격", "검지 끝 높이"를 마디별 굽힘(15곳), 이웃 손가락 벌림(3곳), 손가락 끝 닿음, 엄지 접힘으로 세분화하고, 손바닥 방향·손 사용·움직임 크기·가장 다른 구간을 추가.

### SignBridge에서 쓰지 않는 것

`stability.ts`, `signGate.ts`(대만 `continuous-core.js`와 같은 역할), 분류기(`dtwClassifier`, `knn`, `mlp`, `sequenceClassifier` — 단어 인식은 대만 LSTM), MediaPipe·카메라·그리기(`landmarker`, `useHandTracking`, `drawing` — 대만 `app.js`), React 화면·three.js 아바타·ASL/PSL 모델.

## 초기 모델과 기준 동작 제작 절차

아래는 초기 실험에서 검토한 제작 절차다. 일부 도구는 [원본 저장소](https://github.com/Meganlin0000/taiwan-sign-language-recognition)의 `tools/`에 있다.

1. 환경: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` (mediapipe 0.10.21 고정, 올리지 말 것). 변환용은 따로 `requirements-convert.txt`
2. 영상: `data/片段/{단어}/{단어}_{시연자}_{배치}_{번호}.mp4` — 녹화 도구 `.venv/bin/python tools/錄影工具.py` (http://127.0.0.1:5003).
   16:9 가로 촬영, 소문자 `.mp4`, 단어·시연자 코드에 `_`·`/` 금지
3. 좌표: `.venv/bin/python tools/抽關鍵點.py` → `data/關鍵點/`
4. 학습: `.venv/bin/python training/train.py --data data/關鍵點 --train A B --test C --out output/model` (시연자 최소 2명)
5. 변환: `tools/轉檔_keras轉tfjs.py output/model/model.keras output/tfjs` → `model.json`, `.bin`, `labels.json`, `class-prior.json`을 `web/model/`로
6. 기준 동작: `.venv/bin/python tools/make_reference.py [--signer T]` → `web/references/`

## 처음에 맞춰야 할 것

- `HAND_NAMES` (`web/js/signbridge/feedback.js`): 오른손만 들고 확인해서 "왼손"으로 나오면 두 이름을 바꾼다.
- `COMPARE_OPTIONS.scoreScale` (`learning.js`): 1이면 SignBridge 원본 점수 식. 실제 데이터에서 손가락 하나만 틀려도 0점이 되면 2~3으로 올린다.
- `FEEDBACK_OPTIONS` (`feedback.js`)의 알림 기준, `AccuracyJudge` 옵션(`passScore` 등): 지금 값은 가상 데이터로 잡은 초기값. 팀원의 "맞게 한 동작"에서 지적이 나오지 않을 정도로 맞춘다.

## 남은 일

- [ ] 한국 수어 데이터 녹화 또는 AI Hub 데이터 정리 → 모델 학습·교체
- [ ] 단어별 기준 동작 녹화 → `web/references/` 생성
- [ ] 실제 웹캠으로 `HAND_NAMES`, 점수 폭(`scoreScale`), 판정·알림 기준 보정
- [ ] 학습 화면 디자인 (지금은 시험용 패널), 기준 동작을 보여주는 방법 (예시 영상 또는 골격 재생)
- [ ] 나머지 중국어 화면 문구와 녹화 도구 한국어화, 학습 기록(진도·오답) 저장

## 라이선스

대만 수어 인식, SignBridge 모두 MIT. 출처와 라이선스 전문은 `THIRD_PARTY_NOTICES.md`.
