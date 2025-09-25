"use client";

import { useState, useEffect, useRef } from "react";
import {
	Play,
	Pause,
	Square,
	Download,
	Trash2,
	AlertCircle,
	CheckCircle,
	Clock,
	Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

interface WipeJob {
	id: string;
	deviceName: string;
	deviceModel: string;
	method: string;
	status: "running" | "paused" | "completed" | "failed" | "queued";
	progress: number;
	currentPass: number;
	totalPasses: number;
	startTime: string;
	estimatedCompletion: string;
	speed: string;
}

interface LogEntry {
	id: string;
	timestamp: string;
	level: "info" | "warning" | "error" | "success";
	message: string;
	deviceId?: string;
}

export function ProgressTracker() {
	const [jobs, setJobs] = useState<WipeJob[]>([]);
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [selectedJob, setSelectedJob] = useState<string | null>(null);
	const router = useRouter();
	const ws = useRef<WebSocket | null>(null);

	useEffect(() => {
		ws.current = new WebSocket("ws://localhost:8080/ws");

		ws.current.onopen = () => {
			console.log("WebSocket connected");
			setLogs((prev) => [
				...prev,
				{
					id: Date.now().toString(),
					timestamp: new Date().toISOString(),
					level: "info",
					message: "Connected to wipe progress server.",
				},
			]);
		};

		ws.current.onmessage = (event) => {
			const message = event.data;
			const newLog: LogEntry = {
				id: Date.now().toString(),
				timestamp: new Date().toISOString(),
				level: "info",
				message: message,
			};

			if (message.startsWith("ERROR:")) {
				newLog.level = "error";
			} else if (message.startsWith("SUCCESS:")) {
				newLog.level = "success";
			}

			setLogs((prev) => [...prev, newLog]);

			// This is a simplified logic to update job progress.
			// A more robust implementation would involve job IDs in messages.
			if (message.includes("%")) {
				const progressMatch = message.match(/(\d+\.\d+)%/);
				if (progressMatch && progressMatch[1]) {
					const progress = parseFloat(progressMatch[1]);
					setJobs((prevJobs) =>
						prevJobs.map((job) =>
							job.status === "running"
								? { ...job, progress }
								: job,
						),
					);
				}
			}
		};

		ws.current.onclose = () => {
			console.log("WebSocket disconnected");
			setLogs((prev) => [
				...prev,
				{
					id: Date.now().toString(),
					timestamp: new Date().toISOString(),
					level: "warning",
					message: "Disconnected from wipe progress server.",
				},
			]);
		};

		return () => {
			ws.current?.close();
		};
	}, []);

	const getStatusIcon = (status: WipeJob["status"]) => {
		switch (status) {
			case "running":
				return <Play className="h-4 w-4 text-warning" />;
			case "paused":
				return <Pause className="h-4 w-4 text-muted-foreground" />;
			case "completed":
				return <CheckCircle className="h-4 w-4 text-success" />;
			case "failed":
				return <AlertCircle className="h-4 w-4 text-destructive" />;
			default:
				return <Clock className="h-4 w-4 text-muted-foreground" />;
		}
	};

	const getStatusColor = (status: WipeJob["status"]) => {
		switch (status) {
			case "running":
				return "bg-warning/20 text-warning";
			case "paused":
				return "bg-muted text-muted-foreground";
			case "completed":
				return "bg-success/20 text-success";
			case "failed":
				return "bg-destructive/20 text-destructive";
			default:
				return "bg-muted/20 text-muted-foreground";
		}
	};

	const getLogLevelColor = (level: LogEntry["level"]) => {
		switch (level) {
			case "info":
				return "text-blue-400";
			case "warning":
				return "text-yellow-400";
			case "error":
				return "text-red-400";
			case "success":
				return "text-green-400";
		}
	};

	const formatTime = (isoString: string) => {
		return new Date(isoString).toLocaleTimeString();
	};

	const selectedJobData = jobs.find((job) => job.id === selectedJob);
	const filteredLogs = selectedJob
		? logs.filter((log) => log.deviceId === selectedJob)
		: logs;

	const handleExportLogs = () => {
		const logData = filteredLogs.map((log) => ({
			timestamp: log.timestamp,
			level: log.level,
			message: log.message,
			deviceId: log.deviceId,
		}));

		const blob = new Blob([JSON.stringify(logData, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `wipe-logs-${new Date().toISOString().split("T")[0]}.json`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	const handleClearLogs = () => {
		setLogs([]);
	};

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold text-foreground">
					Wipe Progress
				</h1>
				<p className="text-muted-foreground">
					Monitor active and completed data destruction operations
				</p>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				{/* Jobs Overview */}
				<div className="lg:col-span-2 space-y-4">
					<Card className="component-border component-border-hover">
						<CardHeader>
							<CardTitle className="flex items-center space-x-2">
								<Clock className="h-5 w-5" />
								<span>Active Operations</span>
							</CardTitle>
							<CardDescription>
								{jobs.length === 0
									? "No active or recent wipe operations."
									: "Current and recent wipe operations"}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{jobs.map((job) => (
								<Card
									key={job.id}
									className={cn(
										"cursor-pointer transition-all duration-200 hover:shadow-md component-border component-border-hover",
										selectedJob === job.id &&
											"ring-2 ring-primary",
									)}
									onClick={() => setSelectedJob(job.id)}
								>
									<CardContent className="p-4">
										<div className="space-y-3">
											<div className="flex items-center justify-between">
												<div className="flex items-center space-x-3">
													{getStatusIcon(job.status)}
													<div>
														<h4 className="font-medium text-foreground">
															{job.deviceName}
														</h4>
														<p className="text-sm text-muted-foreground">
															{job.deviceModel}
														</p>
													</div>
												</div>
												<Badge
													className={getStatusColor(
														job.status,
													)}
												>
													{job.status.toUpperCase()}
												</Badge>
											</div>

											<div className="space-y-2">
												<div className="flex justify-between text-sm">
													<span className="text-muted-foreground">
														Progress
													</span>
													<span className="font-medium">
														{Math.round(
															job.progress,
														)}
														%
													</span>
												</div>
												<Progress
													value={job.progress}
													className="h-2"
												/>
											</div>

											<div className="grid grid-cols-2 gap-4 text-sm">
												<div>
													<span className="text-muted-foreground">
														Method:
													</span>
													<span className="ml-2 font-medium">
														{job.method}
													</span>
												</div>
												<div>
													<span className="text-muted-foreground">
														Pass:
													</span>
													<span className="ml-2 font-medium">
														{job.currentPass} of{" "}
														{job.totalPasses}
													</span>
												</div>
												<div>
													<span className="text-muted-foreground">
														Started:
													</span>
													<span className="ml-2 font-medium">
														{formatTime(
															job.startTime,
														)}
													</span>
												</div>
												<div>
													<span className="text-muted-foreground">
														Speed:
													</span>
													<span className="ml-2 font-medium">
														{job.speed}
													</span>
												</div>
											</div>
										</div>
									</CardContent>
								</Card>
							))}
						</CardContent>
					</Card>
				</div>

				{/* Job Details */}
				<div className="space-y-4">
					<Card className="component-border component-border-hover">
						<CardHeader>
							<CardTitle className="flex items-center space-x-2">
								<Terminal className="h-5 w-5" />
								<span>Operation Details</span>
							</CardTitle>
							<CardDescription>
								Detailed information for selected operation
							</CardDescription>
						</CardHeader>
						<CardContent>
							{selectedJobData ? (
								<div className="space-y-4">
									<div className="space-y-2">
										<h4 className="font-medium text-foreground">
											{selectedJobData.deviceName}
										</h4>
										<p className="text-sm text-muted-foreground">
											{selectedJobData.deviceModel}
										</p>
									</div>

									<Separator />

									<div className="space-y-3 text-sm">
										<div className="flex justify-between">
											<span className="text-muted-foreground">
												Status
											</span>
											<Badge
												className={getStatusColor(
													selectedJobData.status,
												)}
											>
												{selectedJobData.status.toUpperCase()}
											</Badge>
										</div>
										<div className="flex justify-between">
											<span className="text-muted-foreground">
												Method
											</span>
											<span className="font-medium">
												{selectedJobData.method}
											</span>
										</div>
										<div className="flex justify-between">
											<span className="text-muted-foreground">
												Progress
											</span>
											<span className="font-medium">
												{Math.round(
													selectedJobData.progress,
												)}
												%
											</span>
										</div>
									</div>
								</div>
							) : (
								<p className="text-muted-foreground text-sm">
									Select an operation to view details
								</p>
							)}
						</CardContent>
					</Card>
				</div>
			</div>

			{/* Log Viewer */}
			<Card className="component-border component-border-hover">
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle className="flex items-center space-x-2">
								<Terminal className="h-5 w-5" />
								<span>Live Logs</span>
							</CardTitle>
							<CardDescription>
								Real-time operation logs and system messages
							</CardDescription>
						</div>
						<div className="flex space-x-2">
							<Button
								variant="outline"
								size="sm"
								onClick={handleClearLogs}
							>
								<Trash2 className="h-4 w-4 mr-2" />
								Clear
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={handleExportLogs}
							>
								<Download className="h-4 w-4 mr-2" />
								Export
							</Button>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					<ScrollArea className="h-64 w-full bg-black rounded-md p-4 font-mono text-sm component-border">
						<div className="space-y-1">
							{logs.map((log) => (
								<div key={log.id} className="flex space-x-2">
									<span className="text-gray-500 shrink-0">
										[
										{new Date(
											log.timestamp,
										).toLocaleTimeString()}
										]
									</span>
									<span
										className={cn(
											"shrink-0 uppercase",
											getLogLevelColor(log.level),
										)}
									>
										[{log.level}]
									</span>
									<span className="text-green-400">
										{log.message}
									</span>
								</div>
							))}
						</div>
					</ScrollArea>
				</CardContent>
			</Card>
		</div>
	);
}
