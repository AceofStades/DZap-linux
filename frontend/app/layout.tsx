import type React from "react";
import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Analytics } from "@vercel/analytics/next";
import { Suspense } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
	title: "DZap",
	description:
		"Professional data wiping and certificate management application for secure data destruction. Supports DoD 5220.22-M, Gutmann, and crypto erase methods with compliance certificates.",
	keywords:
		"data wiping, secure erase, data destruction, NIST compliance, DoD 5220.22-M, certificate management, SSD sanitize, crypto erase",
	authors: [{ name: "SecureWipe Pro Team" }],
	creator: "SecureWipe Pro",
	publisher: "SecureWipe Pro",
	robots: "index, follow",
	viewport: "width=device-width, initial-scale=1",
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#f5f7fa" },
		{ media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
	],
	openGraph: {
		title: "SecureWipe Pro - Professional Data Wiping Solution",
		description:
			"Professional data wiping and certificate management application for secure data destruction.",
		type: "website",
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
		title: "SecureWipe Pro - Professional Data Wiping Solution",
		description:
			"Professional data wiping and certificate management application for secure data destruction.",
	},
	generator: "v0.app",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body
				className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`}
			>
				<ThemeProvider
					attribute="class"
					defaultTheme="light"
					enableSystem
					disableTransitionOnChange
				>
					<Suspense fallback={null}>{children}</Suspense>
				</ThemeProvider>
				<Analytics />
			</body>
		</html>
	);
}
