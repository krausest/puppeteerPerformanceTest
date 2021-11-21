import { By, Capabilities, Condition, logging, WebDriver, WebElement } from "selenium-webdriver";
import * as chrome from "selenium-webdriver/chrome";
import { TimelineEvents, Values, extractRelevantEvents, makeUrl, sleep } from "./common";

var chromedriver: any = require("chromedriver");

async function fetchEventsFromPerformanceLog(driver: WebDriver): Promise<TimelineEvents> {
  let entries = await driver.manage().logs().get(logging.Type.PERFORMANCE);
  return extractRelevantEvents(entries.map((x) => JSON.parse(x.message).message.params));
}

function init(executable: string, trace: boolean): WebDriver {
  let width = 1280;
  let height = 800;

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
          binary: executable,
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
          binary: executable,
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
    await sleep(500);
    let timelineResult = await fetchEventsFromPerformanceLog(driver);
    duration.timelineResult = (timelineResult.paintEnd - timelineResult.clickStart) / 1000.0;
    // console.log(`${framework} ${trace ? "trace" : "no-trace"} timeline ${duration.timelineResult}`);
  } else {
    // console.log(`${framework} ${trace ? "trace" : "no-trace"} `);
  }
  return duration;
}

export async function main(executable: string, COUNT: number, framkeworks: string[]) {
  let consoleBuffer: string[] = [];

  let logmatch = /^https:\/\/stefankrause\.net.* (\d+(\.\d+)?)$/;

  const doTrace = [true, false];
  let results: any[] = [];

  for (let framework of framkeworks) {
    let vresult = {
      runner: "chromedriverIt",
      framework,
      clientTracing: new Values(),
      clientNoTracing: new Values(),
      timeline: new Values(),
    };
    for (let trace of doTrace) {
      consoleBuffer = [];
      for (let i = 0; i < COUNT; i++) {
        const driver = await init(executable, trace);
        try {
          let duration = await run(driver, framework, makeUrl(framework), trace);
          if (trace) vresult["timeline"].add(duration.timelineResult);

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
    console.log(framework, vresult.timeline.values);
    result["clientFactor"] = (vresult.clientTracing.statistics().mean / vresult.clientNoTracing.statistics().mean).toFixed(3);
    results.push(result);
  }
  console.log("chromedriverIt");
  console.table(results);
  return results;
}
