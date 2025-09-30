"use client";

import { useState, useEffect } from "react";
import {
	Search,
	Download,
	FileText,
	Shield,
	Calendar,
	QrCode,
	Filter,
	Eye,
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
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Certificate {
	id: string;
	certificateId: string;
	deviceName: string;
	deviceModel: string;
	deviceSerial: string;
	wipeMethod: string;
	wipePolicy: string;
	operatorId: string;
	organization: string;
	startTime: string;
	endTime: string;
	status: "valid" | "expired" | "revoked";
	evidenceHash: string;
	signatureValid: boolean;
	createdAt: string;
}

const mockCertificates: Certificate[] = [
	{
		id: "cert-1",
		certificateId: "CERT-2025-001234",
		deviceName: "/dev/sdc",
		deviceModel: "Samsung 980 PRO 1TB",
		deviceSerial: "S6B2NS0R123456",
		wipeMethod: "ATA_SECURE_ERASE",
		wipePolicy: "NIST_SP_800_88_PURGE",
		operatorId: "admin@company.com",
		organization: "SecureWipe Pro",
		startTime: "2025-01-20T13:00:00Z",
		endTime: "2025-01-20T13:05:00Z",
		status: "valid",
		evidenceHash: "sha256:a1b2c3d4e5f6...",
		signatureValid: true,
		createdAt: "2025-01-20T13:05:30Z",
	},
	{
		id: "cert-2",
		certificateId: "CERT-2025-001233",
		deviceName: "/dev/sdb",
		deviceModel: "WD Blue 2TB",
		deviceSerial: "WD-WCC4N7123456",
		wipeMethod: "DOD_5220_22_M",
		wipePolicy: "NIST_SP_800_88_PURGE",
		operatorId: "tech@company.com",
		organization: "SecureWipe Pro",
		startTime: "2025-01-19T09:30:00Z",
		endTime: "2025-01-19T15:45:00Z",
		status: "valid",
		evidenceHash: "sha256:f6e5d4c3b2a1...",
		signatureValid: true,
		createdAt: "2025-01-19T15:46:12Z",
	},
	{
		id: "cert-3",
		certificateId: "CERT-2025-001232",
		deviceName: "USB Drive",
		deviceModel: "SanDisk Ultra 64GB",
		deviceSerial: "AA00000000001234",
		wipeMethod: "RANDOM_OVERWRITE",
		wipePolicy: "NIST_SP_800_88_CLEAR",
		operatorId: "admin@company.com",
		organization: "SecureWipe Pro",
		startTime: "2025-01-18T14:20:00Z",
		endTime: "2025-01-18T14:35:00Z",
		status: "expired",
		evidenceHash: "sha256:123456789abc...",
		signatureValid: false,
		createdAt: "2025-01-18T14:36:05Z",
	},
];

import { getCertificates } from "@/lib/utils";

// ... (keep existing mockCertificates and other code)

export function CertificateManager() {
	const [certificates, setCertificates] =
		useState<Certificate[]>(mockCertificates);
	const [searchTerm, setSearchTerm] = useState("");
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [selectedCertificate, setSelectedCertificate] =
		useState<Certificate | null>(null);

	useEffect(() => {
		const fetchCertificates = async () => {
			try {
				const backendCerts = await getCertificates();
				// Combine mock data with backend data, avoiding duplicates
				const allCerts = [...mockCertificates];
				const mockIds = new Set(mockCertificates.map((c) => c.id));
				backendCerts.forEach((cert: Certificate) => {
					if (!mockIds.has(cert.id)) {
						allCerts.push(cert);
					}
				});
				setCertificates(allCerts);
			} catch (error) {
				console.error("Failed to fetch certificates:", error);
				// Keep mock data on error
				setCertificates(mockCertificates);
			}
		};
		fetchCertificates();
	}, []);

	const filteredCertificates = certificates.filter((cert) => {
		const matchesSearch =
			cert.certificateId
				.toLowerCase()
				.includes(searchTerm.toLowerCase()) ||
			cert.deviceName.toLowerCase().includes(searchTerm.toLowerCase()) ||
			cert.deviceModel.toLowerCase().includes(searchTerm.toLowerCase()) ||
			cert.deviceSerial.toLowerCase().includes(searchTerm.toLowerCase());

		const matchesStatus =
			statusFilter === "all" || cert.status === statusFilter;

		return matchesSearch && matchesStatus;
	});

	const getStatusColor = (status: Certificate["status"]) => {
		switch (status) {
			case "valid":
				return "bg-success/20 text-success";
			case "expired":
				return "bg-warning/20 text-warning";
			case "revoked":
				return "bg-destructive/20 text-destructive";
		}
	};

	const formatDate = (isoString: string) => {
		return new Date(isoString).toLocaleDateString("en-US", {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	};

	const calculateDuration = (start: string, end: string) => {
		const startTime = new Date(start).getTime();
		const endTime = new Date(end).getTime();
		const durationMs = endTime - startTime;

		const hours = Math.floor(durationMs / (1000 * 60 * 60));
		const minutes = Math.floor(
			(durationMs % (1000 * 60 * 60)) / (1000 * 60),
		);

		if (hours > 0) {
			return `${hours}h ${minutes}m`;
		}
		return `${minutes}m`;
	};

	const handleDownloadCertificate = (
		certificate: Certificate,
		format: "pdf" | "json",
	) => {
		if (format === "json") {
			const certData = {
				certificateId: certificate.certificateId,
				deviceInfo: {
					name: certificate.deviceName,
					model: certificate.deviceModel,
					serial: certificate.deviceSerial,
				},
				wipeDetails: {
					method: certificate.wipeMethod,
					policy: certificate.wipePolicy,
					startTime: certificate.startTime,
					endTime: certificate.endTime,
				},
				verification: {
					evidenceHash: certificate.evidenceHash,
					signatureValid: certificate.signatureValid,
					status: certificate.status,
				},
				metadata: {
					organization: certificate.organization,
					operator: certificate.operatorId,
					createdAt: certificate.createdAt,
				},
			};

			const blob = new Blob([JSON.stringify(certData, null, 2)], {
				type: "application/json",
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `certificate-${certificate.certificateId}.json`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} else if (format === "pdf") {
			console.log(
				"Generating PDF certificate for:",
				certificate.certificateId,
			);
			// For demo purposes, create a simple text file
			const pdfContent = `
DATA DESTRUCTION CERTIFICATE
============================

Certificate ID: ${certificate.certificateId}
Organization: ${certificate.organization}
Operator: ${certificate.operatorId}

Device Information:
- Name: ${certificate.deviceName}
- Model: ${certificate.deviceModel}
- Serial: ${certificate.deviceSerial}

Wipe Details:
- Method: ${certificate.wipeMethod}
- Policy: ${certificate.wipePolicy}
- Start Time: ${new Date(certificate.startTime).toLocaleString()}
- End Time: ${new Date(certificate.endTime).toLocaleString()}
- Duration: ${calculateDuration(certificate.startTime, certificate.endTime)}

Verification:
- Status: ${certificate.status.toUpperCase()}
- Evidence Hash: ${certificate.evidenceHash}
- Signature Valid: ${certificate.signatureValid ? "Yes" : "No"}

Generated: ${new Date(certificate.createdAt).toLocaleString()}
      `;

			const blob = new Blob([pdfContent], { type: "text/plain" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `certificate-${certificate.certificateId}.pdf`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		}
	};

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold text-foreground">
					Certificate Management
				</h1>
				<p className="text-muted-foreground">
					View and manage data destruction certificates
				</p>
			</div>

			{/* Search and Filters */}
			<Card className="component-border component-border-hover">
				<CardContent className="p-4">
					<div className="flex flex-col sm:flex-row gap-4">
						<div className="flex-1 relative">
							<Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
							<Input
								placeholder="Search certificates by ID, device, or serial..."
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
								className="pl-10"
							/>
						</div>
						<Select
							value={statusFilter}
							onValueChange={setStatusFilter}
						>
							<SelectTrigger className="w-full sm:w-48">
								<Filter className="h-4 w-4 mr-2" />
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All Status</SelectItem>
								<SelectItem value="valid">Valid</SelectItem>
								<SelectItem value="expired">Expired</SelectItem>
								<SelectItem value="revoked">Revoked</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</CardContent>
			</Card>

			{/* Certificates Table */}
			<Card className="component-border component-border-hover">
				<CardHeader>
					<CardTitle className="flex items-center space-x-2">
						<Shield className="h-5 w-5" />
						<span>Certificates</span>
						<Badge variant="secondary">
							{filteredCertificates.length}
						</Badge>
					</CardTitle>
					<CardDescription>
						Data destruction certificates and verification records
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="rounded-md border component-border">
						<Table>
							<TableHeader>
								<TableRow className="bg-muted/50">
									<TableHead className="text-foreground">
										Certificate ID
									</TableHead>
									<TableHead className="text-foreground">
										Device
									</TableHead>
									<TableHead className="text-foreground">
										Method
									</TableHead>
									<TableHead className="text-foreground">
										Date
									</TableHead>
									<TableHead className="text-foreground">
										Status
									</TableHead>
									<TableHead className="text-foreground">
										Actions
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{filteredCertificates.map((cert) => (
									<TableRow
										key={cert.id}
										className="hover:bg-muted/50"
									>
										<TableCell>
											<div>
												<div className="font-medium font-mono text-sm text-foreground">
													{cert.certificateId}
												</div>
												<div className="text-xs text-muted-foreground">
													{cert.signatureValid
														? "Signature Valid"
														: "Signature Invalid"}
												</div>
											</div>
										</TableCell>
										<TableCell>
											<div>
												<div className="font-medium text-foreground">
													{cert.deviceName}
												</div>
												<div className="text-sm text-muted-foreground">
													{cert.deviceModel}
												</div>
												<div className="text-xs text-muted-foreground font-mono">
													{cert.deviceSerial}
												</div>
											</div>
										</TableCell>
										<TableCell>
											<div>
												<div className="text-sm font-medium text-foreground">
													{cert.wipeMethod}
												</div>
												<div className="text-xs text-muted-foreground">
													{cert.wipePolicy}
												</div>
											</div>
										</TableCell>
										<TableCell>
											<div>
												<div className="text-sm text-foreground">
													{formatDate(cert.startTime)}
												</div>
												<div className="text-xs text-muted-foreground">
													Duration:{" "}
													{calculateDuration(
														cert.startTime,
														cert.endTime,
													)}
												</div>
											</div>
										</TableCell>
										<TableCell>
											<Badge
												className={getStatusColor(
													cert.status,
												)}
											>
												{cert.status.toUpperCase()}
											</Badge>
										</TableCell>
										<TableCell>
											<div className="flex space-x-2">
												<Dialog>
													<DialogTrigger asChild>
														<Button
															variant="outline"
															size="sm"
															onClick={() =>
																setSelectedCertificate(
																	cert,
																)
															}
														>
															<Eye className="h-4 w-4" />
														</Button>
													</DialogTrigger>
													<DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto component-border">
														<DialogHeader>
															<DialogTitle className="flex items-center space-x-2 text-foreground">
																<Shield className="h-5 w-5" />
																<span>
																	Certificate
																	Details
																</span>
															</DialogTitle>
															<DialogDescription>
																Data destruction
																certificate and
																verification
																information
															</DialogDescription>
														</DialogHeader>
														{selectedCertificate && (
															<CertificateDetails
																certificate={
																	selectedCertificate
																}
															/>
														)}
													</DialogContent>
												</Dialog>
												<Button
													variant="outline"
													size="sm"
													onClick={() =>
														handleDownloadCertificate(
															cert,
															"json",
														)
													}
												>
													<Download className="h-4 w-4" />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

function CertificateDetails({ certificate }: { certificate: Certificate }) {
	const handleDownloadCertificate = (
		certificate: Certificate,
		format: "pdf" | "json",
	) => {
		if (format === "json") {
			const certData = {
				certificateId: certificate.certificateId,
				deviceInfo: {
					name: certificate.deviceName,
					model: certificate.deviceModel,
					serial: certificate.deviceSerial,
				},
				wipeDetails: {
					method: certificate.wipeMethod,
					policy: certificate.wipePolicy,
					startTime: certificate.startTime,
					endTime: certificate.endTime,
				},
				verification: {
					evidenceHash: certificate.evidenceHash,
					signatureValid: certificate.signatureValid,
					status: certificate.status,
				},
				metadata: {
					organization: certificate.organization,
					operator: certificate.operatorId,
					createdAt: certificate.createdAt,
				},
			};

			const blob = new Blob([JSON.stringify(certData, null, 2)], {
				type: "application/json",
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `certificate-${certificate.certificateId}.json`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} else if (format === "pdf") {
			console.log(
				"Generating PDF certificate for:",
				certificate.certificateId,
			);
			// For demo purposes, create a simple text file
			const pdfContent = `
DATA DESTRUCTION CERTIFICATE
============================

Certificate ID: ${certificate.certificateId}
Organization: ${certificate.organization}
Operator: ${certificate.operatorId}

Device Information:
- Name: ${certificate.deviceName}
- Model: ${certificate.deviceModel}
- Serial: ${certificate.deviceSerial}

Wipe Details:
- Method: ${certificate.wipeMethod}
- Policy: ${certificate.wipePolicy}
- Start Time: ${new Date(certificate.startTime).toLocaleString()}
- End Time: ${new Date(certificate.endTime).toLocaleString()}
- Duration: ${calculateDuration(certificate.startTime, certificate.endTime)}

Verification:
- Status: ${certificate.status.toUpperCase()}
- Evidence Hash: ${certificate.evidenceHash}
- Signature Valid: ${certificate.signatureValid ? "Yes" : "No"}

Generated: ${new Date(certificate.createdAt).toLocaleString()}
      `;

			const blob = new Blob([pdfContent], { type: "text/plain" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `certificate-${certificate.certificateId}.pdf`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		}
	};

	return (
		<div className="space-y-6 ">
			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				{/* Certificate Information */}
				<Card className="component-border component-border-hover">
					<CardHeader>
						<CardTitle className="flex items-center space-x-2 text-foreground">
							<FileText className="h-5 w-5" />
							<span>Certificate Information</span>
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-2 gap-4 text-sm">
							<div>
								<label className="text-muted-foreground">
									Certificate ID
								</label>
								<p className="font-mono font-medium text-foreground">
									{certificate.certificateId}
								</p>
							</div>
							<div>
								<label className="text-muted-foreground">
									Status
								</label>
								<div className="flex items-center space-x-2">
									<Badge
										className={getStatusColor(
											certificate.status,
										)}
									>
										{certificate.status.toUpperCase()}
									</Badge>
								</div>
							</div>
							<div>
								<label className="text-muted-foreground">
									Organization
								</label>
								<p className="font-medium text-foreground">
									{certificate.organization}
								</p>
							</div>
							<div>
								<label className="text-muted-foreground">
									Operator
								</label>
								<p className="font-medium text-foreground">
									{certificate.operatorId}
								</p>
							</div>
							<div>
								<label className="text-muted-foreground">
									Created
								</label>
								<p className="font-medium text-foreground">
									{formatDate(certificate.createdAt)}
								</p>
							</div>
							<div>
								<label className="text-muted-foreground">
									Signature
								</label>
								<p
									className={cn(
										"font-medium",
										certificate.signatureValid
											? "text-success"
											: "text-destructive",
									)}
								>
									{certificate.signatureValid
										? "Valid"
										: "Invalid"}
								</p>
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Device Information */}
				<Card className="component-border component-border-hover">
					<CardHeader>
						<CardTitle className="flex items-center space-x-2 text-foreground">
							<Shield className="h-5 w-5" />
							<span>Device Information</span>
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-1 gap-4 text-sm">
							<div>
								<label className="text-muted-foreground">
									Device Name
								</label>
								<p className="font-medium text-foreground">
									{certificate.deviceName}
								</p>
							</div>
							<div>
								<label className="text-muted-foreground">
									Model
								</label>
								<p className="font-medium text-foreground">
									{certificate.deviceModel}
								</p>
							</div>
							<div>
								<label className="text-muted-foreground">
									Serial Number
								</label>
								<p className="font-mono font-medium text-foreground">
									{certificate.deviceSerial}
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Wipe Details */}
			<Card className="component-border component-border-hover">
				<CardHeader>
					<CardTitle className="flex items-center space-x-2 text-foreground">
						<Calendar className="h-5 w-5" />
						<span>Wipe Operation Details</span>
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
						<div>
							<label className="text-muted-foreground">
								Wipe Method
							</label>
							<p className="font-medium text-foreground">
								{certificate.wipeMethod}
							</p>
						</div>
						<div>
							<label className="text-muted-foreground">
								Policy Standard
							</label>
							<p className="font-medium text-foreground">
								{certificate.wipePolicy}
							</p>
						</div>
						<div>
							<label className="text-muted-foreground">
								Start Time
							</label>
							<p className="font-medium text-foreground">
								{formatDate(certificate.startTime)}
							</p>
						</div>
						<div>
							<label className="text-muted-foreground">
								End Time
							</label>
							<p className="font-medium text-foreground">
								{formatDate(certificate.endTime)}
							</p>
						</div>
						<div>
							<label className="text-muted-foreground">
								Duration
							</label>
							<p className="font-medium text-foreground">
								{calculateDuration(
									certificate.startTime,
									certificate.endTime,
								)}
							</p>
						</div>
						<div>
							<label className="text-muted-foreground">
								Evidence Hash
							</label>
							<p className="font-mono text-xs text-foreground">
								{certificate.evidenceHash}
							</p>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* QR Code and Downloads */}
			<Card className="component-border component-border-hover">
				<CardHeader>
					<CardTitle className="flex items-center space-x-2 text-foreground">
						<QrCode className="h-5 w-5" />
						<span>Verification & Downloads</span>
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex flex-col md:flex-row gap-6">
						<div className="flex-1">
							<div className="flex items-center justify-center h-32 bg-muted rounded-lg">
								<QrCode className="h-16 w-16 text-muted-foreground" />
							</div>
							<p className="text-xs text-muted-foreground text-center mt-2">
								QR Code for certificate verification
							</p>
						</div>
						<div className="flex-1 space-y-3">
							<Button
								className="w-full bg-blue-600 hover:bg-blue-700 text-white"
								onClick={() =>
									handleDownloadCertificate(
										certificate,
										"json",
									)
								}
							>
								<Download className="h-4 w-4 mr-2" />
								Download JSON Certificate
							</Button>
							<Button
								variant="outline"
								className="w-full border-red-600 text-red-600 hover:bg-red-50 bg-transparent"
								onClick={() =>
									handleDownloadCertificate(
										certificate,
										"pdf",
									)
								}
							>
								<FileText className="h-4 w-4 mr-2" />
								Download PDF Certificate
							</Button>
							<Button
								variant="outline"
								className="w-full bg-transparent"
							>
								<Shield className="h-4 w-4 mr-2" />
								Verify Certificate
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

function getStatusColor(status: Certificate["status"]) {
	switch (status) {
		case "valid":
			return "bg-success/20 text-success";
		case "expired":
			return "bg-warning/20 text-warning";
		case "revoked":
			return "bg-destructive/20 text-destructive";
	}
}

function formatDate(isoString: string) {
	return new Date(isoString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function calculateDuration(start: string, end: string) {
	const startTime = new Date(start).getTime();
	const endTime = new Date(end).getTime();
	const durationMs = endTime - startTime;

	const hours = Math.floor(durationMs / (1000 * 60 * 60));
	const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	return `${minutes}m`;
}
