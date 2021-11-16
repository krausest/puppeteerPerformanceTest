// https://stefankrause.net/frameworks/non-keyed/polymer/build/es6-bundled/index.html

import puppeteer from "puppeteer-core";
import { Browser, Page } from "puppeteer-core";

/* Initialize puppeteer  */
async function init() {
  const width = 1280;
  const height = 800;

  const browser = await puppeteer.launch({
    headless: false,
    // Change path here when chrome isn't found
    executablePath: process.platform == "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome",
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

async function run(page: Page, url: string) {
  await page.goto(url);

  // does NOT work for polymer:
  console.log('page.waitForSelector("pierce/#run")');
  await page.waitForSelector("pierce/#run");

  // // does work:
  // await page.waitForTimeout(500);
  // await page.waitForSelector("pierce/#run");

  // does work:
  // for (let i = 0; i < 10; i++) {
  //   console.log('$("pierce/#run")');
  //   let elem = await page.$("pierce/#run");
  //   if (elem) {
  //     await elem.dispose();
  //     break;
  //   }
  //   await page.waitForTimeout(1000);
  // }
}

async function main() {
  const urls = [
    "https://stefankrause.net/frameworks/keyed/vanillajs/index.html",
    "https://stefankrause.net/frameworks/keyed/lit/index.html",
    "https://stefankrause.net/frameworks/non-keyed/polymer/build/es6-bundled/index.html",
  ];

  const browser = await init();
  const page = await browser.newPage();
  for (let url of urls) {
    let duration = await run(page, url);
  }
  await browser.close();
}

main().then(() => console.log("done"));
