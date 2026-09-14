# 노래연습 앱 개발 계획 (SongPractice)

> 노래를 검색하면 **반주 + 가사 + 악보(음표)** 가 함께 나오고,
> 그 위에서 따라 부르며 연습할 수 있는 웹앱 (PWA).
> 기존 B2026 저장소와 같이 **정적 파일만으로 GitHub Pages에 배포**하는 구조를 기본으로 한다.

---

## 0. 먼저 짚고 갈 현실적인 제약 (저작권)

| 자료 | 문제 | 해결 방향 |
|---|---|---|
| 가사 | 저작권 보호 대상. 임의 수집·배포 불가 | ① 사용자가 직접 입력/붙여넣기 ② 사용자가 LRC 파일 업로드 ③ 유료 가사 API(Musixmatch 등) 연동은 2단계 |
| 반주(MR) | 음원 저작권 | ① 사용자가 가진 MR 파일 업로드 ② **YouTube 검색 → 공식/노래방 채널 영상 임베드**(iframe API, 재생은 YouTube가 담당하므로 합법) ③ 사용자가 원곡을 넣으면 브라우저에서 보컬 제거(스템 분리) |
| 악보(음표) | 정식 악보는 저작권 | ① MusicXML / MIDI 파일 업로드 ② **반주·원곡에서 멜로디 자동 추출(피치 검출) → 음표로 표시** ③ 저작권 만료곡(동요·민요·클래식)은 오픈 라이브러리(MuseScore Open, Mutopia) 자유 사용 |

→ **결론: "검색"의 실체는 YouTube 검색 + 내 라이브러리 검색이고,
가사/악보는 사용자가 넣거나 앱이 자동 생성한다.**
이렇게 설계해야 공개 배포가 가능하다.

---

## 1. 핵심 기능 (MVP 범위)

1. **곡 검색**
   - 제목/가수 입력 → YouTube Data API v3 검색 (필터: "노래방", "MR", "Karaoke", "Instrumental")
   - 내 라이브러리(로컬 저장된 곡) 검색
2. **반주 재생**
   - YouTube iframe Player (기본) / 업로드한 오디오 파일 (Web Audio)
   - 재생·일시정지·구간반복(A-B)·속도 조절(0.5~1.5x)·키 변경(±6 반음, 로컬 오디오만)
3. **가사 표시**
   - LRC(타임스탬프 가사) 지원 → 재생 시간에 맞춰 현재 줄 하이라이트, 자동 스크롤
   - 타임스탬프 없는 가사는 "탭해서 싱크 맞추기" 모드로 사용자가 직접 찍음
4. **악보(음표) 표시**
   - MusicXML / MIDI → VexFlow 로 오선보 렌더링, 재생 커서가 음표 위를 따라감
   - 악보가 없으면 **피아노롤(막대 그래프형 음표)** 로 대체 표시
5. **연습 피드백 (마이크)**
   - 마이크 입력 → 실시간 피치 검출 → 목표 음표 대비 내 음정을 오선보/피아노롤 위에 겹쳐 표시
   - 구간별 정확도 점수 (음정 ±50센트 이내 비율)
6. **저장**
   - 곡 메타·가사·악보·싱크 정보를 IndexedDB에 저장 (오프라인 사용 가능, PWA)

### MVP 이후 (2단계)
- 원곡 업로드 시 브라우저 내 보컬 제거 (ONNX Runtime Web + 경량 분리 모델) → 반주 자동 생성
- 원곡에서 멜로디 자동 추출 → 악보 자동 생성 (CREPE/pYIN 계열 피치 추적 + 음표 양자화)
- 가사 API(Musixmatch) 연동, 녹음 저장 및 원곡과 비교 재생
- 계정/클라우드 동기화 (Firebase 또는 Supabase)

---

## 2. 화면 구성

```
┌──────────────────────────────────────────┐
│ 🔍 [ 곡 검색: 제목 / 가수 ]      [내 곡함] │
├──────────────────────────────────────────┤
│ 🎼 악보 영역 (VexFlow 오선보 or 피아노롤)  │
│    목표 음표 ─── / 내 음정 ●●● (마이크)    │
├──────────────────────────────────────────┤
│ 📝 가사 영역                               │
│    이전 줄 (회색)                          │
│  ▶ 현재 줄 (크게, 강조)                    │
│    다음 줄 (회색)                          │
├──────────────────────────────────────────┤
│ ▶ ⏸  ◀◀ A-B ▶▶   속도 [1.0x]  키 [+0]     │
│ ━━━━━━━━●━━━━━━━━━━━━  01:23 / 03:45      │
│ 🎤 마이크 [ON]   점수 87%                  │
└──────────────────────────────────────────┘
```

화면 목록
- `홈/검색` : 검색창, 최근 연습곡, YouTube 결과 리스트
- `연습` : 위 레이아웃 (악보 + 가사 + 컨트롤)
- `곡 편집` : 가사 붙여넣기, LRC 싱크 찍기, MusicXML/MIDI/오디오 업로드
- `설정` : YouTube API 키, 마이크 선택, 표시 옵션(오선보/피아노롤, 글자 크기)

모바일 우선(세로), 데스크톱은 악보/가사 좌우 배치.

---

## 3. 기술 스택 (기존 저장소와 일관되게)

| 영역 | 선택 | 이유 |
|---|---|---|
| 앱 형태 | 정적 PWA (HTML/CSS/JS, 빌드 없음 또는 Vite) | 기존 index.html/sw.js 구조와 동일하게 GitHub Pages 배포 |
| UI | Vanilla JS + 모듈 분리 (규모 커지면 Preact) | 의존성 최소화 |
| 반주 재생 | YouTube IFrame Player API, Web Audio API | 합법 스트리밍 + 로컬 파일 정밀 제어 |
| 키 변경/속도 | SoundTouch.js (WASM) | 피치/템포 독립 조절 |
| 악보 렌더링 | **VexFlow** | 브라우저 오선보 표준 라이브러리 |
| MusicXML/MIDI 파싱 | OpenSheetMusicDisplay(OSMD, VexFlow 기반) / @tonejs/midi | MusicXML은 OSMD가 렌더까지 한 번에 처리 |
| 피치 검출 | pitchy (McLeod Pitch Method) 또는 CREPE(TF.js) | 실시간 마이크 음정 |
| 가사 | LRC 파서 자체 구현 (단순) | |
| 저장 | IndexedDB (idb 라이브러리) | 오프라인 |
| 배포 | GitHub Pages, 하위 경로 `/songpractice/` | 기존 사이트와 공존 |

라이브러리는 기존 방식대로 `vendor/` 에 넣어 오프라인 캐시(sw.js)에 포함.

---

## 4. 데이터 모델

```js
// IndexedDB: store "songs"
{
  id: "uuid",
  title: "제목", artist: "가수",
  source: { type: "youtube" | "file", videoId?: "...", fileBlobKey?: "..." },
  lyrics: [ { t: 12.34, text: "가사 한 줄" }, ... ],   // t 없으면 미싱크
  score: {
    type: "musicxml" | "midi" | "notes",
    data: "<xml…>" | ArrayBuffer | [ { t: 12.3, dur: 0.5, midi: 67 }, ... ],
    offset: 0.0                                       // 반주와의 시간 오프셋(초)
  },
  transpose: 0, speed: 1.0,
  practice: [ { date, score, sectionA, sectionB } ],
  createdAt, updatedAt
}
```

핵심은 **하나의 타임라인(초)** 을 반주·가사·악보·마이크 피치가 공유하는 것.
`offset` 값으로 악보/가사를 반주에 맞춰 밀고 당길 수 있게 한다.

---

## 5. 개발 단계 (마일스톤)

### M1. 뼈대 + 반주 + 가사 (1주)
- [ ] `songpractice/index.html`, `app.js`, `styles.css`, `sw.js`, `manifest` 생성
- [ ] YouTube 검색(API 키는 설정 화면에서 입력, localStorage 저장) + 결과 클릭 → 플레이어
- [ ] 로컬 오디오 파일 업로드 재생
- [ ] 가사 붙여넣기 + LRC 파서 + 현재 줄 하이라이트
- [ ] "탭 싱크" 모드 (재생 중 스페이스/탭으로 줄마다 타임스탬프 찍기)
- [ ] IndexedDB 저장/불러오기, 내 곡함 리스트

### M2. 악보(음표) (1~2주)
- [ ] MusicXML 업로드 → OSMD 렌더, MIDI 업로드 → @tonejs/midi 파싱 → notes 배열
- [ ] 재생 시간에 따라 악보 커서 이동 + 자동 스크롤
- [ ] 피아노롤 뷰 (Canvas) — 악보 없거나 모바일에서 보기 편한 대체 뷰
- [ ] 악보 오프셋 조절 UI

### M3. 마이크 피드백 (1주)
- [ ] getUserMedia + AnalyserNode + pitchy 로 실시간 음정 검출
- [ ] 피아노롤/오선보 위에 내 음정 궤적 오버레이
- [ ] 구간 점수 계산, 연습 기록 저장

### M4. 연습 편의 기능 (1주)
- [ ] A-B 구간반복, 속도 조절(YouTube: playbackRate / 로컬: SoundTouch)
- [ ] 키 변경(로컬 오디오 전용, YouTube는 불가 → 안내 문구)
- [ ] 글자 크기·테마·전체화면, 키보드 단축키
- [ ] PWA 오프라인 캐시, 홈 화면 설치

### M5. (선택) 자동 생성 기능
- [ ] 원곡 → 보컬 분리(브라우저 WASM/ONNX) 또는 서버(Demucs) 선택
- [ ] 멜로디 자동 추출 → notes 자동 생성 → 악보 없이도 음표 표시
- [ ] 가사 API 연동

---

## 6. 폴더 구조(안)

```
songpractice/
├─ index.html
├─ manifest.webmanifest
├─ sw.js
├─ css/styles.css
├─ js/
│  ├─ app.js            # 라우팅/화면 전환
│  ├─ search.js         # YouTube 검색, 내 곡함 검색
│  ├─ player/
│  │  ├─ youtube.js     # IFrame API 래퍼 (공통 인터페이스)
│  │  └─ local.js       # Web Audio + SoundTouch
│  ├─ lyrics.js         # LRC 파서, 싱크 모드, 렌더
│  ├─ score/
│  │  ├─ musicxml.js    # OSMD 렌더
│  │  ├─ midi.js        # MIDI → notes
│  │  └─ pianoroll.js   # Canvas 피아노롤
│  ├─ pitch.js          # 마이크 피치 검출 + 점수
│  └─ db.js             # IndexedDB
└─ vendor/              # vexflow, osmd, pitchy, soundtouch, idb
```

플레이어는 `{ play, pause, seek, currentTime, rate, onTime(cb) }` 공통 인터페이스로 추상화해
YouTube/로컬 파일을 같은 코드로 다룬다.

---

## 7. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| YouTube API 일일 쿼터(10,000, 검색 1회 100) | 검색 결과 캐시, 사용자 본인 API 키 사용 |
| YouTube 영상은 키 변경 불가 | 키 변경은 로컬 파일에서만, UI에 명시 |
| iOS Safari 자동재생·마이크 제약 | 사용자 터치 후 AudioContext resume, 안내 표시 |
| 피치 검출이 반주 소리에 간섭 | 이어폰 권장 안내, 에코 캔슬 옵션, 반주 볼륨 낮춤 |
| 대용량 오디오 IndexedDB 저장 | Blob 저장 + 용량 표시, 삭제 기능 |
| 저작권 | 앱은 자료를 배포하지 않고 사용자 자료·YouTube 임베드만 사용 (0장 원칙 유지) |

---

## 8. 다음 액션

1. 이 계획 검토 후 확정 (특히 **0장 저작권 방침**, **YouTube 임베드 기본 여부**)
2. M1 착수: `songpractice/` 폴더에 뼈대 + YouTube 검색/재생 + 가사 싱크 구현
3. 동요·민요 등 저작권 만료곡 3~5곡을 샘플(MusicXML + LRC)로 내장해 데모 제공
