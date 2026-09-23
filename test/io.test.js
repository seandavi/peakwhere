import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { linesFromFile, linesFromStream } from "../src/io.js";

const collect = async (iterable) => {
  const out = [];
  for await (const item of iterable) out.push(item);
  return out;
};

/** A byte stream delivering `bytes` in chunks of `size` bytes. */
const chunked = (bytes, size) =>
  new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    },
  });

const utf8 = (text) => new TextEncoder().encode(text);

test("splits on \\n and \\r\\n and keeps a final line with no newline", async () => {
  const lines = await collect(linesFromStream(chunked(utf8("a\r\nb\n\nc\r\nd"), 1024)));
  assert.deepEqual(lines, ["a", "b", "", "c", "d"]);
});

test("a final newline does not add an empty line", async () => {
  assert.deepEqual(await collect(linesFromStream(chunked(utf8("a\nb\n"), 1024))), ["a", "b"]);
  assert.deepEqual(await collect(linesFromStream(chunked(utf8("a\r\nb\r\n"), 1024))), ["a", "b"]);
});

test("empty and one-byte inputs", async () => {
  assert.deepEqual(await collect(linesFromStream(chunked(new Uint8Array(0), 1))), []);
  assert.deepEqual(await collect(linesFromStream(chunked(utf8("x"), 1))), ["x"]);
  assert.deepEqual(await collect(linesFromStream(chunked(utf8("\x1f"), 1))), ["\x1f"]);
});

test("chunk boundaries anywhere: inside \\r\\n and inside a multi-byte character", async () => {
  const text = "5′ UTR\r\nα\tβ\r\nlast";
  for (const size of [1, 2, 3, 5]) {
    const lines = await collect(linesFromStream(chunked(utf8(text), size)));
    assert.deepEqual(lines, ["5′ UTR", "α\tβ", "last"], `chunk size ${size}`);
  }
});

test("gzip is detected by content, not by file name", async () => {
  const text = "##gff-version 3\nchrF\tx\texon\t1\t2\t.\t+\t.\tParent=t\n";
  const gzipped = new File([gzipSync(text)], "annotation.gff3");
  const plainNamedGz = new File([text], "annotation.gff3.gz");
  const expected = ["##gff-version 3", "chrF\tx\texon\t1\t2\t.\t+\t.\tParent=t"];
  assert.deepEqual(await collect(linesFromFile(gzipped)), expected);
  assert.deepEqual(await collect(linesFromFile(plainNamedGz)), expected);
});

test("gzip magic bytes split across chunks", async () => {
  const lines = await collect(linesFromStream(chunked(gzipSync("a\r\nb"), 1)));
  assert.deepEqual(lines, ["a", "b"]);
});

test("corrupt gzip is an error, not an empty file", async () => {
  const truncated = gzipSync("a\nb\n".repeat(1000)).subarray(0, 30);
  await assert.rejects(collect(linesFromFile(new Blob([truncated]))));
});

test("multi-member gzip (bgzip) is read whole or fails with an error that says so", async () => {
  // Node 22's DecompressionStream reads every member; Node 24+ and Chrome stop after the
  // first. Either is fine. Silently returning only the first member is not.
  const members = new Blob([gzipSync("a\n"), gzipSync("b\n")]);
  let lines;
  try {
    lines = await collect(linesFromFile(members));
  } catch (error) {
    assert.match(error.message, /multi-member gzip.*bgzip.*issue #24/s);
    return;
  }
  assert.deepEqual(lines, ["a", "b"]);
});

test("stopping early cancels the underlying stream", async () => {
  let cancelled = false;
  let pulls = 0;
  const endless = new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(utf8("line\n".repeat(100)));
    },
    cancel() {
      cancelled = true;
    },
  });
  for await (const line of linesFromStream(endless)) {
    assert.equal(line, "line");
    break;
  }
  assert.ok(cancelled);
  assert.ok(pulls < 10, `pulled ${pulls} chunks`);
});
