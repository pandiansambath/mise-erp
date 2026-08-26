import { expect, test } from "@playwright/test";

import { __testing, foldSegments } from "../lib/transcribe";

// Transcribe speaks AWS's binary event-stream framing, not JSON: every message
// is a length-prefixed envelope carrying two CRC32s. A byte wrong in either one
// does not raise — the socket simply closes, which reads exactly like "the
// voice does not work" and tells nobody why.
//
// The Python twin of this encoder WAS accepted by AWS on the live account: the
// handshake completed and it replied with a real (empty) transcript. These are
// the bytes it produced, so this browser copy is measured against something
// that is known to work rather than against my own reasoning about the spec.
const KNOWN_GOOD =
  "0000007000000058f940e6600d3a6d6573736167652d747970650700056576656e740b3a" +
  "6576656e742d7479706507000a417564696f4576656e740d3a636f6e74656e742d747970" +
  "650700186170706c69636174696f6e2f6f637465742d73747265616d00003930c7cfffff" +
  "87afb76c";

const hex = (b: Uint8Array) =>
  [...b].map((n) => n.toString(16).padStart(2, "0")).join("");

test("the audio envelope is byte-for-byte what AWS accepted", () => {
  // 0, 12345, -12345, -1 as little-endian int16 — covers sign and endianness.
  const pcm = new Uint8Array([0x00, 0x00, 0x39, 0x30, 0xc7, 0xcf, 0xff, 0xff]);
  expect(hex(__testing.audioEvent(pcm))).toBe(KNOWN_GOOD);
});

test("float samples become the int16 PCM that was promised", () => {
  // My first version of this asserted that float -1.0 becomes int16 -1. It
  // does not: full-scale negative is -32768. The fixture was right and the
  // expectation was wrong, which is worth leaving a note about — the value
  // that yields -1 is -1/32768, not -1.
  const pcm = __testing.toPcm16(
    new Float32Array([0, 12345 / 32767, -12345 / 32768, -1 / 32768]),
  );
  expect(hex(pcm)).toBe("00003930c7cfffff");
});

test("clipping is clamped, not wrapped", () => {
  // A sample above 1.0 wrapped through int16 becomes a loud negative spike —
  // audible as a click, and it is exactly the kind of thing that makes a
  // transcript go wrong for reasons nobody can hear.
  const pcm = __testing.toPcm16(new Float32Array([2, -2]));
  expect(hex(pcm)).toBe("ff7f0080");
});

test("48k from the microphone becomes the 16k Transcribe was told about", () => {
  const input = new Float32Array(4800).fill(0.5);
  const out = __testing.downsample(input, 48000);
  expect(out.length).toBe(1600);
  expect(out[0]).toBeCloseTo(0.5, 5);
});

// ── The bug that filled his screen ────────────────────────────────────────
//
// Transcribe re-sends the SAME result as it firms up (the id stays, the text
// grows) and re-sends a finished one more than once. My first version appended
// each arrival to what came before, so one sentence became "I want to see the
// staff's list I don't start all theI want to see the staff's list..." down the
// whole phone screen. Storing by id replaces instead of appending.

const seg = (ResultId: string, Transcript: string, IsPartial = true) => ({
  ResultId,
  IsPartial,
  Alternatives: [{ Transcript }],
});

test("a segment that firms up replaces itself instead of repeating", () => {
  const m = new Map<string, { text: string; final: boolean }>();
  foldSegments(m, [seg("a", "I want to")]);
  foldSegments(m, [seg("a", "I want to see the")]);
  const out = foldSegments(m, [seg("a", "I want to see the staff list", false)]);
  expect(out?.whole).toBe("I want to see the staff list");
  expect(out?.allFinal).toBe(true);
});

test("a finished segment re-sent twice is not counted twice", () => {
  const m = new Map<string, { text: string; final: boolean }>();
  foldSegments(m, [seg("a", "show me the staff", false)]);
  const out = foldSegments(m, [seg("a", "show me the staff", false)]);
  expect(out?.whole).toBe("show me the staff");
});

test("two real segments are joined, in the order they were said", () => {
  const m = new Map<string, { text: string; final: boolean }>();
  foldSegments(m, [seg("a", "hey hi how", false)]);
  const out = foldSegments(m, [seg("b", "was your day")]);
  // The complaint this fixes: "hey hi how was ur day" arriving as "was ur day".
  expect(out?.whole).toBe("hey hi how was your day");
  expect(out?.allFinal).toBe(false);
});
