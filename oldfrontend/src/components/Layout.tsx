import { useState, useEffect } from "react";
import ConfirmModal from "./ConfirmModal";

// Define a type for our drive object for better code quality
interface Drive {
	name: string;
	model: string;
	size: string;
	type: string;
	isMounted: boolean;
	isFrozen: boolean;
}

interface WipeMethod {
	id: string;
	label: string;
	description: string;
}

// Define a type for the health data from the backend
interface DriveHealth {
	predictedStatus: string;
	failureProbability: number;
	smartStatus: string;
}

// Define the available wipe methods for each drive type
const WIPE_OPTIONS: { [key: string]: WipeMethod[] } = {
	"SATA SSD": [
		{
			id: "sata_secure_erase",
			label: "⚡ ATA Secure Erase",
			description:
				"Firmware-based command to reset all cells. Fast and highly effective.",
		},
	],
	"NVMe SSD": [
		{
			id: "nvme_format",
			label: "🚀 NVMe Format",
			description:
				"The NVMe equivalent of a secure erase. Fast and highly effective.",
		},
	],
	HDD: [
		{
			id: "overwrite_1_pass",
			label: "1-Pass Overwrite (NIST Clear)",
			description: "A single pass of zeros. Secure for modern HDDs.",
		},
		{
			id: "overwrite_3_pass",
			label: "3-Pass Overwrite",
			description: "Multiple passes for increased security assurance.",
		},
	],
	"USB Drive": [
		{
			id: "overwrite_1_pass",
			label: "1-Pass Overwrite",
			description: "The most reliable method for most USB flash drives.",
		},
	],
	Unknown: [
		{
			id: "overwrite_1_pass",
			label: "🔥 1-Pass Overwrite",
			description: "A safe default for unrecognized device types.",
		},
	],
};

export default function Layout() {
	const [drives, setDrives] = useState<Drive[]>([]);
	const [fetchError, setFetchError] = useState<string | null>(null);
	const [selectedDrive, setSelectedDrive] = useState<Drive | null>(null);
	const [selectedMethod, setSelectedMethod] = useState<WipeMethod | null>(
		null,
	);
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [logs, setLogs] = useState<string[]>([
		"[INFO] DZap Initialized. Waiting for backend connection...",
	]);
	const [driveHealth, setDriveHealth] = useState<DriveHealth | null>(null);
	const [isLoadingHealth, setIsLoadingHealth] = useState(false);

	useEffect(() => {
		const fetchDrives = async () => {
			setLogs((prev) => [
				...prev,
				"[INFO] Scanning for available drives...",
			]);
			setFetchError(null);
			try {
				if ((window as any).electronAPI) {
					const fetchedDrives: Drive[] = await (
						window as any
					).electronAPI.invoke("detect-drives");
					setDrives(fetchedDrives);
					if (fetchedDrives.length > 0) {
						setSelectedDrive(fetchedDrives[0]);
						setLogs((prev) => [
							...prev,
							`[INFO] Found ${fetchedDrives.length} drives.`,
						]);
					} else {
						setLogs((prev) => [
							...prev,
							"[WARN] No drives detected.",
						]);
					}
				}
			} catch (error: any) {
				const errorMessage =
					error.message || "An unknown error occurred.";
				setFetchError(errorMessage);
				setLogs((prev) => [...prev, `[ERROR] ${errorMessage}`]);
			}
		};
		fetchDrives();
	}, []);

	useEffect(() => {
		if ((window as any).electronAPI) {
			const removeListener = (window as any).electronAPI.onBackendLog(
				(log: string) => {
					setLogs((prev) => [...prev, log]);
				},
			);
			return () => removeListener();
		}
	}, []);

	useEffect(() => {
		const fetchHealth = async () => {
			if (selectedDrive && (window as any).electronAPI) {
				setIsLoadingHealth(true);
				setDriveHealth(null);
				const health = await (window as any).electronAPI.invoke(
					"get-drive-health",
					selectedDrive.name.replace("/dev/", ""),
				);
				setDriveHealth(health);
				setIsLoadingHealth(false);
			}
		};
		fetchHealth();
	}, [selectedDrive]);

	const handleWipeClick = (method: WipeMethod) => {
		if (
			selectedDrive &&
			!selectedDrive.isMounted &&
			!selectedDrive.isFrozen
		) {
			setSelectedMethod(method);
			setIsModalOpen(true);
		}
	};

	const handleConfirm = () => {
		setIsModalOpen(false);
		if (selectedDrive && selectedMethod && (window as any).electronAPI) {
			setLogs((prev) => [
				...prev,
				`[CMD] Initiating '${selectedMethod.label}' for ${selectedDrive.name}...`,
			]);
			(window as any).electronAPI.send("backend-command", {
				action: "wipe",
				drive: selectedDrive.name,
				method: selectedMethod.id,
			});
		}
	};

	const formatBytes = (bytesStr: string) => {
		const bytes = Number(bytesStr);
		if (!bytes || isNaN(bytes)) return "N/A";
		if (bytes === 0) return "0 Bytes";
		const k = 1000;
		const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
	};

	const availableMethods = selectedDrive
		? WIPE_OPTIONS[selectedDrive.type] || []
		: [];
	const isWipeDisabled =
		!selectedDrive || selectedDrive.isMounted || selectedDrive.isFrozen;

	const getDisabledReason = (): string => {
		if (!selectedDrive) return "No drive is selected.";
		if (selectedDrive.isMounted) return "Cannot wipe a mounted drive.";
		if (selectedDrive.isFrozen)
			return "Drive is in a frozen state. Please sleep and wake the computer to unfreeze.";
		return "Select a wipe method.";
	};

	return (
		<div className="flex h-screen bg-gray-100 font-sans">
			<aside className="w-64 flex flex-col bg-gray-800 text-white shadow-lg">
				<div className="p-4 text-xl font-bold border-b border-gray-700">
					🔐 DZap Secure Wiper
				</div>
				<div className="flex-1 overflow-y-auto p-2">
					<h2 className="p-2 text-sm font-semibold text-gray-400 uppercase tracking-wider">
						Detected Devices
					</h2>
					<ul className="space-y-2">
						{drives.map((drive) => (
							<li
								key={drive.name}
								onClick={() => setSelectedDrive(drive)}
								className={`p-3 rounded-md cursor-pointer transition-all duration-200 ${selectedDrive?.name === drive.name ? "bg-blue-600 shadow-md" : "bg-gray-700 hover:bg-gray-600"}`}
							>
								<div className="font-semibold">
									{drive.name}
								</div>
								<div className="text-sm text-gray-300">
									{formatBytes(drive.size)} •{" "}
									{drive.model || "N/A"}
								</div>
							</li>
						))}
						{drives.length === 0 && !fetchError && (
							<div className="p-4 text-center text-gray-400">
								Scanning...
							</div>
						)}
						{fetchError && (
							<div className="p-4 text-center text-red-400">
								{fetchError}
							</div>
						)}
					</ul>
				</div>
			</aside>

			<main className="flex-1 flex flex-col p-6 overflow-y-auto">
				<section className="mb-6">
					<h1 className="text-2xl font-bold text-gray-800">
						📊 Drive Analysis Dashboard
					</h1>
					<div className="mt-4 bg-white shadow-lg rounded-lg p-6 border border-gray-200">
						{fetchError ? (
							<div className="text-red-600 font-bold">
								Error: {fetchError}
							</div>
						) : selectedDrive ? (
							<div className="grid md:grid-cols-3 gap-6">
								<div>
									<h3 className="font-bold text-gray-600">
										Device Info
									</h3>
									<p>
										<strong>Device:</strong>{" "}
										{selectedDrive.name}
									</p>
									<p>
										<strong>Model:</strong>{" "}
										{selectedDrive.model || "N/A"}
									</p>
									<p>
										<strong>Capacity:</strong>{" "}
										{formatBytes(selectedDrive.size)} (
										{selectedDrive.type})
									</p>
								</div>
								<div>
									<h3 className="font-bold text-gray-600">
										Health Assessment
									</h3>
									<p>
										<strong>S.M.A.R.T. Status:</strong>{" "}
										{isLoadingHealth
											? "Loading..."
											: driveHealth?.smartStatus || "N/A"}
									</p>
									<p>
										<strong>AI Prediction:</strong>{" "}
										{isLoadingHealth ? (
											"Analyzing..."
										) : (
											<>
												<span
													className={`font-bold ${driveHealth?.predictedStatus === "At Risk" ? "text-red-600" : "text-green-600"}`}
												>
													{driveHealth?.predictedStatus ||
														"N/A"}
												</span>
												{driveHealth && (
													<span className="text-sm ml-2 text-gray-500">
														(
														{(
															driveHealth.failureProbability *
															100
														).toFixed(1)}
														% risk)
													</span>
												)}
											</>
										)}
									</p>
								</div>
								<div>
									<h3 className="font-bold text-gray-600">
										Wipe Readiness
									</h3>
									<p>
										<strong>Status:</strong>
										{selectedDrive.isMounted ? (
											<span className="font-bold text-red-600">
												MOUNTED
											</span>
										) : selectedDrive.isFrozen ? (
											<span className="font-bold text-cyan-600">
												FROZEN
											</span>
										) : (
											<span className="font-bold text-green-600">
												READY
											</span>
										)}
									</p>
								</div>
							</div>
						) : (
							<p>
								No drive detected. Please ensure the backend is
								running with sudo privileges.
							</p>
						)}
					</div>
				</section>

				<section className="mb-6">
					<h2 className="text-2xl font-bold text-gray-800">
						🔥 Destruction Options
					</h2>
					<div className="mt-4 flex gap-4">
						{availableMethods.map((method) => (
							<button
								key={method.id}
								onClick={() => handleWipeClick(method)}
								disabled={isWipeDisabled}
								title={
									isWipeDisabled
										? getDisabledReason()
										: method.description
								}
								className={`px-6 py-3 rounded-lg font-bold text-white transition-all duration-200 shadow-lg
                  ${
						isWipeDisabled
							? "bg-gray-400 cursor-not-allowed shadow-md"
							: "bg-red-600 hover:bg-red-700 hover:shadow-xl transform hover:-translate-y-1"
					}`}
							>
								{method.label}
							</button>
						))}
						{availableMethods.length === 0 && selectedDrive && (
							<div className="p-4 rounded-lg bg-gray-100 text-gray-600 border border-gray-300">
								No supported wipe methods for this drive type (
								{selectedDrive.type}).
							</div>
						)}
					</div>
				</section>

				<section className="flex-1 min-h-0 flex flex-col">
					<h2 className="text-2xl font-bold text-gray-800">
						💻 System Terminal
					</h2>
					<div className="mt-4 h-full rounded-lg shadow-lg overflow-hidden border border-gray-300 flex flex-col bg-gray-900">
						<div className="flex-1 p-4 overflow-y-auto font-mono text-sm text-gray-200">
							{logs.map((log, i) => (
								<div
									key={i}
									className="mb-1 whitespace-pre-wrap"
								>
									{log.startsWith("[CMD]") ? (
										<span className="text-cyan-400">
											{log}
										</span>
									) : log.startsWith("[INFO]") ? (
										<span className="text-green-400">
											{log}
										</span>
									) : log.startsWith("[ERROR]") ? (
										<span className="text-red-400 font-bold">
											{log}
										</span>
									) : log.startsWith("[WARN]") ? (
										<span className="text-yellow-400">
											{log}
										</span>
									) : log.startsWith("SUCCESS") ? (
										<span className="text-lime-400 font-bold">
											{log}
										</span>
									) : (
										<span>{log}</span>
									)}
								</div>
							))}
						</div>
					</div>
				</section>
			</main>

			{selectedDrive && (
				<ConfirmModal
					driveName={selectedDrive.name}
					isOpen={isModalOpen}
					onClose={() => setIsModalOpen(false)}
					onConfirm={handleConfirm}
				/>
			)}
		</div>
	);
}
