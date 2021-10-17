import { readFile } from "fs/promises";
import puppeteer from "puppeteer-core";
import { Browser, Page } from "puppeteer-core";

/* Simulate what js-framework-benchmark does when computing
 the duration from the chrome tracing events */
interface TimelineEvents {
  clickStart: number;
  paintEnd: number;
}

function extractRelevantEvents(entries: any[]): TimelineEvents {
  let result = { clickStart: 0, paintEnd: 0 };
  entries.forEach((x) => {
    let e = x;
    // console.log(JSON.stringify(e));
    if (e.name === "EventDispatch") {
      if (e.args.data.type === "click") {
        // console.log("CLICK ",+e.ts);
        result.clickStart = +e.ts;
      }
    } else if (e.name === "Paint" && e.ph === "X") {
      result.paintEnd = Math.max(result.paintEnd, +e.ts + e.dur);
    }
  });
  return result;
}

async function fetchEventsFromPerformanceLog(fileName: string): Promise<TimelineEvents> {
  let contents = await readFile(fileName, { encoding: "utf8" });
  let json = JSON.parse(contents);
  let entries = json["traceEvents"];
  return extractRelevantEvents(entries);
}

/* Initialize puppeteer  */
async function init() {
  const width = 1280;
  const height = 800;

  const browser = await puppeteer.launch({
    headless: false,
    // Change path here when chrome isn't found
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

/* Run the benchmark: Load the page, wait for page, click on append 1,000 rows.
    Can be run with tracing enabled or disabled.
    Returns timing info from metrics() and if tracing is enabled extract the duration from the timeline.
*/
async function run(page: Page, framework: string, url: string, trace: boolean) {
  await page.goto(url);
  await page.waitForSelector("#add");

  let metricsBefore = await page.metrics();
  let traceFileName = `trace_${framework}.json`;

  if (trace) {
    await page.tracing.start({
      path: traceFileName,
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
  let metricsAfter = await page.metrics();
  //   console.log(metricsAfter);
  let duration = {
    style: (metricsAfter.RecalcStyleDuration! - metricsBefore.RecalcStyleDuration!) * 1000.0,
    layout: (metricsAfter.LayoutDuration! - metricsBefore.LayoutDuration!) * 1000.0,
    script: (metricsAfter.ScriptDuration! - metricsBefore.ScriptDuration!) * 1000.0,
    task: (metricsAfter.TaskDuration! - metricsBefore.TaskDuration!) * 1000.0,
    timelineResult: 0,
    get sum() {
      return this.task;
    },
  };
  if (trace) {
    await page.tracing.stop();
    let timelineResult = await fetchEventsFromPerformanceLog(traceFileName);
    duration.timelineResult = timelineResult.paintEnd - timelineResult.clickStart;
  }
  return duration;
}

async function main() {
  const browser = await init();
  const page = await browser.newPage();

  // The frameworks attempt to measure duration on the client side and print it on the
  // console. We're buffering the console output to compute the average.
  let consoleBuffer: string[] = [];
  page.on("console", async (msg) => {
    for (let i = 0; i < msg.args().length; ++i) {
      let val = await msg.args()[i].jsonValue();
      consoleBuffer.push((val as any).toString());
      console.log(`[CONSOLE]: ${val}`);
    }
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
      let averageTimeline = 0;
      for (let i = 0; i < COUNT; i++) {
        let duration = await run(page, framework, makeUrl(framework), trace);
        average += duration.sum;
        averageTimeline += duration.timelineResult;
      }
      result[trace ? "durWithTracing" : "durNoTracing"] = (average / COUNT).toFixed(3);
      if (consoleBuffer.length != 5) throw "Expected 5 console messages, but there were only " + consoleBuffer;
      result[trace ? "clientWithTracing" : "clientNoTracing"] = (
        consoleBuffer.reduce((p, c) => Number(c) + p, 0) / COUNT
      ).toFixed(3);
      if (trace) result["timelineResult"] = (averageTimeline / COUNT / 1000.0).toFixed(3);
      consoleBuffer = [];
    }
    result["tracingSlowdown"] = (Number(result.durWithTracing) / Number(result.durNoTracing)).toFixed(3);
    result["consolelowdown"] = (Number(result.clientWithTracing) / Number(result.clientNoTracing)).toFixed(3);
    results.push(result);
  }
  await browser.close();
  console.table(results);
}

main().then(() => console.log("done"));
