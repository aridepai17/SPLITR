import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

/**
 * Create a new expense record
 *
 * Validates all inputs, performs permission checks, and ensures split amounts
 * correctly sum to the total expense amount. Works for both 1:1 expenses and
 * group expenses.
 */
export const createExpense = mutation({
	args: {
		description: v.string(),
		amount: v.number(),
		category: v.optional(v.string()),
		date: v.number(), // Unix timestamp in milliseconds
		paidByUserId: v.id("users"),
		splitType: v.string(), // "equal", "percentage", "exact"
		splits: v.array(
			v.object({
				userId: v.id("users"),
				amount: v.number(),
				paid: v.boolean(),
			}),
		),
		groupId: v.optional(v.id("groups")),
	},
	handler: async (ctx, args) => {
		const user = await ctx.runQuery(internal.users.getCurrentUser);

		// For 1:1 expenses, validate that referenced users exist
		if (!args.groupId) {
			const payer = await ctx.db.get(args.paidByUserId);
			if (!payer) {
				throw new Error("Payer not found");
			}
			for (const split of args.splits) {
				const splitUser = await ctx.db.get(split.userId);
				if (!splitUser) {
					throw new Error(`User ${split.userId} in splits not found`);
				}
			}
		}

		// Validate group membership if this expense belongs to a group
		if (args.groupId) {
			const group = await ctx.db.get(args.groupId);
			if (!group) {
				throw new Error("Group not found");
			}

			const isMember = group.members.some(
				(member) => member.userId === user._id,
			);
			if (!isMember) {
				throw new Error("You are not a member of this group");
			}

			// Verify payer is a valid group member
			const payerIsMember = group.members.some(
				(m) => m.userId === args.paidByUserId,
			);
			if (!payerIsMember) {
				throw new Error(
					`User ${args.paidByUserId} is not a member of this group`,
				);
			}

			// Verify every user listed in splits is a valid group member
			for (const split of args.splits) {
				const splitUserIsMember = group.members.some(
					(m) => m.userId === split.userId,
				);
				if (!splitUserIsMember) {
					throw new Error(
						`User ${split.userId} in splits is not a member of this group`,
					);
				}
			}
		}

		// Verify split integrity: sum of all splits must equal total amount
		// Allow 0.01 tolerance for floating point precision errors
		const totalSplitAmount = args.splits.reduce(
			(sum, split) => sum + split.amount,
			0,
		);
		const tolerance = 0.01;
		if (Math.abs(totalSplitAmount - args.amount) > tolerance) {
			throw new Error(
				"Split amounts must add up to the total expense amount",
			);
		}

		// Create and persist the expense record
		const expenseId = await ctx.db.insert("expenses", {
			description: args.description,
			amount: args.amount,
			category: args.category || "Other",
			date: args.date,
			paidByUserId: args.paidByUserId,
			splitType: args.splitType,
			splits: args.splits,
			groupId: args.groupId,
			createdBy: user._id,
		});

		return expenseId;
	},
});

/**
 * Get complete transaction history and running balance between two users
 *
 * Calculates the exact running balance between current user and specified user.
 * Includes all 1:1 expenses, individual payments, and settlements. This is the
 * single source of truth for all direct user-to-user financial obligations.
 *
 * Algorithm:
 * 1. Fetch all expenses either user has paid for
 * 2. Filter to only expenses where both users are participants
 * 3. Fetch all settlement transactions between the two users
 * 4. Calculate net running balance
 */
export const getExpensesBetweenUsers = query({
	args: { userId: v.id("users") },
	handler: async (ctx, { userId }) => {
		const me = await ctx.runQuery(internal.users.getCurrentUser);
		if (me._id === userId) throw new Error("Cannot query yourself");

		/* ──────────────────────────────────────────────────────────────────────────
		   Step 1: Fetch candidate expense set using compound indexes
		   
		   We use the existing (paidByUserId, groupId) index to efficiently fetch
		   only expenses that either user has paid for. This avoids full table scans.
		────────────────────────────────────────────────────────────────────────── */
		const myPaid = await ctx.db
			.query("expenses")
			.withIndex("by_user_and_group", (q) =>
				q.eq("paidByUserId", me._id).eq("groupId", undefined),
			)
			.collect();

		const theirPaid = await ctx.db
			.query("expenses")
			.withIndex("by_user_and_group", (q) =>
				q.eq("paidByUserId", userId).eq("groupId", undefined),
			)
			.collect();

		const candidateExpenses = [...myPaid, ...theirPaid];

		/* ──────────────────────────────────────────────────────────────────────────
		   Step 2: Filter to only expenses where BOTH users are involved
		   
		   An expense qualifies if both users are either the payer or appear in
		   the split list.
		────────────────────────────────────────────────────────────────────────── */
		const expenses = candidateExpenses.filter((e) => {
			const meInSplits = e.splits.some((s) => s.userId === me._id);
			const themInSplits = e.splits.some((s) => s.userId === userId);

			const meInvolved = e.paidByUserId === me._id || meInSplits;
			const themInvolved = e.paidByUserId === userId || themInSplits;

			return meInvolved && themInvolved;
		});

		expenses.sort((a, b) => b.date - a.date);

		/* ──────────────────────────────────────────────────────────────────────────
		   Step 3: Fetch all settlement transactions between these two users
		────────────────────────────────────────────────────────────────────────── */
		const settlements = await ctx.db
			.query("settlements")
			.filter((q) =>
				q.and(
					q.eq(q.field("groupId"), undefined),
					q.or(
						q.and(
							q.eq(q.field("paidByUserId"), me._id),
							q.eq(q.field("receivedByUserId"), userId),
						),
						q.and(
							q.eq(q.field("paidByUserId"), userId),
							q.eq(q.field("receivedByUserId"), me._id),
						),
					),
				),
			)
			.collect();

		settlements.sort((a, b) => b.date - a.date);

		/* ──────────────────────────────────────────────────────────────────────────
		   Step 4: Calculate running net balance
		   
		   Positive balance = other user owes current user
		   Negative balance = current user owes other user
		────────────────────────────────────────────────────────────────────────── */
		let balance = 0;

		for (const e of expenses) {
			if (e.paidByUserId === me._id) {
				const split = e.splits.find(
					(s) => s.userId === userId && !s.paid,
				);
				if (split) balance += split.amount;
			} else {
				const split = e.splits.find(
					(s) => s.userId === me._id && !s.paid,
				);
				if (split) balance -= split.amount;
			}
		}

		for (const s of settlements) {
			if (s.paidByUserId === me._id) balance += s.amount;
			else balance -= s.amount;
		}

		/* ──────────────────────────────────────────────────────────────────────────
		   Step 5: Build response payload
		────────────────────────────────────────────────────────────────────────── */
		const other = await ctx.db.get(userId);
		if (!other) throw new Error("User not found");

		return {
			expenses,
			settlements,
			otherUser: {
				id: other._id,
				name: other.name,
				email: other.email,
				imageUrl: other.imageUrl,
			},
			balance,
		};
	},
});

/**
 * Delete an expense and update related settlements
 *
 * Permission checks: Only expense creator or payer may delete
 *
 * When an expense is deleted:
 * 1. All settlements referencing this expense are found
 * 2. The expense is removed from their relatedExpenseIds list
 * 3. If settlement now has zero referenced expenses, it is deleted
 *
 * This maintains referential integrity when expenses are removed.
 */
export const deleteExpense = mutation({
	args: {
		expenseId: v.id("expenses"),
	},
	handler: async (ctx, args) => {
		const user = await ctx.runQuery(internal.users.getCurrentUser);

		// Validate expense exists and user has permission to delete
		const expense = await ctx.db.get(args.expenseId);
		if (!expense) {
			throw new Error("Expense not found");
		}

		if (
			expense.createdBy !== user._id &&
			expense.paidByUserId !== user._id
		) {
			throw new Error("You don't have permission to delete this expense");
		}

		// For group expenses, also verify user is still a member
		if (expense.groupId) {
			const group = await ctx.db.get(expense.groupId);
			if (group && !group.members.some((m) => m.userId === user._id)) {
				throw new Error("You are no longer a member of this group");
			}
		}

		// Find all settlements that reference this expense
		// Note: Convex cannot filter on array contains so we filter in memory
		const allSettlements = await ctx.db.query("settlements").collect();

		const relatedSettlements = allSettlements.filter(
			(settlement) =>
				settlement.relatedExpenseIds !== undefined &&
				settlement.relatedExpenseIds.includes(args.expenseId),
		);

		// Update or delete settlements that referenced this expense
		for (const settlement of relatedSettlements) {
			const updatedRelatedExpenseIds =
				settlement.relatedExpenseIds.filter(
					(id) => id !== args.expenseId,
				);

			if (updatedRelatedExpenseIds.length === 0) {
				// Settlement was only for this expense - delete it entirely
				await ctx.db.delete(settlement._id);
			} else {
				// Remove this expense from the settlement's reference list
				await ctx.db.patch(settlement._id, {
					relatedExpenseIds: updatedRelatedExpenseIds,
				});
			}
		}

		// Finally delete the expense itself
		await ctx.db.delete(args.expenseId);

		return { success: true };
	},
});
