"use client";

import { useState, useEffect } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

export function CategorySelector({ categories, onChange, defaultCategoryId }) {
	const [selectedCategory, setSelectedCategory] = useState("");

	// Set default value when categories change or component mounts
	useEffect(() => {
		if (!selectedCategory && categories && categories.length > 0) {
			// Find the default category by ID, or fall back to the first category
			const defaultCategory =
				categories.find((cat) => cat.id === defaultCategoryId) || categories[0];

			setSelectedCategory(defaultCategory.id);
			if (onChange) {
				onChange(defaultCategory.id);
			}
		}
	}, [selectedCategory, categories, defaultCategoryId, onChange]);

	// Handle when a category is selected
	const handleCategoryChange = (categoryId) => {
		setSelectedCategory(categoryId);

		// Only call onChange if it exists and the value has changed
		if (onChange && categoryId !== selectedCategory) {
			onChange(categoryId);
		}
	};

	// If no categories or empty categories array
	if (!categories || categories.length === 0) {
		return <div>No categories available</div>;
	}

	return (
		<Select value={selectedCategory} onValueChange={handleCategoryChange}>
			<SelectTrigger className="w-full">
				<SelectValue placeholder="Select a category" />
			</SelectTrigger>
			<SelectContent>
				{categories.map((category) => (
					<SelectItem key={category.id} value={category.id}>
						<div className="flex items-center gap-2">
							<span>{category.name}</span>
						</div>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
