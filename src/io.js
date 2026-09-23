// Bytes → lines, streaming. Gzip is detected by content (the 1f 8b magic bytes), never
// by file name, and decoded with the platform's DecompressionStream. Nothing here holds
// a whole file: GENCODE's GTF is 630 MB unpacked.

/**
 * Lines of a File or Blob, plain or gzipped.
 * @param {Blob} file
 * @returns {AsyncIterable<string>}
 */
export function linesFromFile(file) {
  return linesFromStream(file.stream());
}

/**
 * Lines of a byte stream, plain or gzipped. Lines end at \n or \r\n; the terminator is
 * not included. A final line with no newline is still yielded; a final newline does not
 * produce an extra empty line.
 * @param {ReadableStream<Uint8Array>} stream
 * @returns {AsyncIterable<string>}
 */
export async function* linesFromStream(stream) {
  const reader = (await decodedText(stream)).getReader();
  let rest = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = rest + value;
      let from = 0;
      let nl;
      while ((nl = text.indexOf("\n", from)) !== -1) {
        yield nl > from && text.charCodeAt(nl - 1) === 13 ? text.slice(from, nl - 1) : text.slice(from, nl);
        from = nl + 1;
      }
      rest = text.slice(from);
    }
    if (rest.endsWith("\r")) rest = rest.slice(0, -1);
    if (rest) yield rest;
  } finally {
    // Reached early when the consumer stops iterating: stop reading the file too.
    await reader.cancel().catch(() => {});
  }
}

/** Text stream of `stream`, gunzipped first if it starts with the gzip magic bytes. */
async function decodedText(stream) {
  const reader = stream.getReader();
  const head = [];
  const magic = [];
  while (magic.length < 2) {
    const { value, done } = await reader.read();
    if (done) break;
    head.push(value);
    magic.push(...value.subarray(0, 2 - magic.length));
  }
  const gzip = magic[0] === 0x1f && magic[1] === 0x8b;

  // The bytes already read are put back in front of the rest of the stream.
  const replayed = new ReadableStream({
    start(controller) {
      for (const chunk of head) controller.enqueue(chunk);
    },
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  const bytesStream = gzip ? replayed.pipeThrough(new DecompressionStream("gzip")) : replayed;
  return bytesStream.pipeThrough(new TextDecoderStream());
}
