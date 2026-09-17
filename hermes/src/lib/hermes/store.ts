import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { HermesLanguage, HermesMessage, HermesVoiceId } from "./types";

type HermesStore = {
  messages: HermesMessage[];
  voiceId: HermesVoiceId;
  language: HermesLanguage;
  ttsEnabled: boolean;
  addMessage: (msg: HermesMessage) => void;
  clearMessages: () => void;
  setVoiceId: (id: HermesVoiceId) => void;
  setLanguage: (lang: HermesLanguage) => void;
  setTtsEnabled: (on: boolean) => void;
};

export const useHermesStore = create<HermesStore>()(
  persist(
    (set) => ({
      messages: [],
      voiceId: "leo",
      language: "ko",
      ttsEnabled: true,
      addMessage: (msg) =>
        set((s) => ({ messages: [...s.messages, msg].slice(-60) })),
      clearMessages: () => set({ messages: [] }),
      setVoiceId: (voiceId) => set({ voiceId }),
      setLanguage: (language) => set({ language }),
      setTtsEnabled: (ttsEnabled) => set({ ttsEnabled }),
    }),
    {
      name: "hermes-agent",
      // v3 drops the never-read `continuous` flag (the session is always
      // hands-free once live).
      version: 3,
      migrate: (persisted) => {
        const { continuous: _dropped, ...rest } = (persisted ?? {}) as Record<string, unknown>;
        return rest as Omit<HermesStore, "addMessage" | "clearMessages" | "setVoiceId" | "setLanguage" | "setTtsEnabled">;
      },
    },
  ),
);
