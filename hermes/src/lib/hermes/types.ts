export type HermesRole = "user" | "assistant";

export type HermesMessage = {
  id: string;
  role: HermesRole;
  content: string;
  at: number;
};

export type HermesPhase = "idle" | "listening" | "thinking" | "speaking";

export type HermesVoiceId = "leo" | "atlas" | "orion" | "rigel" | "eve";

export type HermesLanguage = "ko" | "en" | "auto";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export const VOICES: { id: HermesVoiceId; name: string; tone: string }[] = [
  { id: "leo", name: "Leo", tone: "단호 · 권위" },
  { id: "atlas", name: "Atlas", tone: "지휘 · 확신" },
  { id: "orion", name: "Orion", tone: "서사 · 시네마" },
  { id: "rigel", name: "Rigel", tone: "정밀 · 보좌" },
  { id: "eve", name: "Eve", tone: "경쾌 · 명료" },
];

export const PHASE_LABEL: Record<HermesPhase, { ko: string; en: string; code: string }> = {
  idle: { ko: "대기", en: "Idle", code: "STANDBY" },
  listening: { ko: "청취 중", en: "Listening", code: "OPEN" },
  thinking: { ko: "처리 중", en: "Thinking", code: "PROCESS" },
  speaking: { ko: "응답 중", en: "Speaking", code: "SPEAK" },
};
