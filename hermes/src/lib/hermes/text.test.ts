import assert from "node:assert/strict";
import { test } from "node:test";
import { detectSpeechLang, extractChatText, extractTranscript, forSpeech, newId } from "./text.ts";

// Pure helpers that sit between the xAI responses and the voice/UI layer. They
// had no coverage; every regression here reaches the user as a silent or
// garbled reply, so keep this file green via `npm run test:hermes`.

test("newId is unique and non-empty", () => {
  const a = newId();
  const b = newId();
  assert.ok(a.length > 8);
  assert.notEqual(a, b);
});

test("detectSpeechLang picks Korean when any Hangul is present", () => {
  assert.equal(detectSpeechLang("안녕하세요"), "ko");
  assert.equal(detectSpeechLang("Meeting at 3pm 확인"), "ko");
  assert.equal(detectSpeechLang("All clear, sir."), "en");
  assert.equal(detectSpeechLang(""), "en");
});

test("forSpeech strips markdown, links and code before TTS", () => {
  const input = [
    "## Briefing",
    "**Bold** and `inline` plus [docs](https://x.ai) and https://example.com/x",
    "```js\nconsole.log(1)\n```",
    "_under_ ~tilde~",
  ].join("\n");
  assert.equal(forSpeech(input), "Briefing Bold and inline plus docs and under tilde");
});

test("forSpeech caps long text with an ellipsis", () => {
  const long = "가".repeat(1000);
  const out = forSpeech(long);
  assert.ok(out.length <= 781);
  assert.ok(out.endsWith("…"));
});

test("extractChatText reads OpenAI-style string content", () => {
  const body = { choices: [{ message: { content: "  Hello.  " } }] };
  assert.equal(extractChatText(body), "Hello.");
});

test("extractChatText joins array content parts", () => {
  const body = {
    choices: [{ message: { content: [{ type: "text", text: "A" }, "B", { type: "image" }] } }],
  };
  assert.equal(extractChatText(body), "AB");
});

test("extractChatText falls back to Responses-API shapes", () => {
  assert.equal(extractChatText({ output_text: " ok " }), "ok");
  assert.equal(
    extractChatText({ output: [{ content: [{ text: "x" }, { text: "y" }] }] }),
    "xy",
  );
});

test("extractChatText returns empty for junk", () => {
  assert.equal(extractChatText(null), "");
  assert.equal(extractChatText("str"), "");
  assert.equal(extractChatText({ choices: [] }), "");
});

test("extractTranscript handles plain text, common keys and nesting", () => {
  assert.equal(extractTranscript(" hi "), "hi");
  assert.equal(extractTranscript({ text: "a" }), "a");
  assert.equal(extractTranscript({ transcript: "b" }), "b");
  assert.equal(extractTranscript({ data: { transcription: "c" } }), "c");
  assert.equal(extractTranscript({ results: [{ text: "d" }] }), "d");
  assert.equal(extractTranscript({ nope: 1 }), "");
});
