import { useEffect } from "react";
import { toast } from "sonner";

export const AUTH_TOAST_KEY = "thesisly:auth-toast";

export function AuthToastBridge() {
	useEffect(() => {
		const message = sessionStorage.getItem(AUTH_TOAST_KEY);
		if (!message) return;

		sessionStorage.removeItem(AUTH_TOAST_KEY);
		toast.success(message);
	}, []);

	return null;
}
