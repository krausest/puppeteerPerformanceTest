import { readFile } from "fs/promises";
import { Browser, Page } from "playwright-core";
import { chromium } from "playwright";

const jStat = require("jstat").jStat;

class Values {
  private values: number[] = [];
  public add(value: number) {
    this.values.push(value);
  }
  public statistics() {
    let s = jStat(this.values);
    let r = {
      mean: s.mean(),
      standardDeviation: s.stdev(true),
    };
    // console.log(r, this.values);
    return r;
  }
  toString() {
    let s = this.statistics();
    return `${s.mean.toFixed(3)} (${s.standardDeviation.toFixed(3)})`;
  }
}

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

async function init(): Promise<Browser> {
  const width = 1280;
  const height = 800;

  const browser = await chromium.launch({
    headless: false,
    // executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    executablePath: "/usr/bin/google-chrome",
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
  }
  await page.click("#add");
  await page.waitForTimeout(500);
  // let recalcStyleCountOfPreviousFrame = metricsBefore.RecalcStyleCount,
  //   layoutCountOfPreviousFrame = metricsBefore.LayoutCount;
  // for (let i = 0; i < 100; i++) {
  //   // const { RecalcStyleCount, LayoutCount } = await page.metrics();
  //   // const isStable = recalcStyleCountOfPreviousFrame === RecalcStyleCount && LayoutCount === layoutCountOfPreviousFrame;
  //   // if (isStable) {
  //   //   break;
  //   // }
  //   recalcStyleCountOfPreviousFrame = RecalcStyleCount;
  //   layoutCountOfPreviousFrame = LayoutCount;
  //   await new Promise((res) => globalThis.setTimeout(res, 16, []));
  // }
  // let metricsAfter = await page.metrics();
  //   console.log(metricsAfter);
  let duration = {
    style: 0, //(metricsAfter.RecalcStyleDuration! - metricsBefore.RecalcStyleDuration!) * 1000.0,
    layout: 0, //(metricsAfter.LayoutDuration! - metricsBefore.LayoutDuration!) * 1000.0,
    script: 0, //(metricsAfter.ScriptDuration! - metricsBefore.ScriptDuration!) * 1000.0,
    task: 0, //(metricsAfter.TaskDuration! - metricsBefore.TaskDuration!) * 1000.0,
    timelineResult: 0,
  };
  if (trace) {
    await browser.stopTracing();
    let timelineResult = await fetchEventsFromPerformanceLog(traceFileName);
    duration.timelineResult = (timelineResult.paintEnd - timelineResult.clickStart) / 1000.0;
    // console.log(`${framework} ${trace ? "trace" : "no-trace"} task ${duration.task} timeline ${duration.timelineResult}`);
  } else {
    // console.log(`${framework} ${trace ? "trace" : "no-trace"} task ${duration.task} `);
  }
  return duration;
}

async function main() {
  // The frameworks attempt to measure duration on the client side and print it on the
  // console. We're buffering the console output to compute the average.
  let consoleBuffer: string[] = [];

  const COUNT = 25;

  const doTrace = [true, false];
  // const framkeworks = ["vanillajs"];
  const framkeworks = ["vanillajs", "svelte"]; //, "react-hooks", "domvm", "fidan"];
  const makeUrl = (name: string) => `https://stefankrause.net/chrome-perf/frameworks/keyed/${name}/index.html`;
  let results: any[] = [];

  for (let framework of framkeworks) {
    let vresult = {
      framework,
      clientTracing: new Values(),
      clientNoTracing: new Values(),
      timeline: new Values(),
    };
    for (let trace of doTrace) {
      for (let i = 0; i < COUNT; i++) {
        const browser = await init();
        const page = await browser.newPage();
        page.on("console", async (msg) => {
          for (let i = 0; i < msg.args().length; ++i) {
            let val = await msg.args()[i].jsonValue();
            consoleBuffer.push((val as any).toString());
            // console.log(`[CONSOLE]: ${val}`);
          }
        });
        let duration = await run(browser, page, framework, makeUrl(framework), trace);
        if (trace) vresult["timeline"].add(duration.timelineResult);
        await browser.close();
      }
      if (consoleBuffer.length != COUNT) throw new Error(`Expected ${COUNT} console messages, but there were only ${consoleBuffer.length}`);
      consoleBuffer.forEach((c) => {
        vresult[trace ? "clientTracing" : "clientNoTracing"].add(Number(c));
      });
      consoleBuffer = [];
    }
    let result: any = {};
    for (let k of Object.keys(vresult)) {
      let o: any = (vresult as any)[k];
      result[k] = o instanceof Values ? o.toString() : o;
    }
    result["clientFactor"] = (vresult.clientTracing.statistics().mean / vresult.clientNoTracing.statistics().mean).toFixed(3);
    results.push(result);
  }
  console.log("playwrigthIt");
  console.table(results);
}

main().then(() => console.log("done"));
