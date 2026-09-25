import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(resolve("artifacts/onboarding-issue/concept.html")).href);
await page.screenshot({ path: "artifacts/onboarding-issue/12-concept.png" });
await browser.close();
