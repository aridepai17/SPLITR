import { query } from "./_generated/server";
import { internal } from "./_generated/api";

// Get user balances
export const getUserBalances = query({
	handler: async (ctx) => {
		// Use the existing getCurrentUser function instead of repeating the auth logic
		const user = await ctx.runQuery(internal.users.getCurrentUser);

		/* ───────────── 1‑to‑1 expenses (no groupId) ───────────── */
		const expenses = (await ctx.db.query("expenses").collect()).filter(
			(e) =>
				!e.groupId && // 1 to 1 only
				(e.paidByUserId === user._id ||
					e.splits.some((s) => s.userId === user._id)),
		);

		/* tallies */
		let youOwe = 0;
		let youAreOwed = 0;
		const balanceByUser = {};

		for (const e of expenses) {
			const isPayer = e.paidByUserId === user._id;
			const mySplit = e.splits.find((s) => s.userId === user._id);

			if (isPayer) {
				for (const s of e.splits) {
					if (s.userId === user._id || s.paid) continue;
					youAreOwed += s.amount;
					(balanceByUser[s.userId] ??= { owed: 0, owing: 0 }).owed +=
						s.amount;
				}
			} else if (mySplit && !mySplit.paid) {
				youOwe += mySplit.amount;
				(balanceByUser[e.paidByUserId] ??= {
					owed: 0,
					owing: 0,
				}).owing += mySplit.amount;
			}
		}

		/* ───────────── 1‑to‑1 settlements (no groupId) ───────────── */
		const settlements = (
			await ctx.db.query("settlements").collect()
		).filter(
			(s) =>
				!s.groupId &&
				(s.paidByUserId === user._id ||
					s.receivedByUserId === user._id),
		);

		for (const s of settlements) {
			if (s.paidByUserId === user._id) {
				youOwe -= s.amount;
				(balanceByUser[s.receivedByUserId] ??= {
					owed: 0,
					owing: 0,
				}).owing -= s.amount;
			} else if (s.receivedByUserId === user._id) {
				youAreOwed -= s.amount;
				(balanceByUser[s.paidByUserId] ??= {
					owed: 0,
					owing: 0,
				}).owed -= s.amount;
			}
		}

		const youOweList = [];
		const youAreOwedByList = [];
		for (const [uid, { owed, owing }] of Object.entries(balanceByUser)) {
			const net = owed - owing;
			if (net === 0) continue;
			const counterpart = await ctx.db.get(uid);
			const base = {
				userId: uid,
				name: counterpart?.name ?? "Unknown",
				imageUrl: counterpart?.imageUrl,
				amount: Math.abs(net),
			};
			net > 0 ? youAreOwedByList.push(base) : youOweList.push(base);
		}

		youOweList.sort((a, b) => b.amount - a.amount);
		youAreOwedByList.sort((a, b) => b.amount - a.amount);

		return {
			youOwe,
			youAreOwed,
			totalBalance: youAreOwed - youOwe,
			oweDetails: { youOwe: youOweList, youAreOwedBy: youAreOwedByList },
		};
	},
});

// Internal shared function - single database scan for both aggregates
const fetchUserYearlySpending = async (ctx) => {
	const user = await ctx.runQuery(internal.users.getCurrentUser);

	const currentYear = new Date().getFullYear();
	const startOfYear = new Date(currentYear, 0, 1).getTime();

	// ✅ SINGLE DATABASE SCAN PER YEAR - run exactly once
	const expenses = await ctx.db
		.query("expenses")
		.withIndex("by_date", (q) => q.gte("date", startOfYear))
		.collect();

	const userExpenses = expenses.filter(
		(expense) =>
			expense.paidByUserId === user._id ||
			expense.splits.some((split) => split.userId === user._id),
	);

	let totalSpent = 0;
	const monthlyTotals = {};

	// Initialize all months with zero
	for (let i = 0; i < 12; i++) {
		const monthDate = new Date(currentYear, i, 1);
		monthlyTotals[monthDate.getTime()] = 0;
	}

	// Calculate both totals in single pass
	for (const expense of userExpenses) {
		const userSplit = expense.splits.find(s => s.userId === user._id);
		if (!userSplit) continue;

		totalSpent += userSplit.amount;

		const date = new Date(expense.date);
		const monthStart = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
		monthlyTotals[monthStart] += userSplit.amount;
	}

	const monthlyBreakdown = Object.entries(monthlyTotals)
		.map(([month, total]) => ({ month: parseInt(month), total }))
		.sort((a, b) => a.month - b.month);

	return { totalSpent, monthlyBreakdown };
};

// Get total spent in current year
export const getTotalSpent = query({
	handler: async (ctx) => {
		const { totalSpent } = await fetchUserYearlySpending(ctx);
		return totalSpent;
	},
});

// Get monthly spending
export const getMonthlySpending = query({
	handler: async (ctx) => {
		const { monthlyBreakdown } = await fetchUserYearlySpending(ctx);
		return monthlyBreakdown;
	},
});

// Get groups for the current user
export const getUserGroups = query({
	handler: async (ctx) => {
		const user = await ctx.runQuery(internal.users.getCurrentUser);

		// Lookup of groups where user is a member
		const groupMembers = await ctx.db.query("groupMembers").withIndex("by_user", q => q.eq("userId", user._id)).collect();
		const groupIds = groupMembers.map(gm => gm.groupId);
		const groups = await Promise.all(groupIds.map(id => ctx.db.get(id)));

		// Calculate balances for each group
		const enhancedGroups = await Promise.all(
			groups.map(async (group) => {
				// Get all expenses for this group
				const expenses = await ctx.db
					.query("expenses")
					.withIndex("by_group", (q) => q.eq("groupId", group._id))
					.collect();

				let balance = 0;

				expenses.forEach((expense) => {
					if (expense.paidByUserId === user._id) {
						// User paid for others
						expense.splits.forEach((split) => {
							if (split.userId !== user._id && !split.paid) {
								balance += split.amount;
							}
						});
					} else {
						// User owes someone else
						const userSplit = expense.splits.find(
							(split) => split.userId === user._id,
						);
						if (userSplit && !userSplit.paid) {
							balance -= userSplit.amount;
						}
					}
				});

				// Apply settlements
				const settlements = await ctx.db
					.query("settlements")
					.withIndex("by_group", (q) => q.eq("groupId", group._id))
					.collect();

				settlements.forEach((s) => {
					if (s.paidByUserId === user._id) {
						balance -= s.amount;
					} else if (s.receivedByUserId === user._id) {
						balance += s.amount;
					}
				});

				return {
					...group,
					balance,
				};
			}),
		);

		return enhancedGroups.sort((a, b) => b.balance - a.balance);
	},
});
