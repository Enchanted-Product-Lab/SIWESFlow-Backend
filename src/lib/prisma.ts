import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

declare global {
  var __prisma: PrismaClient | undefined;
}

const rawConnectionString = process.env.DATABASE_URL;
const isRemote =
  !!rawConnectionString &&
  !rawConnectionString.includes("127.0.0.1") &&
  !rawConnectionString.includes("localhost");

// Strip sslmode from the URL when remote so that pg's ssl options ({ rejectUnauthorized: false }) take precedence
const connectionString = isRemote && rawConnectionString
  ? rawConnectionString.replace(/([?&])sslmode=[^&]+(&|$)/, "$1").replace(/[?&]$/, "")
  : rawConnectionString;

const pool = new Pool({
  connectionString,
  ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}),
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle database client:", err);
});

const adapter = new PrismaPg(pool);

export const prisma = global.__prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}