import { useCallback, useEffect, useRef, useState } from "react";
import { askHermes, getHermesStatus, speakHermes, transcribeHermes } from "./api";
import { useHermesStore } from "./store";
import { detectSpeechLang, newId } from "./text";
import type { HermesPhase } from "./types";
import {
  blobToBase64,
  getSpeechRecognition,
  pickRecorderMime,
  speakWithBrowser,
  stopBrowserSpeech,
} from "./voice";

const SILENCE_MS = 750;
const CAPTION_MS = 650;
const RESUME_MS = 380;
const ARM_MS = 280;
const MAX_UTTER_MS = 8_000;
const VOICE_ON = 0.032;
const BARGE_RMS = 0.16;
const BARGE_FRAMES = 7;

function energy(
  analyser: AnalyserNode,
  freq: Uint8Array<ArrayBuffer>,
  time: Uint8Array<ArrayBuffer>,
): number {
  analyser.getByteFrequencyData(freq);
  analyser.getByteTimeDomainData(time);
  const to = Math.min(48, freq.length);
  let fsum = 0;
  for (let i = 1; i < to; i++) fsum += freq[i];
  const favg = fsum / Math.max(1, to - 1) / 255;
  let tsum = 0;
  for (let i = 0; i < time.length; i++) {
    const v = (time[i] - 128) / 128;
    tsum += v * v;
  }
  return Math.max(favg, Math.min(1, Math.sqrt(tsum / time.length) * 5));
}

export function useHermesSession() {
  const messages = useHermesStore((s) => s.messages);
  const addMessage = useHermesStore((s) => s.addMessage);

  const [phase, setPhase] = useState<HermesPhase>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [level, setLevel] = useState(0);
  const [live, setLive] = useState(false);

  const phaseRef = useRef(phase);
  const liveRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<SpeechRecognition | null>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeRef = useRef("audio/webm");
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef(0);
  const vadTimer = useRef(0);
  const captionTimer = useRef(0);
  const listenGen = useRef(0);
  const turnGen = useRef(0);
  const wantListen = useRef(false);
  const takingTurn = useRef(false);
  const utteranceRef = useRef("");
  const interimRef = useRef("");
  const bargeFrames = useRef(0);
  const startListenRef = useRef<(initiated?: boolean) => Promise<void>>(async () => {});
  const commitRef = useRef<(reason: "caption" | "vad" | "manual") => void>(() => {});

  phaseRef.current = phase;
  liveRef.current = live;

  useEffect(() => {
    void getHermesStatus().then((s) => setAvailable(s.available));
  }, []);

  const clearTimers = () => {
    window.clearInterval(vadTimer.current);
    window.clearTimeout(captionTimer.current);
    vadTimer.current = 0;
    captionTimer.current = 0;
  };

  const stopCaption = () => {
    const rec = recRef.current;
    if (rec) {
      rec.onend = null;
      rec.onerror = null;
      rec.onresult = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
    recRef.current = null;
  };

  const stopRecorder = (keepOnStop = false) => {
    const recorder = mediaRecRef.current;
    if (recorder) {
      if (!keepOnStop) recorder.onstop = null;
      recorder.ondataavailable = keepOnStop ? recorder.ondataavailable : null;
      if (recorder.state !== "inactive") {
        try {
          if (typeof recorder.requestData === "function") recorder.requestData();
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
    }
    if (!keepOnStop) {
      mediaRecRef.current = null;
      recStreamRef.current?.getTracks().forEach((t) => t.stop());
      recStreamRef.current = null;
    }
  };

  const releaseMic = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    clearTimers();
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    recStreamRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  const stopListenLoop = useCallback(() => {
    wantListen.current = false;
    listenGen.current += 1;
    clearTimers();
    stopCaption();
    stopRecorder(false);
    utteranceRef.current = "";
    interimRef.current = "";
    setInterim("");
  }, []);

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      // Detach handlers first: clearing `src` fires `error`, which would
      // otherwise run `afterSpeak` for a turn we are deliberately cutting off.
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    }
    stopBrowserSpeech();
  }, []);

  const pumpLevel = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const freq = new Uint8Array(analyser.frequencyBinCount);
    const time = new Uint8Array(analyser.fftSize);
    const tick = () => {
      const rms = energy(analyser, freq, time);
      setLevel(rms);
      if (phaseRef.current === "speaking" && liveRef.current) {
        if (rms > BARGE_RMS) {
          bargeFrames.current += 1;
          if (bargeFrames.current >= BARGE_FRAMES) {
            bargeFrames.current = 0;
            turnGen.current += 1;
            takingTurn.current = false;
            stopPlayback();
            void startListenRef.current(true);
          }
        } else bargeFrames.current = 0;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(rafRef.current);
    tick();
  }, [stopPlayback]);

  const ensureMic = useCallback(async () => {
    let stream = streamRef.current;
    if (!stream || stream.getTracks().every((t) => t.readyState === "ended")) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
    }
    let ctx = audioCtxRef.current;
    if (!ctx || ctx.state === "closed") {
      ctx = new AudioContext();
      audioCtxRef.current = ctx;
    }
    if (ctx.state === "suspended") await ctx.resume();
    if (!analyserRef.current) {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.35;
      source.connect(analyser);
      sourceRef.current = source;
      analyserRef.current = analyser;
    }
    pumpLevel();
    return stream;
  }, [pumpLevel]);

  const sendText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) {
        takingTurn.current = false;
        return;
      }
      takingTurn.current = true;
      stopListenLoop();
      stopPlayback();
      setError(null);
      addMessage({ id: newId(), role: "user", content: text, at: Date.now() });
      const mine = ++turnGen.current;
      setPhase("thinking");

      const history = useHermesStore.getState().messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Server-function calls reject on network failure; without this guard a
      // rejection left `takingTurn` set and the phase stuck on "thinking".
      const reply = await askHermes({
        data: {
          messages: history,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          locale: navigator.language || "ko",
          nowLabel: new Intl.DateTimeFormat(navigator.language || "ko", {
            dateStyle: "full",
            timeStyle: "long",
          }).format(new Date()),
        },
      }).catch(() => ({ ok: false as const, error: "연결에 실패했습니다. 네트워크를 확인해 주세요." }));

      if (mine !== turnGen.current) {
        takingTurn.current = false;
        return;
      }

      if (!reply.ok) {
        takingTurn.current = false;
        setError(reply.error);
        if (liveRef.current) void startListenRef.current(true);
        else setPhase("idle");
        return;
      }

      addMessage({ id: newId(), role: "assistant", content: reply.text, at: Date.now() });

      if (!useHermesStore.getState().ttsEnabled) {
        takingTurn.current = false;
        if (liveRef.current) void startListenRef.current(true);
        else setPhase("idle");
        return;
      }

      setPhase("speaking");
      bargeFrames.current = 0;
      const voice = useHermesStore.getState().voiceId;
      const langSetting = useHermesStore.getState().language;
      const spokenLang = langSetting === "auto" ? detectSpeechLang(reply.text) : langSetting;

      const afterSpeak = () => {
        takingTurn.current = false;
        if (mine !== turnGen.current) return;
        if (liveRef.current) {
          window.setTimeout(() => {
            if (mine !== turnGen.current || !liveRef.current) return;
            void startListenRef.current(false);
          }, RESUME_MS);
        } else setPhase("idle");
      };

      const spoken = await speakHermes({
        data: { text: reply.text, voiceId: voice, language: langSetting },
      }).catch(() => ({ ok: false as const, error: "음성 요청에 실패했습니다." }));

      if (mine !== turnGen.current) {
        takingTurn.current = false;
        return;
      }

      if (!spoken.ok) {
        await speakWithBrowser(reply.text, spokenLang);
        afterSpeak();
        return;
      }

      const url = `data:${spoken.mimeType};base64,${spoken.audioBase64}`;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        audioRef.current = null;
        afterSpeak();
      };
      audio.onerror = () => {
        audioRef.current = null;
        afterSpeak();
      };
      try {
        await audio.play();
      } catch {
        await speakWithBrowser(reply.text, spokenLang);
        afterSpeak();
      }
    },
    [addMessage, stopListenLoop, stopPlayback],
  );

  const captionNow = () =>
    `${utteranceRef.current} ${interimRef.current}`.replace(/\s+/g, " ").trim();

  const collectBlob = () => {
    const blob = new Blob(chunksRef.current, { type: mimeRef.current });
    chunksRef.current = [];
    return blob;
  };

  const commitTurn = useCallback(
    (reason: "caption" | "vad" | "manual") => {
      if (takingTurn.current) return;
      if (phaseRef.current !== "listening") return;
      const gen = listenGen.current;
      const text = captionNow();

      if (text) {
        takingTurn.current = true;
        void sendText(text);
        return;
      }

      if (reason === "caption") return;

      takingTurn.current = true;
      wantListen.current = false;
      clearTimers();
      stopCaption();
      setPhase("thinking");

      const recorder = mediaRecRef.current;
      const finish = async (blob: Blob) => {
        if (gen !== listenGen.current) {
          takingTurn.current = false;
          return;
        }
        let spoken = captionNow();
        if (blob.size >= 600) {
          try {
            const audioBase64 = await blobToBase64(blob);
            const result = await transcribeHermes({
              data: {
                audioBase64,
                mimeType: (mimeRef.current.split(";")[0] ?? mimeRef.current) as string,
                language: useHermesStore.getState().language,
              },
            });
            if (result.ok && result.text.trim()) spoken = result.text.trim();
          } catch {
            /* keep caption */
          }
        }
        if (spoken) {
          takingTurn.current = false;
          await sendText(spoken);
          return;
        }
        takingTurn.current = false;
        utteranceRef.current = "";
        interimRef.current = "";
        setInterim("");
        if (liveRef.current && gen === listenGen.current) {
          void startListenRef.current(false);
        } else setPhase("idle");
      };

      if (!recorder || recorder.state === "inactive") {
        void finish(collectBlob());
        return;
      }
      recorder.onstop = () => {
        mediaRecRef.current = null;
        recStreamRef.current?.getTracks().forEach((t) => t.stop());
        recStreamRef.current = null;
        void finish(collectBlob());
      };
      try {
        if (typeof recorder.requestData === "function") recorder.requestData();
        recorder.stop();
      } catch {
        void finish(collectBlob());
      }
    },
    [sendText],
  );

  commitRef.current = commitTurn;

  const startVoiceLoop = useCallback(
    (gen: number) => {
      const stream = streamRef.current;
      const analyser = analyserRef.current;
      if (!stream || typeof MediaRecorder === "undefined") return;

      const recStream = stream.clone();
      recStreamRef.current = recStream;
      const mime = pickRecorderMime();
      mimeRef.current = mime;
      chunksRef.current = [];
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(recStream, { mimeType: mime });
      } catch {
        recStream.getTracks().forEach((t) => t.stop());
        return;
      }
      mediaRecRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      try {
        recorder.start(180);
      } catch {
        try {
          recorder.start();
        } catch {
          recStream.getTracks().forEach((t) => t.stop());
          return;
        }
      }

      const freq = new Uint8Array(analyser ? analyser.frequencyBinCount : 32);
      const time = new Uint8Array(analyser ? analyser.fftSize : 32);
      const begun = performance.now();
      let voiced = false;
      let silentFor = 0;
      let last = begun;
      let hot = 0;

      window.clearInterval(vadTimer.current);
      vadTimer.current = window.setInterval(() => {
        if (gen !== listenGen.current || phaseRef.current !== "listening") return;
        const now = performance.now();
        const dt = now - last;
        last = now;
        const e = analyser ? energy(analyser, freq, time) : 0;
        const armed = now - begun > ARM_MS;
        if (armed && e > VOICE_ON) {
          hot += 1;
          if (hot >= 2) {
            voiced = true;
            silentFor = 0;
            if (!captionNow()) setInterim("…");
          }
        } else {
          hot = 0;
          if (voiced) silentFor += dt;
        }
        if (voiced && silentFor >= SILENCE_MS) {
          commitRef.current("vad");
          return;
        }
        if (now - begun >= MAX_UTTER_MS && (voiced || captionNow())) {
          commitRef.current("vad");
        }
      }, 80);
    },
    [],
  );

  const startCaptions = useCallback((gen: number) => {
    const rec = getSpeechRecognition();
    if (!rec) return;
    const lang = useHermesStore.getState().language;
    rec.lang = lang === "en" ? "en-US" : "ko-KR";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    const bump = (finals: string, liveText: string) => {
      if (finals) utteranceRef.current = `${utteranceRef.current} ${finals}`.replace(/\s+/g, " ").trim();
      if (liveText) {
        interimRef.current = liveText;
        setInterim((utteranceRef.current ? `${utteranceRef.current} ` : "") + liveText);
      } else if (utteranceRef.current) {
        interimRef.current = "";
        setInterim(utteranceRef.current);
      }
      window.clearTimeout(captionTimer.current);
      captionTimer.current = window.setTimeout(() => {
        if (gen === listenGen.current && captionNow()) commitRef.current("caption");
      }, CAPTION_MS);
    };

    rec.onresult = (ev) => {
      if (gen !== listenGen.current) return;
      let finals = "";
      let liveText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const piece = ev.results[i][0]?.transcript ?? "";
        if (ev.results[i].isFinal) finals += piece;
        else liveText += piece;
      }
      bump(finals, liveText);
    };
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed") {
        wantListen.current = false;
        setLive(false);
        liveRef.current = false;
        setError("마이크 권한이 필요합니다.");
        setPhase("idle");
      }
    };
    rec.onend = () => {
      recRef.current = null;
      if (gen !== listenGen.current) return;
      if (captionNow()) {
        commitRef.current("caption");
        return;
      }
      if (wantListen.current && phaseRef.current === "listening") {
        window.setTimeout(() => {
          if (wantListen.current && gen === listenGen.current) startCaptions(gen);
        }, 60);
      }
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      recRef.current = null;
    }
  }, []);

  const startListen = useCallback(
    async (userInitiated = true) => {
      // A turn in flight owns the session. Internal resume paths (reply error,
      // TTS off, empty transcript, barge-in) clear `takingTurn` before calling
      // us. The old guard keyed on phase === "thinking", which those very paths
      // run under, so live mode froze on "처리 중" after any of them.
      if (takingTurn.current) return;
      stopListenLoop();
      stopPlayback();
      setError(null);
      wantListen.current = true;
      const gen = listenGen.current;
      try {
        await ensureMic();
      } catch {
        wantListen.current = false;
        setLive(false);
        liveRef.current = false;
        setPhase("idle");
        if (userInitiated) {
          setError("마이크에 접근할 수 없습니다. 화면을 탭한 뒤 권한을 허용해 주세요.");
        }
        return;
      }
      // Mic acquisition can take a while (AudioContext.resume waits for a user
      // gesture after the permission-based auto-start). If another start or a
      // pause superseded us meanwhile, bail instead of spawning a second
      // recognizer + recorder pair on top of the live one.
      if (gen !== listenGen.current || !wantListen.current) return;
      setLive(true);
      liveRef.current = true;
      setPhase("listening");
      utteranceRef.current = "";
      interimRef.current = "";
      setInterim("");
      startCaptions(gen);
      startVoiceLoop(gen);
    },
    [ensureMic, startCaptions, startVoiceLoop, stopListenLoop, stopPlayback],
  );

  startListenRef.current = startListen;

  const pause = useCallback(() => {
    turnGen.current += 1;
    takingTurn.current = false;
    wantListen.current = false;
    stopListenLoop();
    stopPlayback();
    releaseMic();
    setLive(false);
    liveRef.current = false;
    setPhase("idle");
  }, [releaseMic, stopListenLoop, stopPlayback]);

  const interrupt = useCallback(() => {
    turnGen.current += 1;
    takingTurn.current = false;
    stopPlayback();
    if (liveRef.current) void startListen(true);
    else pause();
  }, [pause, startListen, stopPlayback]);

  const endUtterance = useCallback(() => {
    commitTurn("manual");
  }, [commitTurn]);

  useEffect(() => {
    let stop = false;
    const boot = async () => {
      try {
        const perm = await navigator.permissions.query({ name: "microphone" as PermissionName });
        if (stop) return;
        if (perm.state === "granted") void startListenRef.current(false);
      } catch {
        /* tap to start */
      }
    };
    void boot();
    return () => {
      stop = true;
      turnGen.current += 1;
      wantListen.current = false;
      stopListenLoop();
      stopPlayback();
      releaseMic();
    };
  }, [releaseMic, stopListenLoop, stopPlayback]);

  return {
    messages,
    phase,
    interim,
    error,
    available,
    level,
    live,
    sendText,
    startListen,
    pause,
    interrupt,
    endUtterance,
  };
}
