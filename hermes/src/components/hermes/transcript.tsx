import type { HermesMessage, HermesPhase } from "@/lib/hermes/types";
import { cn } from "@/lib/utils";

type TranscriptProps = {
  messages: HermesMessage[];
  interim: string;
  phase: HermesPhase;
  live: boolean;
};

export function Transcript({ messages, interim, phase, live }: TranscriptProps) {
  const last = messages[messages.length - 1];
  const hearing = phase === "listening" && Boolean(interim);

  let headline = live ? "듣고 있습니다. 그냥 말하세요." : "화면을 한 번 터치하면 대화를 시작합니다.";
  let kicker = live ? "청취" : "대기";

  if (hearing) {
    headline = interim;
    kicker = "청취";
  } else if (phase === "listening") {
    headline = "듣고 있습니다. 말하고 잠깐 멈추세요.";
    kicker = "청취";
  } else if (phase === "thinking") {
    headline = last?.role === "user" ? last.content : "처리하고 있습니다";
    kicker = "처리";
  } else if (phase === "speaking" && last?.role === "assistant") {
    headline = last.content;
    kicker = "HERMES";
  } else if (phase === "idle" && last?.role === "assistant") {
    headline = last.content;
    kicker = "HERMES";
  } else if (phase === "idle" && last?.role === "user") {
    headline = last.content;
    kicker = "당신";
  }

  const history = messages.slice(-8);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-5 px-1">
      <div className="min-h-28 w-full text-center">
        <p className="mb-2 font-mono text-2xs tracking-[0.28em] text-subtle uppercase">{kicker}</p>
        <p
          key={headline}
          className={cn(
            "stagger-in text-pretty text-xl font-medium leading-snug tracking-tight text-fg sm:text-2xl",
            phase === "thinking" && "text-muted",
          )}
        >
          {headline}
        </p>
      </div>

      {history.length > 1 && (
        <ol className="hidden max-h-36 w-full space-y-2 overflow-y-auto sm:block">
          {history.slice(0, -1).map((m) => (
            <li
              key={m.id}
              className="grid grid-cols-[4.5rem_1fr] gap-3 text-xs leading-relaxed"
            >
              <span className="font-mono text-2xs tracking-wider text-subtle uppercase">
                {m.role === "assistant" ? "HERMES" : "YOU"}
              </span>
              <span className="text-pretty text-muted">{m.content}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
