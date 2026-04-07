import { query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

/**
 * Fetches user's groups with optional full member details for a specific group
 *
 * Dual purpose endpoint:
 *  - Without groupId: Returns lightweight list of all groups user belongs to
 *  - With groupId: Returns full hydrated details including member profiles
 *
 * Always performs permission checks to ensure user has access to requested resources
 */
export const getGroupOfMembers = query({
	args: {
		// Optional: When provided, returns full details for this specific group
		groupId: v.optional(v.id("groups")),
	},
	handler: async (ctx, args) => {
		// Authenticate and resolve current user
		const currentUser = await ctx.runQuery(internal.users.getCurrentUser);

		// Fetch all groups and filter to only those user is a member of
		const allGroups = await ctx.db.query("groups").collect();
		const userGroups = allGroups.filter((group) =>
			group.members.some((member) => member.userId === currentUser._id),
		);

		// When specific group is requested, hydrate full member details
		if (args.groupId) {
			// Verify access before proceeding
			const selectedGroup = userGroups.find(
				(group) => group._id === args.groupId,
			);
			if (!selectedGroup) {
				throw new Error("Group not found or you're not a member");
			}

			// Parallel fetch full user profiles for all group members
			const memberDetails = await Promise.all(
				selectedGroup.members.map(async (member) => {
					const user = await ctx.db.get(member.userId);
					// Gracefully handle deleted users without failing entire query
					if (!user) return null;

					return {
						id: user._id,
						name: user.name,
						email: user.email,
						imageUrl: user.imageUrl,
						role: member.role,
					};
				}),
			);

			// Remove references to users that have been deleted
			const validMembers = memberDetails.filter(
				(member) => member !== null,
			);

			// Return both selected group details AND full group list for sidebar navigation
			return {
				selectedGroup: {
					id: selectedGroup._id,
					name: selectedGroup.name,
					description: selectedGroup.description,
					createdBy: selectedGroup.createdBy,
					members: validMembers,
				},
				groups: userGroups.map((group) => ({
					id: group._id,
					name: group.name,
					description: group.description,
					memberCount: group.members.length,
				})),
			};
		} else {
			// Return lightweight list only - skip expensive member hydration
			return {
				selectedGroup: null,
				groups: userGroups.map((group) => ({
					id: group._id,
					name: group.name,
					description: group.description,
					memberCount: group.members.length,
				})),
			};
		}
	},
});

/**
 * Calculates complete expense ledger and balances for a group
 *
 * This is the core expense reconciliation engine. Performs:
 *  - Permission validation
 *  - Fetches all expenses and settlements for the group
 *  - Builds pairwise debt ledger between every user pair
 *  - Calculates net balances per user
 *  - Resolves mutual debts to prevent circular obligations
 *  - Returns fully shaped balance view with user references
 */
export const getGroupExpenses = query({
	args: { groupId: v.id("groups") },
	handler: async (ctx, { groupId }) => {
		const currentUser = await ctx.runQuery(internal.users.getCurrentUser);

		// Validate group exists and user has access
		const group = await ctx.db.get(groupId);
		if (!group) throw new Error("Group not found");
		if (!group.members.some((m) => m.userId === currentUser._id)) {
			throw new Error("You are not a member of this group");
		}

		// Load all transaction data for the group
		const expenses = await ctx.db
			.query("expenses")
			.withIndex("by_group", (q) => q.eq("groupId", groupId))
			.collect();

		const settlements = await ctx.db
			.query("settlements")
			.filter((q) => q.eq(q.field("groupId"), groupId))
			.collect();

		// Preload member profiles for all users in this group
		const memberDetails = await Promise.all(
			group.members.map(async (m) => {
				const u = await ctx.db.get(m.userId);
				return {
					id: u._id,
					name: u.name,
					imageUrl: u.imageUrl,
					role: m.role,
				};
			}),
		);
		const memberIds = memberDetails.map((m) => m.id);

		/* ──────────────────────────────────────────────────────────────────────────
            BALANCE CALCULATION ENGINE
		────────────────────────────────────────────────────────────────────────── */

		// Running total net balance per user (positive = owed money, negative = owes money)
		const netTotals = Object.fromEntries(memberIds.map((id) => [id, 0]));

		// Pairwise debt matrix: ledger[debtor][creditor] = amount owed
		// This tracks every obligation between every pair of users
		const pairwiseLedger = Object.fromEntries(
			memberIds.map((a) => [
				a,
				Object.fromEntries(
					memberIds.filter((b) => a !== b).map((b) => [b, 0]),
				),
			]),
		);

		// First pass: Apply all expenses to the ledger
		for (const expense of expenses) {
			const payer = expense.paidByUserId;
			for (const split of expense.splits) {
				// Skip the person who paid, they are owed money not owing
				// Also skip splits that have already been settled
				if (split.userId === payer || split.paid) continue;

				const debtor = split.userId;
				const amount = split.amount;

				// Update running totals
				netTotals[payer] += amount;
				netTotals[debtor] -= amount;

				// Record pairwise obligation
				pairwiseLedger[debtor][payer] += amount;
			}
		}

		// Second pass: Apply all settlements to reduce outstanding debts
		for (const settlement of settlements) {
			netTotals[settlement.paidByUserId] += settlement.amount;
			netTotals[settlement.receivedByUserId] -= settlement.amount;

			// Reduce the obligation from payer to receiver
			pairwiseLedger[settlement.paidByUserId][
				settlement.receivedByUserId
			] -= settlement.amount;
		}

		/* ──────────────────────────────────────────────────────────────────────────
		   MUTUAL DEBT NETTING
		   
		   Resolve circular obligations:
		   If A owes B $10 and B owes A $3 → net result: A owes B $7
		   This eliminates redundant debt tracking and simplifies optimal settlement
		────────────────────────────────────────────────────────────────────────── */
		for (let i = 0; i < memberIds.length; i++) {
			for (let j = i + 1; j < memberIds.length; j++) {
				const a = memberIds[i];
				const b = memberIds[j];

				// Calculate net obligation between the pair
				const netObligation =
					pairwiseLedger[a][b] - pairwiseLedger[b][a];

				if (netObligation > 0) {
					// A owes B net amount
					pairwiseLedger[a][b] = netObligation;
					pairwiseLedger[b][a] = 0;
				} else if (netObligation < 0) {
					// B owes A net amount
					pairwiseLedger[b][a] = -netObligation;
					pairwiseLedger[a][b] = 0;
				} else {
					// Exact balance - clear both entries
					pairwiseLedger[a][b] = 0;
					pairwiseLedger[b][a] = 0;
				}
			}
		}

		/* ──────────────────────────────────────────────────────────────────────────
		   RESPONSE SHAPING
		────────────────────────────────────────────────────────────────────────── */

		// Build per-user balance view with who they owe and who owes them
		const balances = memberDetails.map((member) => ({
			...member,
			totalBalance: netTotals[member.id],
			owes: Object.entries(pairwiseLedger[member.id])
				.filter(([, amount]) => amount > 0)
				.map(([toUserId, amount]) => ({ to: toUserId, amount })),
			owedBy: memberIds
				.filter(
					(otherUserId) => pairwiseLedger[otherUserId][member.id] > 0,
				)
				.map((fromUserId) => ({
					from: fromUserId,
					amount: pairwiseLedger[fromUserId][member.id],
				})),
		}));

		// Lookup map for efficient user reference resolution on client
		const userLookupMap = Object.fromEntries(
			memberDetails.map((member) => [member.id, member]),
		);

		return {
			group: {
				id: group._id,
				name: group.name,
				description: group.description,
			},
			members: memberDetails,
			expenses,
			settlements,
			balances,
			userLookupMap,
		};
	},
});
