import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHermesSession } from "@/lib/hermes/use-session";
import { PHASE_LABEL } from "@/lib/hermes/types";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";
import { HermesMark } from "./mark";
import { HermesOrb } from "./orb";
import { SettingsPanel } from "./settings-panel";
import { Transcript } from "./transcript";

export function HermesConsole() {
  const session = useHermesSession();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () => {
      setClock(
        new Intl.DateTimeFormat("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(new Date()),
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const { available, live, phase, pause, startListen, endUtterance } = session;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        pause();
        return;
      }
      // Only Space/Enter drive the session. Previously *any* key (Tab, Shift,
      // Ctrl+R…) opened the mic, and Space during a reply was not an interrupt.
      const isActionKey = e.code === "Space" || e.key === "Enter";
      if (!isActionKey || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      if (phase === "listening") {
        endUtterance();
        return;
      }
      if (available === false || live) return;
      void startListen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [available, live, phase, pause, startListen, endUtterance]);

  const onSurface = () => {
    if (session.available === false) return;
    if (!session.live) void session.startListen(true);
    else if (session.phase === "listening") session.endUtterance();
    else if (session.phase === "speaking") session.interrupt();
  };

  const phaseMeta = PHASE_LABEL[session.phase];
  const aiDown = session.available === false;
  const statusCode = session.live && session.phase === "idle" ? "OPEN" : phaseMeta.code;

  return (
    <main
      className="relative flex min-h-dvh flex-col bg-bg text-fg"
      onPointerDown={onSurface}
    >
      <header
        className="flex items-center justify-between gap-3 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5">
          <HermesMark className="size-5" />
          <div>
            <p className="text-sm font-medium tracking-[0.28em]">HERMES</p>
            <p className="font-mono text-2xs tracking-[0.18em] text-subtle">PERSONAL AGENT</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <p className="hidden font-mono text-xs tabular-nums text-muted sm:block">{clock}</p>
          <button
            type="button"
            className={cn(
              "rounded-full px-2.5 py-1 font-mono text-2xs tracking-[0.18em] text-accent",
              "shadow-[var(--shadow-border)]",
            )}
            aria-live="polite"
            aria-label={session.live ? "대화 일시정지" : "상태"}
            onClick={(e) => {
              e.stopPropagation();
              if (session.live) session.pause();
              else void session.startListen(true);
            }}
          >
            {statusCode}
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="size-10"
            aria-label="설정"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 className="size-4" />
          </Button>
        </div>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-8 px-5 py-4">
        <HermesOrb
          phase={session.phase}
          level={session.level}
          live={session.live}
          disabled={aiDown}
        />
        <Transcript
          messages={session.messages}
          interim={session.interim}
          phase={session.phase}
          live={session.live}
        />
        {session.error && (
          <p className="max-w-md text-center text-sm text-danger" role="alert">
            {session.error}
          </p>
        )}
        {aiDown && (
          <p className="max-w-md text-center text-sm text-muted">
            지금은 에이전트에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.
          </p>
        )}
      </section>

      <footer
        className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Composer
          phase={session.phase}
          disabled={aiDown}
          onSend={(text) => void session.sendText(text)}
        />
        <p className="mt-3 text-center font-mono text-2xs tracking-wide text-subtle">
          {session.live
            ? "말하고 잠깐 멈추면 답합니다"
            : "한 번 터치한 뒤, 그냥 서로 말하세요"}
        </p>
      </footer>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}
