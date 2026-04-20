"use client";

import { useRouter } from "next/navigation";
import { ExpenseForm } from "./components/expense-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function NewExpensepage() {
	const router = useRouter();

	return (
		<div className="container max-w-4xl mx-auto py-10 px-4 flex flex-col items-center">
			{/* Centered Header */}
			<div className="mb-10 text-center w-full">
				<h1 className="text-4xl md:text-5xl font-extrabold text-[#10b981] tracking-tight">
					Add a new expense
				</h1>
				<p className="text-muted-foreground mt-3 text-base md:text-lg">
					Record a new expense to split with others
				</p>
			</div>

			{/* Main Form Card Wrapper */}
			<div className="w-full bg-card border rounded-3xl shadow-sm p-6 md:p-10">
				{/* FORCED flex-col to prevent side-by-side layout */}
				<Tabs
					defaultValue="individual"
					className="w-full flex flex-col"
				>
					<TabsList className="grid w-full grid-cols-2 h-14 rounded-xl bg-muted p-1">
						<TabsTrigger
							value="individual"
							className="rounded-lg text-base font-medium h-full"
						>
							Individual Expense
						</TabsTrigger>
						<TabsTrigger
							value="group"
							className="rounded-lg text-base font-medium h-full"
						>
							Group Expense
						</TabsTrigger>
					</TabsList>

					<div className="w-full mt-8">
						<TabsContent
							value="individual"
							className="w-full m-0 focus-visible:outline-none block"
						>
							<ExpenseForm
								type="individual"
								onSuccess={(id) => router.push(`/person/${id}`)}
							/>
						</TabsContent>
						<TabsContent
							value="group"
							className="w-full m-0 focus-visible:outline-none block"
						>
							<ExpenseForm
								type="group"
								onSuccess={(id) => router.push(`/group/${id}`)}
							/>
						</TabsContent>
					</div>
				</Tabs>
			</div>
		</div>
	);
}
