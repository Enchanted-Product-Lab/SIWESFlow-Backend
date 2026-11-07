// Local development database: a real Postgres cluster managed by the repo, so
// integration work does not depend on Docker or a system install.
//
//   npx tsx scripts/dev-db.ts start
//   npx tsx scripts/dev-db.ts start --foreground
//
// Kept out of src/ on purpose: nothing here ships with the API.
import EmbeddedPostgres from "embedded-postgres";

const DATA_DIR = ".pgdata";
const PORT = Number(process.env.DEV_DB_PORT ?? 55432);
const DATABASE = "siwesflow";

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  port: PORT,
  user: "postgres",
  password: "postgres",
  persistent: true,
  // Windows initdb can fault while resolving the system locale; pinning C/UTF8
  // keeps the cluster deterministic across machines.
  initdbFlags: ["--locale=C", "--encoding=UTF8"],
  onLog: () => {},
  onError: (err) => console.error("[dev-db]", err),
});

async function main() {
  const command = process.argv[2] ?? "start";

  if (command === "stop") {
    await pg.stop();
    console.log("dev-db stopped");
    return;
  }

  const { existsSync } = await import("node:fs");
  if (!existsSync(`${DATA_DIR}/PG_VERSION`)) {
    console.log("initialising cluster in", DATA_DIR);
    await pg.initialise();
  }

  await pg.start();
  console.log(`dev-db listening on 127.0.0.1:${PORT}`);

  try {
    await pg.createDatabase(DATABASE);
    console.log(`database "${DATABASE}" created`);
  } catch {
    console.log(`database "${DATABASE}" already present`);
  }

  console.log(
    `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/${DATABASE}?schema=public"`,
  );

  if (process.argv.includes("--foreground")) {
    // Hold the process open; Ctrl+C stops the cluster.
    setInterval(() => {}, 1 << 30);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
