import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { username } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "../db";
import * as schema from "../db/schema";

export const PASSWORD_REQUIREMENTS =
	/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])\S{8,128}$/;

export const MATRIC_NUMBER_PATTERN = /^[A-Za-z]{3}\/\d{4}\/\d{3}$/;

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		schema,
	}),
	emailAndPassword: {
		enabled: true,
		minPasswordLength: 8,
		maxPasswordLength: 128,
		autoSignIn: true,
	},
	user: {
		additionalFields: {
			firstName: {
				type: "string",
				required: true,
			},
			lastName: {
				type: "string",
				required: true,
			},
			department: {
				type: "string",
				required: true,
			},
		},
	},
	hooks: {
		before: createAuthMiddleware(async (context) => {
			if (context.path !== "/sign-up/email") return;

			const password = context.body?.password;
			const requiredProfileFields = [
				context.body?.firstName,
				context.body?.lastName,
				context.body?.department,
			];
			if (
				requiredProfileFields.some(
					(value) => typeof value !== "string" || value.trim().length === 0,
				)
			) {
				throw new APIError("BAD_REQUEST", {
					message: "First name, last name, and department are required.",
				});
			}
			if (
				typeof password !== "string" ||
				!PASSWORD_REQUIREMENTS.test(password)
			) {
				throw new APIError("BAD_REQUEST", {
					message:
						"Password must be 8–128 characters and include uppercase, lowercase, a number, and a special character.",
				});
			}
		}),
	},
	plugins: [
		username({
			minUsernameLength: 12,
			maxUsernameLength: 12,
			usernameValidator: (value) => MATRIC_NUMBER_PATTERN.test(value.trim()),
			usernameNormalization: (value) => value.trim().toLowerCase(),
			displayUsernameNormalization: (value) => value.trim().toUpperCase(),
			immutableUsername: true,
		}),
		tanstackStartCookies(),
	],
});
