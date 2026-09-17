export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function hasHangul(text: string): boolean {
  return /\p{Script=Hangul}/u.test(text);
}

export function detectSpeechLang(text: string): "ko" | "en" {
  return hasHangul(text) ? "ko" : "en";
}

export function forSpeech(text: string): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*?/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 800) return cleaned;
  return `${cleaned.slice(0, 780).trim()}…`;
}

export function extractChatText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const rec = body as Record<string, unknown>;

  const choices = rec.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const msg = (choices[0] as { message?: { content?: unknown } }).message;
    const content = msg?.content;
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && "text" in part) {
            const t = (part as { text: unknown }).text;
            return typeof t === "string" ? t : "";
          }
          return "";
        })
        .join("")
        .trim();
    }
  }

  const outputText = rec.output_text;
  if (typeof outputText === "string") return outputText.trim();

  const output = rec.output;
  if (Array.isArray(output)) {
    const bits: string[] = [];
    for (const item of output) {
      if (!item || typeof item !== "object") continue;
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part && typeof part === "object" && "text" in part) {
          const t = (part as { text: unknown }).text;
          if (typeof t === "string") bits.push(t);
        }
      }
    }
    if (bits.length) return bits.join("").trim();
  }

  return "";
}

export function extractTranscript(body: unknown): string {
  if (typeof body === "string") return body.trim();
  if (!body || typeof body !== "object") return "";
  const rec = body as Record<string, unknown>;
  for (const key of ["text", "transcript", "transcription"]) {
    const v = rec[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const data = rec.data;
  if (data && typeof data === "object") {
    const nested = extractTranscript(data);
    if (nested) return nested;
  }
  const results = rec.results;
  if (Array.isArray(results) && results[0]) return extractTranscript(results[0]);
  return "";
}
