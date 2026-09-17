import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHermesStore } from "@/lib/hermes/store";
import { VOICES, type HermesLanguage } from "@/lib/hermes/types";
import { cn } from "@/lib/utils";

const LANGS: { id: HermesLanguage; label: string }[] = [
  { id: "ko", label: "한국어" },
  { id: "en", label: "English" },
  { id: "auto", label: "자동" },
];

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const voiceId = useHermesStore((s) => s.voiceId);
  const language = useHermesStore((s) => s.language);
  const ttsEnabled = useHermesStore((s) => s.ttsEnabled);
  const setVoiceId = useHermesStore((s) => s.setVoiceId);
  const setLanguage = useHermesStore((s) => s.setLanguage);
  const setTtsEnabled = useHermesStore((s) => s.setTtsEnabled);
  const clearMessages = useHermesStore((s) => s.clearMessages);

  return (
    // The console's <main> starts/commits a voice turn on any pointerdown; the
    // dialog sits inside it, so every tap here must not reach that handler.
    <div
      className="fixed inset-0 z-40 flex items-end justify-center sm:items-center"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-bg/70"
        onClick={onClose}
      />
      <aside
        className="relative z-10 w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-t-xl bg-surface p-5 shadow-[var(--shadow-border)] sm:rounded-xl"
        role="dialog"
        aria-labelledby="hermes-settings-title"
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="font-mono text-2xs tracking-[0.22em] text-subtle uppercase">Config</p>
            <h2 id="hermes-settings-title" className="text-lg font-medium tracking-tight">
              설정
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="설정 닫기" className="size-10">
            <X className="size-4" />
          </Button>
        </div>

        <section className="space-y-2">
          <p className="text-xs font-medium tracking-wide text-muted">음성</p>
          <div className="grid grid-cols-1 gap-2">
            {VOICES.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setVoiceId(v.id)}
                className={cn(
                  "flex items-center justify-between rounded-md px-3 py-3 text-left text-sm",
                  "shadow-[var(--shadow-border)] transition-[box-shadow,background-color] duration-150",
                  voiceId === v.id ? "bg-surface-2 shadow-[var(--shadow-border-hover)]" : "bg-transparent",
                )}
              >
                <span className="font-medium">{v.name}</span>
                <span className="font-mono text-2xs text-muted">{v.tone}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-6 space-y-2">
          <p className="text-xs font-medium tracking-wide text-muted">언어</p>
          <div className="grid grid-cols-3 gap-2">
            {LANGS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLanguage(l.id)}
                className={cn(
                  "h-11 rounded-md text-sm shadow-[var(--shadow-border)] transition-[background-color,box-shadow] duration-150",
                  language === l.id ? "bg-fg text-bg" : "bg-transparent text-fg",
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-6 space-y-3">
          <ToggleRow
            label="음성으로 답하기"
            hint="끄면 텍스트만 표시합니다"
            on={ttsEnabled}
            onChange={setTtsEnabled}
          />
        </section>

        <Button
          variant="outline"
          className="mt-6 w-full"
          onClick={() => {
            clearMessages();
            onClose();
          }}
        >
          대화 지우기
        </Button>
      </aside>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between gap-4 rounded-md px-3 py-3 text-left shadow-[var(--shadow-border)]"
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <span
        className={cn(
          "relative h-6 w-10 rounded-full transition-[background-color] duration-150",
          on ? "bg-accent" : "bg-surface-2",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-5 rounded-full bg-fg transition-transform duration-150",
            on ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}
