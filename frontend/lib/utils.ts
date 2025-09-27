import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

const API_BASE_URL = "http://localhost:8080/api";

export async function getDevices() {
	const response = await fetch(`${API_BASE_URL}/drives`);
	if (!response.ok) {
		throw new Error("Failed to fetch devices");
	}
	return response.json();
}

export async function getDriveHealth(deviceName: string) {
	const drive = deviceName.replace("/dev/", "");
	const response = await fetch(`${API_BASE_URL}/drive/${drive}/health`);
	if (!response.ok) {
		throw new Error("Failed to fetch drive health");
	}
	return response.json();
}

export async function startWipe(config: {
	DevicePath: string;
	Method: string;
	DeviceSerial: string;
	DeviceType: string;
}) {
	const response = await fetch(`${API_BASE_URL}/wipe`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(config),
	});
	if (!response.ok) {
		throw new Error("Failed to start wipe process");
	}
	return response.json();
}

export async function getWipeMethods(deviceId: string) {
	// The ID for storage devices is `/dev/sda`, so we remove `/dev/`.
	// For mobile, it's the serial, which is what we want.
	const identifier = deviceId.startsWith("/dev/")
		? deviceId.substring(5)
		: deviceId;
	const response = await fetch(
		`${API_BASE_URL}/drive/${identifier}/wipe-methods`,
	);
	if (!response.ok) {
		throw new Error("Failed to fetch wipe methods");
	}
	return response.json();
}

export async function getCertificates() {
	const response = await fetch(`${API_BASE_URL}/certificates`);
	if (!response.ok) {
		throw new Error("Failed to fetch certificates");
	}
	return response.json();
}

export async function unmountDevice(devicePath: string) {
	const response = await fetch(`${API_BASE_URL}/unmount`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ devicePath }),
	});
	if (!response.ok) {
		throw new Error("Failed to unmount device");
	}
	return response.json();
}

export async function pauseWipe(deviceId: string) {
	const response = await fetch(`${API_BASE_URL}/wipe/pause`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ deviceId }),
	});
	if (!response.ok) {
		throw new Error("Failed to pause wipe");
	}
	return response.json();
}

export async function abortWipe(deviceId: string) {
	const response = await fetch(`${API_BASE_URL}/wipe/abort`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ deviceId }),
	});
	if (!response.ok) {
		throw new Error("Failed to abort wipe");
	}
	return response.json();
}

export async function generateCertificate(data: {
	model: string;
	serial: string;
	method: string;
}) {
	const response = await fetch(`${API_BASE_URL}/certificate/generate`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(data),
	});
	if (!response.ok) {
		throw new Error("Failed to generate certificate");
	}
	return response.json();
}
