import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/header";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { ClerkProvider } from "@clerk/nextjs";

const geistSans = Geist({
	subsets: ["latin"],
    variable: "--font-geist-sans"
});

const geistMono = Geist_Mono({
    subsets: ["latin"],
    variable: "--font-geist-mono"
})

export const metadata = {
	title: "Splitr",
	description: "The smartest way to split expenses with friends and family",
};

export default function RootLayout({ children }) {
	return (
		<html lang="en">
			<head>
				<link rel="icon" href="/logos/logo-s.png" sizes="any" />
			</head>
			<body className={`${geistSans.variable} ${geistMono.variable}`}>
				<ClerkProvider>
					<ConvexClientProvider>
						<Header />
						<main className="min-h-screen">{children}</main>
					</ConvexClientProvider>
				</ClerkProvider>
			</body>
		</html>
	);
}
