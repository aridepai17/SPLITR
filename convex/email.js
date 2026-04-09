import { v } from "convex/values";
import { action } from "./_generated/server";
import { Resend } from "resend";

// Action to send email using Resend
export const sendEmail = action({
	args: {
		to: v.string(),
		subject: v.string(),
		html: v.string(),
		text: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const apiKey = process.env.RESEND_API_KEY;
		if (!apiKey) {
			throw new Error("RESEND_API_KEY environment variable is not configured");
		}

		const fromEmail = process.env.RESEND_FROM_EMAIL;
		if (!fromEmail) {
			throw new Error("RESEND_FROM_EMAIL environment variable is not configured");
		}

		// Basic email validation
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(fromEmail)) {
			throw new Error("RESEND_FROM_EMAIL is not a valid email address");
		}

		const resend = new Resend(apiKey);

		try {
			const result = await resend.emails.send({
				from: `Splitr <${fromEmail}>`,
				to: args.to,
				subject: args.subject,
				html: args.html,
				text: args.text,
			});

			if (result.error) {
				return { success: false, error: result.error };
			}

			return { success: true, id: result.data.id };
		} catch (error) {
			return { success: false, error: error.message };
		}
	},
});
