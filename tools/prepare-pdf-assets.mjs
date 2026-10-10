import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const destination = fileURLToPath(
  new URL("../src/ui/public/pdf-assets/", import.meta.url),
);
mkdirSync(destination, { recursive: true });
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  cpSync(join(packageRoot, directory), join(destination, directory), {
    recursive: true,
  });
}
cpSync(join(packageRoot, "LICENSE"), join(destination, "LICENSE"));
