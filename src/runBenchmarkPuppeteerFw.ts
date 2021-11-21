import { readFile } from "fs/promises";
import puppeteer from "puppeteer-core";
import { Browser, Page } from "puppeteer-core";
import { TimelineEvents, Values, fetchEventsFromPerformanceLog, makeUrl, sleep } from "./common";

/* Initialize puppeteer  */
async function init(executable: string) {
  const width = 1280;
  const height = 800;

  const browser = await puppeteer.launch({
    headless: false,
    // Change path here when chrome isn't found
    executablePath: executable,
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

  let traceFileName = `trace_${framework}.json`;

  if (trace) {
    await page.tracing.start({
      path: traceFileName,
      screenshots: false,
      categories: ["devtools.timeline"], //, "blink.user_timing"],
    });
  }

  await page.click("#add");
  let duration = {
    timelineResult: 0,
  };
  await sleep(500);
  if (trace) {
    await page.tracing.stop();
    let timelineResult = await fetchEventsFromPerformanceLog(traceFileName);
    duration.timelineResult = (timelineResult.paintEnd - timelineResult.clickStart) / 1000.0;
    // console.log(`${framework} ${trace ? "trace" : "no-trace"} timeline ${duration.timelineResult}`);
  } else {
    // console.log(`${framework} ${trace ? "trace" : "no-trace"} `);
  }
  return duration;
}

export async function main(executable: string, COUNT: number, framkeworks: string[]) {
  // The frameworks attempt to measure duration on the client side and print it on the
  // console. We're buffering the console output to compute the average.
  let consoleBuffer: string[] = [];

  const doTrace = [true, false];
  let results: any[] = [];

  for (let framework of framkeworks) {
    let vresult = {
      runner: "puppeteerFw",
      framework,
      // taskTracing: new Values(),
      // taskNoTracing: new Values(),
      clientTracing: new Values(),
      clientNoTracing: new Values(),
      timeline: new Values(),
    };
    for (let trace of doTrace) {
      const browser = await init(executable);
      const page = await browser.newPage();
      page.on("console", async (msg) => {
        for (let i = 0; i < msg.args().length; ++i) {
          let val = await msg.args()[i].jsonValue();
          consoleBuffer.push((val as any).toString());
          // console.log(`[CONSOLE]: ${val}`);
        }
      });
      for (let i = 0; i < COUNT; i++) {
        let duration = await run(page, framework, makeUrl(framework), trace);
        if (trace) vresult["timeline"].add(duration.timelineResult);
      }
      if (consoleBuffer.length != COUNT) throw new Error(`Expected ${COUNT} console messages, but there were only ${consoleBuffer.length}`);
      consoleBuffer.forEach((c) => {
        vresult[trace ? "clientTracing" : "clientNoTracing"].add(Number(c));
      });
      consoleBuffer = [];
      await browser.close();
    }
    let result: any = {};
    for (let k of Object.keys(vresult)) {
      let o: any = (vresult as any)[k];
      result[k] = o instanceof Values ? o.toString() : o;
    }
    console.log(framework, vresult.timeline.values);
    result["clientFactor"] = (vresult.clientTracing.statistics().mean / vresult.clientNoTracing.statistics().mean).toFixed(3);
    results.push(result);
  }
  console.log("puppeteerFw");
  console.table(results);
  return results;
}
