import { cn } from "@/lib/utils";

export function HermesMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("text-accent", className)}
    >
      <path
        d="M12 3v18"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M12 8c3.6-2.2 6.2-1.2 6.2 1.8S16 14 12 12.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M12 8C8.4 5.8 5.8 6.8 5.8 9.8S8 14 12 12.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M12 12.4c3.2 1.6 5.4 1 5.4-1.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.7"
      />
      <path
        d="M12 12.4c-3.2 1.6-5.4 1-5.4-1.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.7"
      />
      <circle cx="12" cy="4.2" r="1.1" fill="currentColor" />
    </svg>
  );
}
