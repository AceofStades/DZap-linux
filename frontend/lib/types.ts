export interface Device {
  id: string
  name: string
  type: "SSD" | "HDD" | "USB" | "Mobile"
  model: string
  capacity: string
  serial: string
  firmware: string
  status: "ready" | "wiping" | "completed" | "error"
  partitions: Partition[]
  smart: SmartData
}

export interface Partition {
  name: string
  size: string
  type: string
}

export interface SmartData {
  health: string
  temperature: string
  powerOnHours: string
  totalWrites: string
  wearLeveling?: string
  badSectors: string
}

export interface WipeJob {
  id: string
  deviceId: string
  deviceName: string
  deviceModel: string
  method: string
  status: "queued" | "running" | "paused" | "completed" | "failed"
  progress: number
  currentPass: number
  totalPasses: number
  startTime: string
  estimatedCompletion?: string
  speed?: string
}

export interface Certificate {
  id: string
  certificateId: string
  deviceName: string
  deviceModel: string
  deviceSerial: string
  wipeMethod: string
  wipePolicy: string
  operatorId: string
  organization: string
  startTime: string
  endTime: string
  status: "valid" | "expired" | "revoked"
  evidenceHash: string
  signatureValid: boolean
  createdAt: string
}

export interface LogEntry {
  id: string
  timestamp: string
  level: "info" | "warning" | "error" | "success"
  message: string
  deviceId?: string
}
