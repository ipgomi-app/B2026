# HERMES 코드 감사 보고서 & 진화 로드맵

- 대상: `sG8TNcgpd58M7gv9-grok-workspace.zip` (Grok App Builder 워크스페이스, 앱 이름 HERMES)
- 작성일: 2026-09-17
- 원본 zip은 손대지 않았습니다. 수정본은 이 폴더(`hermes/`)에 있습니다.

---

## 1. 앱이 무엇인가

HERMES는 자비스형 음성 개인 비서입니다.

- 프론트: TanStack Start + React 19 + Tailwind 4, 상태는 zustand(persist)
- 서버: `createServerFn` 3개 (`askHermes` 채팅, `speakHermes` TTS, `transcribeHermes` STT) → xAI API (`grok-4.5`, `/v1/tts`, `/v1/stt`)
- 음성 루프: 마이크 → Web Speech API 자막 + MediaRecorder 녹음 → VAD(무음 감지)로 턴 종료 → LLM → TTS 재생 → 재청취. 말 끊기(barge-in) 지원.
- 핵심 파일
  - `src/lib/hermes/use-session.ts` (640줄, 음성 상태기계 전부)
  - `src/lib/hermes/api.ts` (서버 함수)
  - `src/components/hermes/console.tsx` (화면·키보드·터치 입력)

---

## 2. 검증 결과

| 검사 | 원본 | 수정 후 |
|---|---|---|
| `tsc --noEmit` | 통과 | 통과 |
| `eslint` | 오류 1, 경고 3 | 오류 0, 경고 2 (템플릿 코드) |
| 템플릿 테스트 (`scripts/**`) | 195개 중 10개 실패 | 동일 (원인은 아래, 앱 버그 아님) |
| 템플릿 테스트 (`src/lib/app-data`, `auth`) | 55/55 통과 | 55/55 통과 |
| HERMES 단위 테스트 | **없음** | 9/9 통과 (신규) |
| `vite build` | (미확인) | 통과 |

템플릿 테스트 10개 실패의 원인:

- 8개: `scripts/grok-pwa-plugin.test.mjs`가 앱 이름 기본값을 가정하는데, 이 워크스페이스는 `src/lib/og/site.json`에서 제목을 `HERMES`로 덮어씀. 플랫폼 테스트 픽스처의 결함이지 앱 결함이 아님.
- 2개: Windows에서 심볼릭링크 생성 권한(EPERM). Linux 샌드박스에서는 통과함.

---

## 3. 발견·수정한 버그 (앱 코드)

### 3.1 [치명] 라이브 모드가 "처리 중"에서 영구 정지

- 파일: `src/lib/hermes/use-session.ts` `startListen`
- 원인: `startListen`이 `phase === "thinking"`이면 즉시 리턴. 그런데 재청취를 요청하는 세 경로(응답 오류, 음성 답변 OFF, 빈 녹음)가 **모두 thinking 상태에서** 호출함. 결과적으로
  - 설정에서 "음성으로 답하기"를 끄면 첫 답변 후 앱이 멈춤
  - API 오류(429, 타임아웃) 후 멈춤
  - 잡음만 녹음돼 인식 실패해도 멈춤
- 수정: 가드를 `takingTurn`(턴 진행 중 플래그) 기준으로 변경. 사용자 터치는 여전히 요청 중엔 차단되고, 내부 재개 경로는 통과.

### 3.2 [높음] 네트워크 단절 시 미처리 예외로 세션 고착

- 파일: `use-session.ts` `sendText`
- 원인: `askHermes`/`speakHermes` 호출이 reject(오프라인, 서버 500)되면 `takingTurn`이 true로 남고 phase는 thinking 고정.
- 수정: 두 호출에 `.catch()`로 `{ok:false}` 변환 → 정상 오류 경로로 합류.

### 3.3 [높음] 서버 함수 입력 무검증 (보안·안정성)

- 파일: `src/lib/hermes/api.ts`
- 원인: validator가 항등 함수라 배포된 앱에서 누구나 임의 JSON 전송 가능. `role: "system"` 주입, 비문자열 `content`로 핸들러 크래시, 수 MB 오디오로 소유자 키 소모 가능.
- 수정: zod 스키마로 role 화이트리스트, 길이·개수 상한, voice/language enum 검증.

### 3.4 [중간] 마이크 준비 중 중복 시작 → 인식기·녹음기 2벌 생성

- 파일: `use-session.ts` `startListen`
- 원인: 권한이 이미 있으면 페이지 로드 시 자동 시작하는데, `AudioContext.resume()`은 사용자 제스처 전까지 대기. 그 사이 사용자가 터치하면 두 번째 시작이 겹쳐 SpeechRecognition과 MediaRecorder가 각각 2개 생김(스트림 누수, ref 덮어쓰기).
- 수정: `await ensureMic()` 후 세대 번호(`listenGen`) 재확인.

### 3.5 [중간] 설정 패널 터치가 음성 턴을 발동

- 파일: `src/components/hermes/settings-panel.tsx`
- 원인: 패널이 `<main onPointerDown>` 안에 렌더되어, 목소리 선택 버튼을 누르면 청취 시작/발화 종료가 함께 실행됨.
- 수정: 패널 래퍼에서 `stopPropagation`.

### 3.6 [중간] 아무 키나 누르면 마이크가 켜짐

- 파일: `src/components/hermes/console.tsx`
- 원인: keydown 핸들러가 Tab, Shift, Ctrl+R 등 모든 키에서 `startListen` 호출.
- 수정: Space/Enter만 동작, 수정키 조합 제외. 응답 중 Space는 무시되던 것도 정리.

### 3.7 [낮음] 말 끊기 시 오디오 `error` 이벤트가 종료 콜백을 중복 실행

- 파일: `use-session.ts` `stopPlayback`
- 수정: `src=""` 전에 `onended`/`onerror` 해제.

### 3.8 [정리] 죽은 상태 `continuous` 제거

- 파일: `src/lib/hermes/store.ts` — 어디서도 읽지 않는 플래그. persist 버전 3으로 올리고 마이그레이션에서 제거.

### 3.9 [정리] 템플릿 린트 오류 1건

- `src/lib/app-data/client.server.ts` 빈 catch 블록에 주석 추가.

---

## 4. 수정하지 않았지만 알아야 할 것

1. **호출량 제한 없음.** 배포 앱은 익명 방문자도 소유자 키를 소모합니다. 서버 함수에 IP별 토큰 버킷(분당 N회) 추가 권장. (AGENTS.md "Spend responsibly")
2. **응답 잘림.** `max_tokens: 420`인데 `finish_reason === "length"`를 확인하지 않아 문장 중간에 끊긴 채 읽어줄 수 있음.
3. **STT 엔드포인트 이중 추측.** `/v1/stt` 실패 시 `/v1/audio/transcriptions`로 재시도. docs.x.ai에서 정확한 경로·필드 확인 후 하나로 고정 권장.
4. **에러 로깅 없음.** 서버 함수의 catch가 모두 사용자 문구만 반환하고 원인은 버림. `console.error`라도 남겨야 진단 가능.
5. **use-session.ts 640줄.** 상태기계·VAD·자막·녹음·재생이 한 훅에 있어 테스트 불가. 아래 로드맵 Phase 1에서 분리.
6. **auth/db 템플릿 코드**는 사용하지 않지만 플랫폼 계약상 남겨둠(AGENTS.md §0.5).

---

## 5. 진화 로드맵 (자비스에 가까워지는 순서)

각 단계는 이전 단계가 녹색(`npm run check` 통과)일 때만 진행합니다.

### Phase 0 — 자기 검사 루프 (완료)

- `npm run check` = 타입체크 + 린트 + HERMES 단위 테스트. 코드를 바꿀 때마다 이것만 돌리면 회귀를 잡습니다.
- 다음 변경부터는 **먼저 실패하는 테스트를 쓰고**(TDD) 구현합니다.

### Phase 1 — 안정화 (1주)

1. `use-session.ts`를 분리: `vad.ts`(에너지·무음 판정, 순수 함수), `turn-machine.ts`(phase 전이표), `playback.ts`. 각각 단위 테스트.
2. 스트리밍 응답: `stream: true`로 첫 문장이 오면 바로 TTS 시작 → 체감 지연 절반.
3. 서버 함수 호출량 제한 + `console.error` 로깅 + `finish_reason` 처리.
4. Playwright 스모크에 "텍스트로 질문 → 답변 표시" 한 케이스 추가(`scripts/browser-smoke.mjs` 확장).

### Phase 2 — 능력 확장: 도구 호출 (2주)

xAI chat completions는 OpenAI 호환 `tools`를 지원합니다. `askHermes`에 도구 루프를 넣습니다.

- 1차 도구: `get_time`, `calculate`, `web_search`(xAI live search 옵션), `remember`/`recall`
- 2차 도구: 캘린더·메일·파일 — 이 워크스페이스의 `app-data` 스킬이 Google/Microsoft 커넥터를 이미 제공(`src/lib/app-data/`). 인증 게이트 규칙은 AGENTS.md §0.5.
- 도구 실행 결과는 음성으로 요약해 읽고, 화면엔 카드로 표시.

### Phase 3 — 기억 (2주)

- 단기: 대화 16턴 초과 시 LLM으로 요약해 시스템 프롬프트에 주입(현재는 그냥 버림).
- 장기: "기억해 둬" 류 발화를 `remember` 도구가 DB에 저장 → `neon` 스킬 + `migrations/0002_memory.sql`. 사용자별 저장이 필요해지는 순간 auth ON.
- 사용자 프로필(이름, 호칭, 선호 언어)을 첫 시스템 프롬프트에 자동 포함.

### Phase 4 — 자율성 (진행형)

- 웨이크워드("헤르메스") — 브라우저 SpeechRecognition 상시 대기 + 키워드 매칭. 배터리 고려해 옵션.
- 아침 브리핑: 캘린더·날씨·미완료 항목을 사용자가 열었을 때 먼저 말함(자동 API 호출 금지 규칙 준수 → 사용자 터치 후).
- **자기 진단 모드**: `getHermesStatus`를 확장해 API 키·모델·TTS·STT 각각의 헬스를 반환하고, HERMES가 "지금 음성 합성이 안 됩니다, 텍스트로 답할게요"처럼 스스로 상태를 말함.

### Phase 5 — 스스로 진화하는 구조

프로그램이 자기 코드를 고치게 하려면 사람이 아니라 **검사 루프가 판정자**여야 합니다.

1. `AGENTS.project.md`에 "변경 전 `npm run check`, 실패 시 머지 금지" 규칙을 적어 Grok Build/Claude Code 같은 에이전트가 자동으로 따르게 함.
2. 위 로드맵의 각 항목을 GitHub 이슈/파일 단위 작업으로 쪼개고, 에이전트가 한 항목씩: 테스트 작성 → 구현 → `npm run check` → 브라우저 스모크 → 커밋.
3. HERMES 안에 "개발자 모드" 도구(`run_self_check`)를 추가하면, 대화 중에 "네 상태 점검해" 라고 말하면 서버에서 `npm run check`를 돌려 결과를 읽어주는 것까지 가능합니다(샌드박스 안에서만, 배포 앱에서는 비활성).

---

## 6. 사용 방법

```bash
npm install
npm run check        # 타입체크 + 린트 + HERMES 테스트
npm run dev          # 0.0.0.0:8080
```

Grok 워크스페이스에 되돌려 넣을 때는 아래 파일만 복사하면 됩니다.

- `src/lib/hermes/use-session.ts`
- `src/lib/hermes/api.ts`
- `src/lib/hermes/store.ts`
- `src/lib/hermes/text.test.ts` (신규)
- `src/components/hermes/console.tsx`
- `src/components/hermes/settings-panel.tsx`
- `src/lib/app-data/client.server.ts`
- `package.json` (`check`, `test:hermes` 스크립트)
