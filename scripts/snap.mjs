// Load a page in a real (headless) Chrome, save a screenshot, and report console
// errors and any request that leaves the page's origin.
// Usage: npm run snap -- <url> [out.png] [--wait <ms>] [--click "<css selector>"]
// Uses the locally installed Chrome (channel "chrome"); no browser download.
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const wait = Number(flag("--wait") ?? 500);
const click = flag("--click");
const [url, out = "snap.png"] = args;
if (!url) {
  console.error("usage: npm run snap -- <url> [out.png] [--wait ms] [--click selector]");
  process.exit(2);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const origin = new URL(url).origin;
const problems = [];
// Report every console error. Failed loads also appear below with their URL, except
// the ones Chrome makes outside the page (such as /favicon.ico), which only show here.
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("response", (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url()}`));
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("request", (r) => {
  const u = r.url();
  if (!u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:")) {
    problems.push(`offsite request: ${u}`);
  }
});

await page.goto(url, { waitUntil: "load" });
if (click) await page.click(click);
await page.waitForTimeout(wait);
await page.screenshot({ path: out, fullPage: true });
await browser.close();

console.log(`screenshot: ${out}`);
if (problems.length) {
  console.log(problems.join("\n"));
  process.exit(1);
}
console.log("no console errors, no offsite requests");
