import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HermesPhase } from "@/lib/hermes/types";
import { cn } from "@/lib/utils";

type ComposerProps = {
  phase: HermesPhase;
  disabled?: boolean;
  onSend: (text: string) => void;
};

export function Composer({ phase, disabled, onSend }: ComposerProps) {
  const [value, setValue] = useState("");
  const busy = phase === "thinking";

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = value.trim();
    if (!text || busy) return;
    setValue("");
    onSend(text);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={submit}
      className="mx-auto flex w-full max-w-xl items-end gap-2 rounded-xl bg-surface/70 p-2 shadow-[var(--shadow-border)]"
    >
      <textarea
        data-testid="hermes-input"
        rows={1}
        value={value}
        disabled={disabled || busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey}
        placeholder="말할 수 없으면 여기에"
        className={cn(
          "max-h-28 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-fg",
          "placeholder:text-subtle focus:outline-none disabled:opacity-50",
        )}
      />
      {value.trim() ? (
        <Button
          type="submit"
          variant="default"
          size="icon"
          className="size-11 shrink-0 rounded-lg"
          disabled={disabled || busy}
          aria-label="보내기"
          data-testid="hermes-send"
        >
          <Send className="size-4" />
        </Button>
      ) : null}
    </form>
  );
}