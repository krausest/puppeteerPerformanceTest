import * as puppeterPerIt from "./runBenchmarkPuppeteerIt";
import * as puppeterPerFw from "./runBenchmarkPuppeteerFw";
import * as playwrightIt from "./runBenchmarkPlaywrightIt";
import * as playwrightFw from "./runBenchmarkPlaywrightFw";
import * as chromedriverIt from "./runBenchmarkChromedriverIt";
import * as chromedriverFw from "./runBenchmarkChromedriverFw";

async function main() {
  let executable = process.argv[2];
  if (!executable) throw new Error("must pass path to chrome executable as argument");
  console.log("executable", executable);

  const COUNT = 25;
  const framkeworks = ["vanillajs", "svelte"]; //, "react-hooks", "domvm", "fidan"];

  let results: any = [];
  let runners = [puppeterPerIt, puppeterPerFw, playwrightIt, playwrightFw, chromedriverIt, chromedriverFw];
  for (let runner of runners) {
    let res = await runner.main(executable, COUNT, framkeworks);
    results = results.concat(res);
  }
  console.table(results);
}
//  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
//  /usr/bin/google-chrome
// "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" 

main().then(() => {});
