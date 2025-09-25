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

// Specific type for standard storage drives
export interface StorageDevice extends BaseDevice {
	deviceCategory: "storage";
	size: string;
	isMounted: boolean;
	isFrozen: boolean;
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

export interface DriveHealth {
	predictedStatus: string;
	failureProbability: number;
	smartStatus: string;
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
