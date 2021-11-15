import { By, Capabilities, Condition, logging, WebDriver, WebElement } from "selenium-webdriver";
import * as chrome from "selenium-webdriver/chrome";
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
    let e = JSON.parse(x.message).message;
    if (e.params.name === "EventDispatch") {
      if (e.params.args.data.type === "click") {
        result.clickStart = +e.params.ts;
      }
    } else if (e.params.name === "Paint") {
      result.paintEnd = Math.max(result.paintEnd, +e.params.ts + e.params.dur);
    }
  });
  return result;
}

async function fetchEventsFromPerformanceLog(driver: WebDriver): Promise<TimelineEvents> {
  let entries = await driver.manage().logs().get(logging.Type.PERFORMANCE);
  return extractRelevantEvents(entries);
}

function init(trace: boolean): WebDriver {
  let width = 1280;
  let height = 800;

  // Fix for chrome 95:
  if (process.platform === "linux") {
    width *= 2;
    height *= 2;
  }

  let args = [
    // "--js-flags=--expose-gc",
    // "--enable-precise-memory-info",
    // "--enable-gpu-rasterization",
    // "--no-first-run",
    // "--disable-background-networking",
    // "--disable-background-timer-throttling",
    // "--disable-cache",
    // "--disable-translate",
    // "--disable-sync",
    "--disable-extensions",
    // "--disable-default-apps",
    // "--remote-debugging-port=9999",
    `--window-size=${width},${height}`,
  ];

  let caps = trace
    ? new Capabilities({
        browserName: "chrome",
        platform: "ANY",
        version: "stable",
        "goog:chromeOptions": {
          binary: "/usr/bin/google-chrome",
          args: args,
          perfLoggingPrefs: {
            enableNetwork: true,
            enablePage: true,
            traceCategories: "devtools.timeline,blink.user_timing",
          },
          excludeSwitches: ["enable-automation"],
        },
        "goog:loggingPrefs": {
          browser: "ALL",
          performance: "ALL",
        },
      })
    : new Capabilities({
        browserName: "chrome",
        platform: "ANY",
        version: "stable",
        "goog:chromeOptions": {
          binary: "/usr/bin/google-chrome",
          args: args,
          excludeSwitches: ["enable-automation"],
        },
        "goog:loggingPrefs": {
          browser: "ALL",
        },
      });

  // port probing fails sometimes on windows, the following driver construction avoids probing:
  let service = new chrome.ServiceBuilder().setPort(9998).build();
  var driver = chrome.Driver.createSession(caps, service);

  return driver;
}

/* Run the benchmark: Load the page, wait for page, click on append 1,000 rows.
    Can be run with tracing enabled or disabled.
    Returns timing info from metrics() and if tracing is enabled extract the duration from the timeline.
*/
async function run(driver: WebDriver, framework: string, url: string, trace: boolean) {
  await driver.get(url);
  let add = await driver.findElement(By.id("add"));
  await add.click();

  let duration = {
    timelineResult: 0,
  };
  if (trace) {
    let timelineResult = await fetchEventsFromPerformanceLog(driver);
    duration.timelineResult = (timelineResult.paintEnd - timelineResult.clickStart) / 1000.0;
    // console.log(`${framework} ${trace ? "trace" : "no-trace"} timeline ${duration.timelineResult}`);
  } else {
    // console.log(`${framework} ${trace ? "trace" : "no-trace"} `);
  }
  return duration;
}

async function main() {
  let consoleBuffer: string[] = [];

  const COUNT = 25;
  let logmatch = /^https:\/\/stefankrause\.net.* (\d+(\.\d+)?)$/;

  const doTrace = [true, false];
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
      consoleBuffer = [];
      for (let i = 0; i < COUNT; i++) {
        const driver = await init(trace);
        try {
          let duration = await run(driver, framework, makeUrl(framework), trace);
          if (trace) vresult["timeline"].add(duration.timelineResult);
          await driver.sleep(500);

          let logEntries = await driver.manage().logs().get(logging.Type.BROWSER);
          for (let entry of logEntries) {
            let m = entry.message.match(logmatch);
            if (m) {
              consoleBuffer.push(m[1]);
              // console.log(`[CONSOLE]: ${m[1]}`);
            } else {
              // console.log("ignoring log message ", entry.message);
            }
          }
        } finally {
          await driver.close();
        }
      }

      if (consoleBuffer.length != COUNT) throw new Error(`Expected ${COUNT} console messages, but there were only ${consoleBuffer.length}`);
      consoleBuffer.forEach((c) => {
        vresult[trace ? "clientTracing" : "clientNoTracing"].add(Number(c));
      });
    }
    let result: any = {};
    for (let k of Object.keys(vresult)) {
      let o: any = (vresult as any)[k];
      result[k] = o instanceof Values ? o.toString() : o;
    }
    result["clientFactor"] = (vresult.clientTracing.statistics().mean / vresult.clientNoTracing.statistics().mean).toFixed(3);
    results.push(result);
  }
  console.log("chromedriverIt");
  console.table(results);
}

main().then(() => console.log("done"));
