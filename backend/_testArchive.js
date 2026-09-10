// Phase 1 security check for utils/archive.js. Builds hostile ZIPs by hand and
// confirms none of them can write outside the destination folder.
// Run: node _testArchive.js     (no database, no network)
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";

import { extractZip, safeTarget } from "./utils/archive.js";

/* ------------------------------------------------- minimal zip writer (stored) */

const dosTime = () => 0;

const localHeader = (name, data, externalAttrs = 0) => {
  const nameBuf = Buffer.from(name, "utf8");
  const crc = zlib.crc32 ? zlib.crc32(data) : crc32(data);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(0, 6);
  head.writeUInt16LE(0, 8); // stored, no compression
  head.writeUInt16LE(dosTime(), 10);
  head.writeUInt16LE(dosTime(), 12);
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(data.length, 18);
  head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(nameBuf.length, 26);
  head.writeUInt16LE(0, 28);
  return { head, nameBuf, data, crc, externalAttrs };
};

// Fallback CRC32 for node versions without zlib.crc32
let table = null;
function crc32(buf) {
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Build a ZIP from [{ name, content, externalAttrs }]. */
const buildZip = (entries) => {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const data = Buffer.from(entry.content ?? "", "utf8");
    const rec = localHeader(entry.name, data, entry.externalAttrs || 0);

    parts.push(rec.head, rec.nameBuf, rec.data);
    const localOffset = offset;
    offset += rec.head.length + rec.nameBuf.length + rec.data.length;

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(0, 12);
    c.writeUInt16LE(0, 14);
    c.writeUInt32LE(rec.crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(rec.nameBuf.length, 28);
    c.writeUInt16LE(0, 30);
    c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34);
    c.writeUInt16LE(0, 36);
    c.writeUInt32LE(rec.externalAttrs >>> 0, 38);
    c.writeUInt32LE(localOffset, 42);
    central.push(c, rec.nameBuf);
  }

  const centralBuf = Buffer.concat(central);
  const centralOffset = offset;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralOffset, 16);

  return Buffer.concat([...parts, centralBuf, end]);
};

/* ---------------------------------------------------------------- the tests */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zip-sec-"));
const outside = path.join(tmp, "OUTSIDE_MARKER.txt");

let pass = 0;
let fail = 0;

const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
};

const run = async (label, entries, assert) => {
  const zipPath = path.join(tmp, `${label.replace(/\W+/g, "_")}.zip`);
  const dest = path.join(tmp, `dest_${label.replace(/\W+/g, "_")}`);
  fs.writeFileSync(zipPath, buildZip(entries));

  let report = null;
  let error = null;
  try {
    report = await extractZip(zipPath, dest);
  } catch (err) {
    error = err;
  }
  if (!report) {
    check(`${label}: extract threw unexpectedly`, false, error?.message || String(error));
    return;
  }
  await assert({ report, error, dest });
};

const main = async () => {
  console.log("\n=== safeTarget() unit checks ===");
  const root = path.resolve(tmp, "jail");
  const escapes = [
    "../evil.txt",
    "../../evil.txt",
    "a/../../evil.txt",
    "/etc/passwd",
    "C:/Windows/System32/evil.txt",
    "..\\..\\evil.txt",
    "a\\..\\..\\evil.txt",
    "\\\\server\\share\\evil.txt",
  ];
  escapes.forEach((name) =>
    check(`rejects ${JSON.stringify(name)}`, safeTarget(root, name) === null)
  );
  check("accepts src/App.jsx", safeTarget(root, "src/App.jsx") !== null);
  check("accepts nested a/b/c.txt", safeTarget(root, "a/b/c.txt") !== null);

  // A traversal or absolute path aborts the whole archive rather than being
  // skipped — an archive carrying one is hostile or corrupt, and extracting
  // the rest of it is not a favour to anyone.
  const expectRejected = async (label, entries, extra) => {
    const zipPath = path.join(tmp, `${label}.zip`);
    const dest = path.join(tmp, `dest_${label}`);
    fs.writeFileSync(zipPath, buildZip(entries));

    let error = null;
    try {
      await extractZip(zipPath, dest);
    } catch (err) {
      error = err;
    }

    check(`${label}: archive refused`, Boolean(error), error?.message);
    check(
      `${label}: message is actionable`,
      /unsafe file path|illegal characters|not a readable ZIP/i.test(error?.message || ""),
      error?.message
    );
    if (extra) await extra({ dest, error });
  };

  console.log("\n=== traversal via ZIP entries ===");
  await expectRejected(
    "traversal",
    [
      { name: "../../OUTSIDE_MARKER.txt", content: "PWNED" },
      { name: "good.txt", content: "fine" },
    ],
    async () => check("traversal: nothing written outside dest", !fs.existsSync(outside))
  );

  console.log("\n=== absolute path entry ===");
  await expectRejected(
    "absolute",
    [{ name: "/tmp/abs_pwned.txt", content: "PWNED" }],
    async () => check("absolute: nothing at /tmp/abs_pwned.txt", !fs.existsSync("/tmp/abs_pwned.txt"))
  );

  console.log("\n=== backslash traversal (Windows separators) ===");
  await expectRejected("backslash", [{ name: "..\\..\\OUTSIDE_MARKER.txt", content: "PWNED" }], async () =>
    check("backslash: nothing written outside dest", !fs.existsSync(outside))
  );

  console.log("\n=== symlink entry ===");
  // unix mode 0o120777 (symlink) in the high 16 bits of external attributes
  const symAttrs = (0o120777 << 16) >>> 0;
  await run(
    "symlink",
    [
      { name: "link", content: "/etc/passwd", externalAttrs: symAttrs },
      { name: "real.txt", content: "hello" },
    ],
    async ({ report, dest }) => {
      check("symlink rejected", report.rejected.some((r) => r.reason === "symlink"));
      check("no link on disk", !fs.existsSync(path.join(dest, "link")));
      check("regular file still written", fs.existsSync(path.join(dest, "real.txt")));
    }
  );

  console.log("\n=== oversized single file ===");
  {
    const zipPath = path.join(tmp, "tight.zip");
    const dest = path.join(tmp, "dest_tight");
    fs.writeFileSync(zipPath, buildZip([{ name: "huge.bin", content: "A".repeat(5000) }]));
    let error = null;
    try {
      await extractZip(zipPath, dest, { maxFileBytes: 1000 });
    } catch (err) {
      error = err;
    }
    check("per-file limit enforced", Boolean(error), error?.message);
    check("partial file cleaned up", !fs.existsSync(path.join(dest, "huge.bin")));
  }

  console.log("\n=== total size limit ===");
  {
    const zipPath = path.join(tmp, "total.zip");
    const dest = path.join(tmp, "dest_total");
    fs.writeFileSync(
      zipPath,
      buildZip([
        { name: "a.txt", content: "A".repeat(800) },
        { name: "b.txt", content: "B".repeat(800) },
        { name: "c.txt", content: "C".repeat(800) },
      ])
    );
    let error = null;
    try {
      await extractZip(zipPath, dest, { maxTotalBytes: 1500 });
    } catch (err) {
      error = err;
    }
    check("total size limit enforced", Boolean(error), error?.message);
  }

  console.log("\n=== entry count limit ===");
  {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `f${i}.txt`, content: "x" }));
    const zipPath = path.join(tmp, "many.zip");
    const dest = path.join(tmp, "dest_many");
    fs.writeFileSync(zipPath, buildZip(many));
    let error = null;
    try {
      await extractZip(zipPath, dest, { maxEntries: 10 });
    } catch (err) {
      error = err;
    }
    check("entry count limit enforced", Boolean(error), error?.message);
  }

  console.log("\n=== junk folders skipped ===");
  await run(
    "junk",
    [
      { name: "node_modules/left-pad/index.js", content: "junk" },
      { name: ".git/config", content: "junk" },
      { name: "__MACOSX/._x", content: "junk" },
      { name: ".DS_Store", content: "junk" },
      { name: "src/App.jsx", content: "real" },
    ],
    async ({ report, dest }) => {
      check("4 junk entries skipped", report.skipped.length === 4, String(report.skipped.length));
      check("only the real file written", report.files === 1);
      check("node_modules absent", !fs.existsSync(path.join(dest, "node_modules")));
      check("src/App.jsx present", fs.existsSync(path.join(dest, "src", "App.jsx")));
    }
  );

  console.log("\n=== single root folder is stripped ===");
  await run(
    "singleroot",
    [
      { name: "ecommerce/package.json", content: '{"name":"shop"}' },
      { name: "ecommerce/index.html", content: "<h1>Hi</h1>" },
      { name: "ecommerce/src/App.jsx", content: "export default () => null" },
    ],
    async ({ dest }) => {
      check("package.json lifted to root", fs.existsSync(path.join(dest, "package.json")));
      check("src/ lifted to root", fs.existsSync(path.join(dest, "src", "App.jsx")));
      check("wrapper folder gone", !fs.existsSync(path.join(dest, "ecommerce")));
    }
  );

  console.log("\n=== two roots are left alone ===");
  await run(
    "tworoots",
    [
      { name: "frontend/index.html", content: "x" },
      { name: "backend/server.js", content: "y" },
    ],
    async ({ dest }) => {
      check("frontend/ kept", fs.existsSync(path.join(dest, "frontend", "index.html")));
      check("backend/ kept", fs.existsSync(path.join(dest, "backend", "server.js")));
    }
  );

  console.log("\n=== a lone src/ is NOT flattened ===");
  await run(
    "lonesrc",
    [
      { name: "src/App.jsx", content: "export default () => null" },
      { name: "src/main.jsx", content: "import App from './App'" },
    ],
    async ({ dest }) => {
      check("src/ survives as a folder", fs.existsSync(path.join(dest, "src", "App.jsx")));
      check("App.jsx not lifted to root", !fs.existsSync(path.join(dest, "App.jsx")));
    }
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
};

main().catch((err) => {
  console.error("test harness error:", err);
  process.exit(1);
});
