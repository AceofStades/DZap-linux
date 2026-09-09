// A base interface with properties common to all devices
interface BaseDevice {
	id: string; // A unique identifier (path for storage, serial for mobile)
	model: string;
	type: string;
	name: string;
}

export interface Partition {
	name: string;
	size: string;
	type: string;
}

export interface BlockDependency {
	name: string;
	type: string;
}

// Specific type for standard storage drives
export interface StorageDevice extends BaseDevice {
	deviceCategory: "storage";
	serial: string;
	wwn: string;
	size: string;
	transport: string;
	majorMinor: string;
	isMounted: boolean;
	isFrozen: boolean;
	isOSDrive?: boolean;
	activeDependencies: BlockDependency[];
	partitions: Partition[];
	status?: "ready" | "wiping" | "completed" | "error" | "not-ready";
	health?: DriveHealth;
}
// Specific type for mobile devices
export interface MobileDevice extends BaseDevice {
	deviceCategory: "mobile";
	serial: string;
	status?: "ready" | "wiping" | "completed" | "error" | "not-ready";
}

// A single, unified type for any device in the app
export type Device = StorageDevice | MobileDevice;

// --- Other types ---

export interface SmartAttribute {
	name: string;
	value: number;
}

export interface DriveHealth {
	predictedStatus: string;
	failureProbability: number;
	smartStatus: string;
	smartAttributes?: { [key: string]: SmartAttribute };
	temperature?: string;
	powerOnHours?: string;
	totalWrites?: string;
	wearLeveling?: string;
	badSectors?: string;
}

export interface WipeMethod {
	id: string;
	name: string;
	description: string;
}

export interface WipeRequest {
	DevicePath: string;
	Method: string;
	DeviceSerial: string;
	DeviceType: string;
	DeviceModel: string;
	ExpectedIdentity?: DeviceIdentity;
}

export interface DeviceIdentity {
	model: string;
	serial: string;
	wwn: string;
	sizeBytes: string;
	transport: string;
	majorMinor: string;
}

export interface PreflightCheck {
	code: string;
	status: "passed" | "blocked";
	message: string;
}

export interface WipePlan {
	decision: "ready" | "blocked";
	devicePath: string;
	deviceModel: string;
	deviceType: string;
	method: string;
	identity: DeviceIdentity | null;
	checks: PreflightCheck[];
}

export interface StartWipeResponse {
	status: string;
	jobId: string;
	deviceId: string;
}

export interface EvidenceEvent {
	sequence: number;
	timestamp: string;
	eventType: string;
	message: string;
	previousHash: string | null;
	eventHash: string;
}

export interface WipeJobRecord {
	id: string;
	devicePath: string;
	deviceModel: string;
	deviceType: string;
	identity: DeviceIdentity;
	method: string;
	status: "running" | "completed" | "failed";
	startedAt: string;
	completedAt: string | null;
	failure: string | null;
	evidenceHash: string;
	events: EvidenceEvent[];
}

export interface CertificateData {
	jobId: string;
	devicePath: string;
	deviceModel: string;
	deviceSerial: string;
	deviceWwn: string;
	deviceSizeBytes: string;
	deviceTransport: string;
	deviceMajorMinor: string;
	deviceType: string;
	wipeMethod: string;
	startedAt: string;
	completedAt: string;
	timestamp: string;
	evidenceHash: string;
}

export interface SignedCertificate {
	data: CertificateData;
	signature: string;
	publicKey: string;
}
