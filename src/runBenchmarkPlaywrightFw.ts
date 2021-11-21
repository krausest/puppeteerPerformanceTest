import { readFile } from "fs/promises";
import { Browser, Page } from "playwright-core";
import { chromium } from "playwright";

import { TimelineEvents, Values, fetchEventsFromPerformanceLog, makeUrl, sleep } from "./common";

async function init(executable: string): Promise<Browser> {
  const width = 1280;
  const height = 800;

  const browser = await chromium.launch({
    headless: false,
    // executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    executablePath: executable,
  });
  return browser;
}

/* Run the benchmark: Load the page, wait for page, click on append 1,000 rows.
    Can be run with tracing enabled or disabled.
    Returns timing info from metrics() and if tracing is enabled extract the duration from the timeline.
*/
async function run(browser: Browser, page: Page, framework: string, url: string, trace: boolean) {
  await page.goto(url);
  await page.waitForSelector("#add");

  let traceFileName = `trace_${framework}.json`;

  if (trace) {
    await browser.startTracing(page, {
      path: traceFileName,
      screenshots: false,
      categories: ["devtools.timeline"], //, "blink.user_timing"],
    });
  } else {
    console.log("fake start tracing");
  }
  await page.click("#add");
  let duration = {
    timelineResult: 0,
  };
  if (trace) {
    await browser.stopTracing();
    let timelineResult = await fetchEventsFromPerformanceLog(traceFileName);
    duration.timelineResult = (timelineResult.paintEnd - timelineResult.clickStart) / 1000.0;
    // console.log(`${framework} ${trace ? "trace" : "no-trace"} task ${duration.task} timeline ${duration.timelineResult}`);
  } else {
    // await browser.stopTracing();
    // console.log(`${framework} ${trace ? "trace" : "no-trace"} task ${duration.task} `);
  }
  return duration;
}

export async function main(executable: string, COUNT: number, framkeworks: string[]) {
  // The frameworks attempt to measure duration on the client side and print it on the
  // console. We're buffering the console output to compute the average.
  let consoleBuffer: string[] = [];

  const doTrace = [false, true];
  // const framkeworks = ["vanillajs"];
  let results: any[] = [];

  for (let framework of framkeworks) {
    let vresult = {
      runner: "playwrigthFw",
      framework,
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
          console.log(`[CONSOLE] ${trace}: ${val}`);
        }
      });
      console.log("new page");
      for (let i = 0; i < COUNT; i++) {
        let duration = await run(browser, page, framework, makeUrl(framework), trace);
        console.log("run", i, trace);
        if (trace) vresult["timeline"].add(duration.timelineResult);
      }
      await sleep(500);

      if (!trace) {
        console.log("perform dummy run with start tracing, otherwise one console output is often missing");
        await run(browser, page, framework, makeUrl(framework), true);
        // throw it away again, it seem necessary to get all former console messages
        consoleBuffer = consoleBuffer.slice(0, consoleBuffer.length - 1);
      }
      if (consoleBuffer.length != COUNT) throw new Error(`Expected ${COUNT} console messages, but there were only ${consoleBuffer.length}`);
      consoleBuffer.forEach((c) => {
        vresult[trace ? "clientTracing" : "clientNoTracing"].add(Number(c));
      });
      consoleBuffer = [];
      console.log("run done");

      await browser.close();
      console.log("close");
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
  console.log("playwrigthFw");
  console.table(results);
  return results;
}
