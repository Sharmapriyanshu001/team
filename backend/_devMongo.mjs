/**
 * A local mongod for development, on a machine that has no MongoDB installed.
 *
 * mongodb-memory-server is already here for the test suite, where it throws
 * the database away between runs. This uses the same package the opposite
 * way: a fixed port and a fixed dbPath, so the panel's data survives a
 * restart the way a real server's would. Nothing about the app changes —
 * MONGO_URI still points at 127.0.0.1:27017.
 *
 * Development only. Run it in its own terminal, leave it running, then start
 * the API with `npm run dev`. Ctrl-C shuts mongod down cleanly.
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(here, ".mongo-data");
mkdirSync(dbPath, { recursive: true });

const mongod = await MongoMemoryServer.create({
  instance: {
    port: 27017,
    dbName: "team",
    dbPath,
    // Without this the data lives in RAM and the dbPath above is a lie.
    storageEngine: "wiredTiger",
  },
});

console.log(`✅ mongod running at ${mongod.getUri()}`);
console.log(`   data: ${dbPath}`);
console.log("   leave this terminal open; Ctrl-C to stop");

const stop = async () => {
  console.log("\n… stopping mongod");
  await mongod.stop();
  process.exit(0);
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
