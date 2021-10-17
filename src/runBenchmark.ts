import puppeteer from "puppeteer-core";
import { Browser, Page } from "puppeteer-core";

async function init() {
  const width = 1280;
  const height = 800;

  const browser = await puppeteer.launch({
    headless: false,
    executablePath:
      process.platform == "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome",
    ignoreDefaultArgs: ["--enable-automation"],
    args: [`--window-size=${width},${height}`],
    dumpio: false,
    defaultViewport: {
      width,
      height,
    },
  });
  return browser;
}

async function run(page: Page, framework: string, url: string, trace: boolean) {
  await page.goto(url);
  await page.waitForSelector("#add");

  let metricsBefore = await page.metrics();

  if (trace) {
    await page.tracing.start({
      path: `trace_${framework}.json`,
      screenshots: false,
      categories: ["devtools.timeline", "blink.user_timing"],
    });
  }

  await page.click("#add");
  let recalcStyleCountOfPreviousFrame = metricsBefore.RecalcStyleCount,
    layoutCountOfPreviousFrame = metricsBefore.LayoutCount;
  for (let i = 0; i < 100; i++) {
    const { RecalcStyleCount, LayoutCount } = await page.metrics();
    const isStable = recalcStyleCountOfPreviousFrame === RecalcStyleCount && LayoutCount === layoutCountOfPreviousFrame;
    if (isStable) {
      break;
    }
    recalcStyleCountOfPreviousFrame = RecalcStyleCount;
    layoutCountOfPreviousFrame = LayoutCount;
    await new Promise((res) => globalThis.setTimeout(res, 16, []));
  }
  if (trace) {
    await page.tracing.stop();
  }
  let metricsAfter = await page.metrics();
  //   console.log(metricsAfter);
  let duration = {
    style: (metricsAfter.RecalcStyleDuration! - metricsBefore.RecalcStyleDuration!) * 1000.0,
    layout: (metricsAfter.LayoutDuration! - metricsBefore.LayoutDuration!) * 1000.0,
    script: (metricsAfter.ScriptDuration! - metricsBefore.ScriptDuration!) * 1000.0,
    task: (metricsAfter.TaskDuration! - metricsBefore.TaskDuration!) * 1000.0,
    get sum() {
      return this.task;
    },
  };
  return duration;
}

async function main() {
  const browser = await init();
  const page = await browser.newPage();
  page.on("console", (msg) => {
    for (let i = 0; i < msg.args().length; ++i) console.log(`[CONSOLE]: ${msg.args()[i]}`);
  });

  const COUNT = 5;

  const doTrace = [true, false];
  const framkeworks = ["vanillajs", "svelte", "react-hooks", "domvm", "fidan"];
  const makeUrl = (name: string) => `https://stefankrause.net/chrome-perf/frameworks/keyed/${name}/index.html`;

  let results: Array<any> = [];

  for (let framework of framkeworks) {
    let result: any = { framework };
    for (let trace of doTrace) {
      let average = 0;
      for (let i = 0; i < COUNT; i++) {
        let duration = await run(page, framework, makeUrl(framework), trace);
        average += duration.sum;
      }
      result[trace ? "durWithTracing" : "durNoTracing"] = average / COUNT;
    }
    result["tracingSlowdown"] = result.durWithTracing / result.durNoTracing;
    results.push(result);
  }
  await browser.close();
  console.table(results);
}

main().then(() => console.log("done"));
