// Run against `tools/ui.ps1 -Mode preview`. IPC is mocked: no key/API request.
// node tools/test-analysis-ui.cjs <multipage.pdf> <saved 0.5 report.json>
const { chromium } = require("playwright");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const path = require("node:path");
(async () => {
  const [pdfPath, reportPath] = process.argv.slice(2);
  assert(
    pdfPath && reportPath,
    "Provide a PDF with >=2 pages and a saved 0.5 report",
  );
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  const first = report.data.observations[0];
  first.raw_text = "UI CHECK 35";
  first.evidence = [
    {
      page: 2,
      bbox: [0.1, 0.2, 0.3, 0.4],
      description: "Контроль перехода на второй лист",
    },
  ];
  report.data.observations[1].raw_text = "UI NO BOX";
  report.data.observations[1].evidence = [
    { page: 1, bbox: null, description: "Нет координат" },
  ];
  report.data.observations[2].raw_text = "<script>window.bad=true</script>";
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(
      ({ report }) => {
        window.isTauri = true;
        window.testCalls = [];
        window.__TAURI_INTERNALS__ = {
          transformCallback: () => 1,
          unregisterCallback: () => {},
          invoke: async (cmd, args) => {
            window.testCalls.push(cmd);
            if (cmd === "model_status")
              return {
                provider: "Kimi API",
                model: "kimi-k3",
                endpoint: "https://api.moonshot.ai/v1",
                keyStored: true,
              };
            if (cmd === "analyze_drawing") {
              if (args.input.pages.length < 2)
                throw Error("Need multipage PDF");
              return structuredClone(report);
            }
            if (cmd === "save_analysis") {
              window.savedAnalysis = args.data;
              return true;
            }
            throw Error(`Unexpected command: ${cmd}`);
          },
        };
      },
      { report },
    );
    await page.goto(process.env.ANALYSIS_UI_URL || "http://127.0.0.1:4173");
    await page.locator("input[type=file]").setInputFiles(pdfPath);
    await page
      .locator(".panel-toolbar")
      .getByText("PDF", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Разобрать чертёж", exact: true })
      .click({ timeout: 120000 });
    await page
      .getByRole("button", { name: "Обозначения", exact: true })
      .waitFor({ timeout: 120000 });
    await page
      .getByRole("button", { name: "Обозначения", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Поиск обозначения" })
      .fill("UI CHECK");
    await page.locator(".fact-card .source-link").first().click();
    await page.waitForFunction(
      () =>
        document
          .querySelector(".pdf-navigation")
          ?.textContent.includes("2 /") &&
        document.querySelector(".pdf-source-highlight"),
    );
    const rect = await page
      .locator(".pdf-source-highlight")
      .evaluate((el) => ({
        left: el.style.left,
        top: el.style.top,
        width: el.style.width,
        height: el.style.height,
      }));
    assert.equal(parseFloat(rect.left), 10);
    assert.equal(parseFloat(rect.top), 20);
    assert(Math.abs(parseFloat(rect.width) - 20) < 0.001);
    assert.equal(parseFloat(rect.height), 20);
    // Repeat selection, zoom and fit must preserve the normalized source region.
    await page.locator(".fact-card .source-link").first().click();
    await page.getByRole("button", { name: "Вписать PDF по ширине" }).click();
    await page.locator(".pdf-canvas-area[aria-busy=false]").waitFor();
    await page.locator(".pdf-source-highlight").waitFor();
    assert.equal(await page.locator(".pdf-source-highlight").count(), 1);
    await page
      .getByRole("textbox", { name: "Поиск обозначения" })
      .fill("UI NO BOX");
    await page.locator(".fact-card .source-link").first().click();
    await page.waitForFunction(
      () =>
        document
          .querySelector(".pdf-navigation")
          ?.textContent.includes("1 /") &&
        !document.querySelector(".pdf-source-highlight"),
    );
    await page
      .getByRole("textbox", { name: "Поиск обозначения" })
      .fill("<script>");
    assert.equal(await page.locator(".fact-card").count(), 1);
    assert.equal(await page.evaluate(() => window.bad), undefined);
    await page.getByRole("button", { name: /^Проверки \(/ }).click();
    assert.equal(
      await page.locator(".local-check").count(),
      report.data.validation.checks.length,
    );
    await page.getByRole("button", { name: "Детали", exact: true }).click();
    await page
      .getByRole("button", { name: "Общие сведения", exact: true })
      .click();
    await page.getByText("Виды и разрезы", { exact: true }).waitFor();
    await page.getByRole("button", { name: /Сохранить JSON/ }).click();
    await page.waitForFunction(() => window.savedAnalysis);
    assert.equal(
      await page.evaluate(() => window.savedAnalysis.schema_version),
      "0.2.0-draft",
    );
    await page.setViewportSize({ width: 1100, height: 800 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await fs.mkdir(".local/acceptance", { recursive: true });
    await page.screenshot({
      path: path.resolve(".local/acceptance/v050-ui.png"),
    });
    assert.deepEqual(errors, []);
    assert.equal(
      (await page.evaluate(() => window.testCalls)).filter(
        (x) => x === "analyze_drawing",
      ).length,
      1,
    );
    console.log(
      "UI checks passed: multipage source, normalized highlight, repeated selection/zoom, missing bbox, literal HTML, checks, general requirements, export, 1100px layout. All IPC mocked; no API calls.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
