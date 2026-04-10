"use client";

import { useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Component for selecting how to split an expense among participants
 *
 * Supports three split types:
 * - equal: Split equally among all participants
 * - percentage: Split by percentage
 * - exact: Split by exact amounts
 */
export function SplitSelector({
	type,
	amount,
	participants,
	paidByUserId,
	splits,
	onSplitChange,
}) {
	useEffect(() => {
		if (!participants.length || !amount) {
			onSplitChange([]);
			return;
		}

		let newSplits = [];

		switch (type) {
			case "equal": {
				// Split equally among all participants
				const equalAmount = amount / participants.length;
				newSplits = participants.map((participant) => ({
					userId: participant.id,
					amount: equalAmount,
					name: participant.name,
				}));
				break;
			}

			case "percentage": {
				// Initialize with equal percentages
				const equalPercentage = 100 / participants.length;
				newSplits = participants.map((participant) => ({
					userId: participant.id,
					amount: (amount * equalPercentage) / 100,
					percentage: equalPercentage,
					name: participant.name,
				}));
				break;
			}

			case "exact":
				// Initialize with zero amounts for manual entry
				newSplits = participants.map((participant) => ({
					userId: participant.id,
					amount: 0,
					name: participant.name,
				}));
				break;

			default:
				newSplits = [];
		}

		onSplitChange(newSplits);
	}, [type, amount, participants, onSplitChange]);

	const handleSplitChange = (userId, value) => {
		const updatedSplits = splits.map((split) => {
			if (split.userId === userId) {
				if (type === "percentage") {
					const percentage = parseFloat(value) || 0;
					return {
						...split,
						amount: (amount * percentage) / 100,
						percentage,
					};
				} else {
					return {
						...split,
						amount: parseFloat(value) || 0,
					};
				}
			}
			return split;
		});

		onSplitChange(updatedSplits);
	};

	return (
		<div className="space-y-3">
			{participants.map((participant) => (
				<div key={participant.id} className="flex items-center space-x-3">
					<div className="flex-1">
						<Label className="text-sm font-medium">
							{participant.id === paidByUserId
								? `${participant.name} (paid)`
								: participant.name}
						</Label>
					</div>
					<div className="w-24">
						<Input
							type="number"
							step={type === "percentage" ? "1" : "0.01"}
							min="0"
							max={type === "percentage" ? "100" : undefined}
							value={
								type === "percentage"
									? splits.find((s) => s.userId === participant.id)?.percentage || 0
									: splits.find((s) => s.userId === participant.id)?.amount || 0
							}
							onChange={(e) => handleSplitChange(participant.id, e.target.value)}
							placeholder={type === "percentage" ? "%" : "$"}
						/>
					</div>
					<div className="text-sm text-muted-foreground w-16">
						{type === "percentage" ? "%" : "$"}
						{splits
							.find((s) => s.userId === participant.id)
							?.amount?.toFixed(2)}
					</div>
				</div>
			))}
		</div>
	);
}