// The EPERM that broke "Create code project" was intermittent, so one passing
// run proves nothing. This extracts a wrapped archive of real size, over and
// over, and fails if any single round leaves the wrapper folder behind.
import fs from "fs";
import os from "os";
import path from "path";

import { extractZip, zipDirectory } from "./utils/archive.js";

const ROUNDS = Number(process.argv[2] || 12);

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
};

/**
 * Build a wrapped project on disk, then zip it — the same shape that failed:
 * one top-level folder holding several directories of many small files.
 */
const buildSourceTree = (root) => {
  const layout = {
    "wrapper/backend/server.js": "import express from 'express'\n",
    "wrapper/backend/package.json": '{"name":"backend"}\n',
    "wrapper/frontend/index.html": "<!doctype html><h1>Hi</h1>\n",
    "wrapper/frontend/package.json": '{"name":"frontend","devDependencies":{"vite":"^8"}}\n',
    "wrapper/README.md": "# Wrapped project\n",
  };

  for (const [rel, content] of Object.entries(layout)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  // Enough files that Windows still has handles open when the move begins
  for (const area of ["backend/controllers", "backend/models", "frontend/src/components"]) {
    for (let i = 0; i < 60; i += 1) {
      const full = path.join(root, "wrapper", area, `file${i}.js`);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, `// ${area} file ${i}\nexport const n = ${i};\n`.repeat(12));
    }
  }
};

const main = async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "strip-"));
  const source = path.join(scratch, "src");
  const zipPath = path.join(scratch, "wrapped.zip");

  buildSourceTree(source);
  const written = await zipDirectory(source, zipPath);
  console.log(`archive: ${written.files} files, ${(written.size / 1024).toFixed(0)} KB\n`);

  for (let round = 1; round <= ROUNDS; round += 1) {
    const dest = path.join(scratch, `dest-${round}`);

    try {
      const report = await extractZip(zipPath, dest);
      const top = fs.readdirSync(dest).sort();

      const unwrapped = !top.includes("wrapper");
      const intact =
        fs.existsSync(path.join(dest, "backend", "server.js")) &&
        fs.existsSync(path.join(dest, "frontend", "index.html")) &&
        fs.existsSync(path.join(dest, "backend", "controllers", "file0.js"));

      check(
        `round ${String(round).padStart(2)}: wrapper lifted, tree intact`,
        unwrapped && intact,
        `${report.files} files, top = ${top.join(", ")}`
      );
    } catch (err) {
      check(`round ${String(round).padStart(2)}: extract threw`, false, `${err.code || ""} ${err.message}`);
    }
  }

  fs.rmSync(scratch, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

main().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});
