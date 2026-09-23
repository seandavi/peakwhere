// Module worker: runs analyses off the main thread (SPEC §5). The work is in
// src/analysis.js; this file only passes messages.
//
// In:  {type: "run", id, request}                 request as in Analysis.run
// Out: {type: "progress", id, progress: {message, fraction}}
//      {type: "result", id, result}               result as returned by Analysis.run
//      {type: "superseded", id}                   a newer run replaced this one
//      {type: "error", id, message}
//
// Runs are handled one at a time, in order. A run that is no longer the latest is
// dropped before it starts, or stopped at its next safe point.
import { Analysis, SupersededError } from "./analysis.js";

const analysis = new Analysis();
let latestId = null;
let queue = Promise.resolve();

self.addEventListener("message", ({ data }) => {
  if (data?.type !== "run") return;
  const { id, request } = data;
  latestId = id;
  queue = queue.then(() => handle(id, request));
});

async function handle(id, request) {
  if (id !== latestId) {
    self.postMessage({ type: "superseded", id });
    return;
  }
  try {
    const result = await analysis.run(request, {
      onProgress: (progress) => self.postMessage({ type: "progress", id, progress }),
      shouldStop: () => id !== latestId,
    });
    self.postMessage({ type: "result", id, result });
  } catch (error) {
    if (error instanceof SupersededError) self.postMessage({ type: "superseded", id });
    else self.postMessage({ type: "error", id, message: error?.message ?? String(error) });
  }
}
