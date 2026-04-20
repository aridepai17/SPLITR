"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export function SplitSelector({
	type,
	amount,
	participants,
	paidByUserId,
	onSplitsChange,
}) {
	const { user } = useUser();
	const [splits, setSplits] = useState([]);
	const [totalPercentage, setTotalPercentage] = useState(0);
	const [totalAmount, setTotalAmount] = useState(0);

	// Calculate splits when inputs change
	useEffect(() => {
		if (!amount || amount <= 0 || participants.length === 0) {
			return;
		}

		let newSplits = [];

		if (type === "equal") {
			const shareAmount = amount / participants.length;
			newSplits = participants.map((participant) => ({
				userId: participant.id,
				name: participant.name,
				email: participant.email,
				imageUrl: participant.imageUrl,
				amount: shareAmount,
				percentage: 100 / participants.length,
				paid: participant.id === paidByUserId,
			}));
		} else if (type === "percentage") {
			const evenPercentage = 100 / participants.length;
			newSplits = participants.map((participant) => ({
				userId: participant.id,
				name: participant.name,
				email: participant.email,
				imageUrl: participant.imageUrl,
				amount: (amount * evenPercentage) / 100,
				percentage: evenPercentage,
				paid: participant.id === paidByUserId,
			}));
		} else if (type === "exact") {
			const evenAmount = amount / participants.length;
			newSplits = participants.map((participant) => ({
				userId: participant.id,
				name: participant.name,
				email: participant.email,
				imageUrl: participant.imageUrl,
				amount: evenAmount,
				percentage: (evenAmount / amount) * 100,
				paid: participant.id === paidByUserId,
			}));
		}

		setSplits(newSplits);

		const newTotalAmount = newSplits.reduce(
			(sum, split) => sum + split.amount,
			0,
		);
		const newTotalPercentage = newSplits.reduce(
			(sum, split) => sum + split.percentage,
			0,
		);

		setTotalAmount(newTotalAmount);
		setTotalPercentage(newTotalPercentage);

		if (onSplitsChange) {
			onSplitsChange(newSplits);
		}
	}, [type, amount, participants, paidByUserId, onSplitsChange]);

	const updatePercentageSplit = (userId, newPercentage) => {
		const updatedSplits = splits.map((split) => {
			if (split.userId === userId) {
				return {
					...split,
					percentage: newPercentage,
					amount: (amount * newPercentage) / 100,
				};
			}
			return split;
		});

		setSplits(updatedSplits);
		setTotalAmount(
			updatedSplits.reduce((sum, split) => sum + split.amount, 0),
		);
		setTotalPercentage(
			updatedSplits.reduce((sum, split) => sum + split.percentage, 0),
		);

		if (onSplitsChange) {
			onSplitsChange(updatedSplits);
		}
	};

	const updateExactSplit = (userId, newAmount) => {
		// Handle empty string gracefully so backspacing works
		const parsedAmount = newAmount === "" ? 0 : parseFloat(newAmount);

		const updatedSplits = splits.map((split) => {
			if (split.userId === userId) {
				return {
					...split,
					amount: parsedAmount,
					percentage: amount > 0 ? (parsedAmount / amount) * 100 : 0,
				};
			}
			return split;
		});

		setSplits(updatedSplits);
		setTotalAmount(
			updatedSplits.reduce((sum, split) => sum + split.amount, 0),
		);
		setTotalPercentage(
			updatedSplits.reduce((sum, split) => sum + split.percentage, 0),
		);

		if (onSplitsChange) {
			onSplitsChange(updatedSplits);
		}
	};

	const isPercentageValid = Math.abs(totalPercentage - 100) < 0.01;
	const isAmountValid = Math.abs(totalAmount - amount) < 0.01;

	return (
		<div className="space-y-4 mt-4">
			{/* Participants List wrapped in a clean card */}
			<div className="border rounded-xl divide-y bg-card overflow-hidden shadow-sm">
				{splits.map((split) => (
					<div
						key={split.userId}
						className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 hover:bg-muted/30 transition-colors"
					>
						{/* Avatar & Name */}
						<div className="flex items-center gap-3 min-w-[140px]">
							<Avatar className="h-9 w-9 border shadow-sm">
								<AvatarImage src={split.imageUrl} />
								<AvatarFallback className="bg-emerald-100 text-emerald-700 font-semibold">
									{split.name?.charAt(0) || "?"}
								</AvatarFallback>
							</Avatar>
							<div className="flex flex-col">
								<span className="text-sm font-semibold truncate max-w-[120px]">
									{split.userId === user?.id
										? "You"
										: split.name}
								</span>
								{split.paid && (
									<span className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider">
										Paying
									</span>
								)}
							</div>
						</div>

						{/* Equal Split Display */}
						{type === "equal" && (
							<div className="text-right text-sm font-medium text-muted-foreground tabular-nums">
								${split.amount.toFixed(2)} (
								{split.percentage.toFixed(1)}%)
							</div>
						)}

						{/* Percentage Split Display */}
						{type === "percentage" && (
							<div className="flex items-center gap-4 flex-1 w-full">
								<Slider
									value={[split.percentage]}
									min={0}
									max={100}
									step={1}
									onValueChange={(values) =>
										updatePercentageSplit(
											split.userId,
											values[0],
										)
									}
									className="hidden sm:flex flex-1"
								/>
								<div className="flex gap-3 items-center ml-auto">
									<div className="relative flex items-center">
										<Input
											type="number"
											min="0"
											max="100"
											value={
												split.percentage === 0
													? ""
													: split.percentage
											} // Removes .toFixed() so typing works
											onChange={(e) =>
												updatePercentageSplit(
													split.userId,
													e.target.value === ""
														? 0
														: parseFloat(
																e.target.value,
															),
												)
											}
											className="w-20 pl-3 pr-7 text-right h-9 font-medium"
										/>
										<span className="absolute right-3 text-sm text-muted-foreground pointer-events-none">
											%
										</span>
									</div>
									<span className="text-sm text-muted-foreground font-medium w-16 text-right tabular-nums">
										${split.amount.toFixed(2)}
									</span>
								</div>
							</div>
						)}

						{/* Exact Amount Split Display */}
						{type === "exact" && (
							<div className="flex items-center gap-3 ml-auto">
								<span className="text-sm text-muted-foreground w-12 text-right">
									({split.percentage.toFixed(1)}%)
								</span>
								<div className="relative flex items-center">
									<span className="absolute left-3 text-sm text-muted-foreground pointer-events-none">
										$
									</span>
									<Input
										type="number"
										min="0"
										step="0.01"
										value={
											split.amount === 0
												? ""
												: split.amount
										} // Allows easy backspacing
										onChange={(e) =>
											updateExactSplit(
												split.userId,
												e.target.value,
											)
										}
										className="w-24 pl-7 pr-3 text-right h-9 font-medium"
									/>
								</div>
							</div>
						)}
					</div>
				))}

				{/* Validation Footer */}
				{type !== "equal" && (
					<div className="bg-muted/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between text-sm gap-2">
						<span className="font-medium text-muted-foreground">
							Total Allocated:
						</span>

						<div className="flex flex-col items-end">
							<span
								className={cn(
									"font-bold tabular-nums",
									(
										type === "exact"
											? isAmountValid
											: isPercentageValid
									)
										? "text-emerald-600"
										: "text-destructive",
								)}
							>
								${totalAmount.toFixed(2)}
								{type === "percentage" &&
									` (${totalPercentage.toFixed(1)}%)`}
							</span>

							{/* Warnings */}
							{type === "percentage" && !isPercentageValid && (
								<span className="text-[11px] text-destructive font-medium mt-0.5">
									Percentages must equal 100%
								</span>
							)}
							{type === "exact" && !isAmountValid && (
								<span className="text-[11px] text-destructive font-medium mt-0.5">
									Must equal total amount ($
									{amount.toFixed(2)})
								</span>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
