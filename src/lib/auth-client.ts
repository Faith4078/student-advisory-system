import { createAuthClient } from "better-auth/react";
import {
	inferAdditionalFields,
	usernameClient,
} from "better-auth/client/plugins";
import type { auth } from "./auth";

export const authClient = createAuthClient({
	plugins: [usernameClient(), inferAdditionalFields<typeof auth>()],
});
