import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
	process.env.DATABASE_URL_POOLED ||
	process.env.DATABASE_URL ||
	"postgres://invalid:invalid@127.0.0.1:5432/student_advisory";

const client = postgres(connectionString, {
	max: 10,
	prepare: false,
});

export const db = drizzle(client, { schema });
