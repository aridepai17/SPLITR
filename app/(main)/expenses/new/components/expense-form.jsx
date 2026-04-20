"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { api } from "@/convex/_generated/api";
import { useConvexMutation, useConvexQuery } from "@/hooks/use-convex-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ParticipantSelector } from "./participant-selector";
import { GroupSelector } from "./group-selector";
import { CategorySelector } from "./category-selector";
import { SplitSelector } from "./split-selector";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CalendarIcon } from "lucide-react";
import { getAllCategories } from "@/lib/expense-categories";

// Form schema validation
const expenseSchema = z.object({
	description: z.string().min(1, "Description is required"),
	amount: z
		.string()
		.min(1, "Amount is required")
		.refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
			message: "Amount must be a positive number",
		}),
	category: z.string().optional(),
	date: z.date(),
	paidByUserId: z.string().min(1, "Payer is required"),
	splitType: z.enum(["equal", "percentage", "exact"]),
	groupId: z.string().optional(),
});

export function ExpenseForm({ type = "individual", onSuccess }) {
	const [participants, setParticipants] = useState([]);
	const [selectedDate, setSelectedDate] = useState(new Date());
	const [selectedGroup, setSelectedGroup] = useState(null);
	const [splits, setSplits] = useState([]);

	const { data: currentUser } = useConvexQuery(api.users.getCurrentUser);
	const createExpense = useConvexMutation(api.expenses.createExpense);
	const categories = getAllCategories();

	const {
		register,
		handleSubmit,
		setValue,
		watch,
		reset,
		formState: { errors, isSubmitting },
	} = useForm({
		resolver: zodResolver(expenseSchema),
		defaultValues: {
			description: "",
			amount: "",
			category: "",
			date: new Date(),
			paidByUserId: currentUser?._id || "",
			splitType: "equal",
			groupId: undefined,
		},
	});

	const amountValue = watch("amount");
	const paidByUserId = watch("paidByUserId");

	useEffect(() => {
		if (participants.length === 0 && currentUser) {
			setParticipants([
				{
					id: currentUser._id,
					name: currentUser.name,
					email: currentUser.email,
					imageUrl: currentUser.imageUrl,
				},
			]);
		}
	}, [currentUser, participants]);

	const onSubmit = async (data) => {
		try {
			const amount = parseFloat(data.amount);
			const formattedSplits = splits.map((split) => ({
				userId: split.userId,
				amount: split.amount,
				paid: split.userId === data.paidByUserId,
			}));

			const totalSplitAmount = formattedSplits.reduce(
				(sum, split) => sum + split.amount,
				0,
			);
			const tolerance = 0.01;

			if (Math.abs(totalSplitAmount - amount) > tolerance) {
				toast.error(
					`Split amounts don't add up to the total. Please adjust your splits.`,
				);
				return;
			}

			const groupId = type === "individual" ? undefined : data.groupId;

			await createExpense.mutate({
				description: data.description,
				amount: amount,
				category: data.category || "Other",
				date: data.date.getTime(),
				paidByUserId: data.paidByUserId,
				splitType: data.splitType,
				splits: formattedSplits,
				groupId,
			});

			toast.success("Expense created successfully!");
			reset();

			const otherParticipant = participants.find(
				(p) => p.id !== currentUser._id,
			);
			const otherUserId = otherParticipant?.id;

			if (onSuccess)
				onSuccess(type === "individual" ? otherUserId : groupId);
		} catch (error) {
			toast.error("Failed to create expense: " + error.message);
		}
	};

	if (!currentUser) return null;

	return (
		<form
			onSubmit={handleSubmit(onSubmit)}
			className="space-y-8 w-full block"
		>
			<div className="space-y-6 w-full block">
				{/* Description and amount */}
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
					<div className="space-y-3 w-full block">
						<Label
							htmlFor="description"
							className="font-medium text-foreground"
						>
							Description
						</Label>
						<Input
							id="description"
							placeholder="Lunch, movie tickets, etc."
							className="h-10 w-full"
							{...register("description")}
						/>
						{errors.description && (
							<p className="text-sm text-destructive">
								{errors.description.message}
							</p>
						)}
					</div>

					<div className="space-y-3 w-full block">
						<Label
							htmlFor="amount"
							className="font-medium text-foreground"
						>
							Amount
						</Label>
						<Input
							id="amount"
							placeholder="0.00"
							type="number"
							step="0.01"
							min="0.01"
							className="h-10 w-full"
							{...register("amount")}
						/>
						{errors.amount && (
							<p className="text-sm text-destructive">
								{errors.amount.message}
							</p>
						)}
					</div>
				</div>

				{/* Category and date */}
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
					<div className="space-y-3 w-full block">
						<Label
							htmlFor="category"
							className="font-medium text-foreground"
						>
							Category
						</Label>
						<CategorySelector
							categories={categories || []}
							onChange={(categoryId) => {
								setValue("category", categoryId || "");
							}}
						/>
					</div>

					<div className="space-y-3 w-full block">
						<Label className="font-medium text-foreground">
							Date
						</Label>
						<Popover>
							<PopoverTrigger asChild>
								<Button
									variant="outline"
									className={cn(
										"w-full h-10 justify-start text-left font-normal",
										!selectedDate &&
											"text-muted-foreground",
									)}
								>
									<CalendarIcon className="mr-2 h-4 w-4" />
									{selectedDate ? (
										format(selectedDate, "PPP")
									) : (
										<span>Pick a date</span>
									)}
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-auto p-0 block">
								<Calendar
									mode="single"
									selected={selectedDate}
									onSelect={(date) => {
										setSelectedDate(date);
										setValue("date", date);
									}}
									initialFocus
								/>
							</PopoverContent>
						</Popover>
					</div>
				</div>
			</div>

			{/* Group selector */}
			{type === "group" && (
				<div className="space-y-3 w-full block">
					<Label className="font-medium text-foreground">Group</Label>
					<GroupSelector
						onChange={(group) => {
							if (
								!selectedGroup ||
								selectedGroup.id !== group.id
							) {
								setSelectedGroup(group);
								setValue("groupId", group.id);
								if (
									group.members &&
									Array.isArray(group.members)
								) {
									setParticipants(group.members);
								}
							}
						}}
					/>
					{!selectedGroup && (
						<p className="text-xs text-amber-600">
							Please select a group to continue
						</p>
					)}
				</div>
			)}

			{/* Participants */}
			{type === "individual" && (
				<div className="space-y-3 w-full block">
					<Label className="font-medium text-foreground">
						Participants
					</Label>
					<ParticipantSelector
						participants={participants}
						onParticipantsChange={setParticipants}
					/>
					{participants.length <= 1 && (
						<p className="text-xs text-amber-600">
							Please add at least one other participant
						</p>
					)}
				</div>
			)}

			{/* Paid by selector */}
			<div className="space-y-3 w-full block">
				<Label className="font-medium text-foreground">Paid by</Label>
				<select
					className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					{...register("paidByUserId")}
				>
					<option value="">Select who paid</option>
					{participants.map((participant) => (
						<option key={participant.id} value={participant.id}>
							{participant.id === currentUser._id
								? "You"
								: participant.name}
						</option>
					))}
				</select>
				{errors.paidByUserId && (
					<p className="text-sm text-destructive">
						{errors.paidByUserId.message}
					</p>
				)}
			</div>

			{/* Split type */}
			<div className="space-y-4 w-full block">
				<Label className="font-medium text-foreground">
					Split type
				</Label>
				{/* FORCED flex-col to prevent the tabs from moving to the left */}
				<Tabs
					defaultValue="equal"
					onValueChange={(value) => setValue("splitType", value)}
					className="w-full flex flex-col"
				>
					<TabsList className="grid w-full grid-cols-3 h-10 rounded-lg bg-muted p-1">
						<TabsTrigger value="equal" className="rounded-md">
							Equal
						</TabsTrigger>
						<TabsTrigger value="percentage" className="rounded-md">
							Percentage
						</TabsTrigger>
						<TabsTrigger value="exact" className="rounded-md">
							Exact Amounts
						</TabsTrigger>
					</TabsList>

					<div className="w-full mt-6">
						<TabsContent value="equal" className="w-full m-0 block">
							<p className="text-sm text-muted-foreground mb-4">
								Split equally among all participants
							</p>
							<SplitSelector
								type="equal"
								amount={parseFloat(amountValue) || 0}
								participants={participants}
								paidByUserId={paidByUserId}
								splits={splits}
								onSplitsChange={setSplits}
							/>
						</TabsContent>
						<TabsContent
							value="percentage"
							className="w-full m-0 block"
						>
							<p className="text-sm text-muted-foreground mb-4">
								Split by percentage
							</p>
							<SplitSelector
								type="percentage"
								amount={parseFloat(amountValue) || 0}
								participants={participants}
								paidByUserId={paidByUserId}
								splits={splits}
								onSplitsChange={setSplits}
							/>
						</TabsContent>
						<TabsContent value="exact" className="w-full m-0 block">
							<p className="text-sm text-muted-foreground mb-4">
								Enter exact amounts
							</p>
							<SplitSelector
								type="exact"
								amount={parseFloat(amountValue) || 0}
								participants={participants}
								paidByUserId={paidByUserId}
								splits={splits}
								onSplitsChange={setSplits}
							/>
						</TabsContent>
					</div>
				</Tabs>
			</div>

			<div className="flex justify-end pt-6 w-full">
				<Button
					type="submit"
					size="lg"
					disabled={isSubmitting || participants.length <= 1}
				>
					{isSubmitting ? "Creating..." : "Create Expense"}
				</Button>
			</div>
		</form>
	);
}
