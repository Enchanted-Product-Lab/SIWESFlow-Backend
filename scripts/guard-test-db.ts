import "dotenv/config";

const dbUrl = process.env.DATABASE_URL || "";
const isLocal = dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");

if (!isLocal) {
  console.error("\n❌ SAFETY ERROR: Refusing to run database tests against a non-local database!");
  console.error(`DATABASE_URL is pointing to: ${dbUrl.replace(/:[^:@]+@/, ":***@")}`);
  console.error("Please point DATABASE_URL to your local dev-db (127.0.0.1:55432) before running 'npm run test:db'.\n");
  process.exit(1);
}
