"use client"

import { useState } from "react"
import { AlertTriangle, Shield, Zap, Settings, FileText, Play, Square, HardDrive } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { ConfirmationModal } from "@/components/confirmation-modal"
import { useRouter } from "next/navigation"

interface DeviceManagerProps {
  selectedDevice: string | null
  onSelectDevice: (deviceId: string) => void
}

const deviceDetails = {
  "dev-1": {
    id: "dev-1",
    name: "/dev/sda",
    type: "SSD",
    model: "Samsung 980 PRO",
    capacity: "1TB (1,000,204,886,016 bytes)",
    serial: "S6B2NS0R123456",
    firmware: "5B2QGXA7",
    status: "not-ready", // Changed from "ready" to "not-ready" to show Mount button
    partitions: [
      { name: "/dev/sda1", size: "512MB", type: "EFI System" },
      { name: "/dev/sda2", size: "999GB", type: "Linux filesystem" },
    ],
    smart: {
      health: "Good",
      temperature: "42°C",
      powerOnHours: "1,234",
      totalWrites: "15.2 TB",
      wearLeveling: "98%",
      badSectors: "0",
    },
  },
  "dev-2": {
    id: "dev-2",
    name: "/dev/sdb",
    type: "HDD",
    model: "WD Blue",
    capacity: "2TB (2,000,398,934,016 bytes)",
    serial: "WD-WCC4N7123456",
    firmware: "01.01A01",
    status: "wiping",
    partitions: [{ name: "/dev/sdb1", size: "2TB", type: "NTFS" }],
    smart: {
      health: "Good",
      temperature: "38°C",
      powerOnHours: "8,765",
      totalWrites: "N/A",
      wearLeveling: "N/A",
      badSectors: "0",
    },
  },
  "dev-3": {
    id: "dev-3",
    name: "USB Drive",
    type: "USB",
    model: "SanDisk Ultra",
    capacity: "64GB (64,023,737,344 bytes)",
    serial: "AA00000000001234",
    firmware: "1.00",
    status: "ready", // Changed to ready to show proper buttons
    partitions: [{ name: "USB1", size: "64GB", type: "FAT32" }],
    smart: {
      health: "Good",
      temperature: "N/A",
      powerOnHours: "N/A",
      totalWrites: "N/A",
      wearLeveling: "N/A",
      badSectors: "0",
    },
  },
}

export function DeviceManager({ selectedDevice }: DeviceManagerProps) {
  const [wipeMethod, setWipeMethod] = useState("quick")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [showStopConfirmation, setShowStopConfirmation] = useState(false) // Added stop confirmation state
  const router = useRouter()

  const device = selectedDevice ? deviceDetails[selectedDevice as keyof typeof deviceDetails] : null

  const handleStartWipe = () => {
    if (device && device.status === "ready") {
      setShowConfirmation(true)
    }
  }

  const handleConfirmWipe = () => {
    console.log("Starting wipe process for device:", device?.id)
    setShowConfirmation(false)
    router.push("/?tab=progress")
  }

  const handleMountDevice = () => {
    console.log("Mounting device:", device?.id)
    // Simulate mounting - in real app this would call backend API
    if (device) {
      deviceDetails[selectedDevice as keyof typeof deviceDetails].status = "ready"
    }
  }

  const handleGenerateCertificate = () => {
    console.log("Generating certificate for device:", device?.id)
    // Auto-generate certificate and redirect to certificates page
    router.push("/?tab=certificates")
  }

  const handleStopWipe = () => {
    setShowStopConfirmation(true)
  }

  const handleConfirmStopWipe = () => {
    console.log("Stopping wipe process for device:", device?.id)
    setShowStopConfirmation(false)
    // In real app, this would call backend API to stop wiping
  }

  if (!selectedDevice || !device) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center space-y-4">
          <Shield className="h-16 w-16 text-muted-foreground mx-auto" />
          <div>
            <h3 className="text-lg font-medium text-foreground">No Device Selected</h3>
            <p className="text-muted-foreground">Select a device from the sidebar to view details and actions</p>
          </div>
        </div>
      </div>
    )
  }

  const isWiping = device.status === "wiping"
  const isCompleted = device.status === "completed"
  const isNotReady = device.status === "not-ready" // Added not-ready status check
  const isSSD = device.type === "SSD"
  const isReady = device.status === "ready"

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Device Manager</h1>
            <p className="text-muted-foreground">Manage and wipe selected storage device</p>
          </div>
          <div className="flex items-center space-x-2">
            <Badge
              className={
                isReady
                  ? "bg-success/20 text-success"
                  : isWiping
                    ? "bg-warning/20 text-warning"
                    : isCompleted
                      ? "bg-success/20 text-success"
                      : "bg-destructive/20 text-destructive"
              }
            >
              {device.status.toUpperCase()}
            </Badge>
          </div>
        </div>

        {isSSD && isReady && (
          <Alert className="component-border component-border-hover">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              SSD detected. Crypto-erase or NVMe sanitize is recommended for optimal data destruction on solid-state
              drives.
            </AlertDescription>
          </Alert>
        )}

        {isWiping && (
          <Card className="border-warning bg-warning/5 component-border component-border-hover">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-warning">
                <Play className="h-5 w-5" />
                <span>Wipe in Progress</span>
              </CardTitle>
              <CardDescription>Data destruction is currently running on this device</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Overall Progress</span>
                  <span>45%</span>
                </div>
                <Progress value={45} className="h-2" />
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Method:</span>
                  <span className="ml-2 font-medium">DoD 5220.22-M (3-pass)</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Estimated Time:</span>
                  <span className="ml-2 font-medium">2h 15m remaining</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Current Pass:</span>
                  <span className="ml-2 font-medium">2 of 3</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Speed:</span>
                  <span className="ml-2 font-medium">125 MB/s</span>
                </div>
              </div>
              <Button variant="destructive" size="sm" className="w-fit" onClick={handleStopWipe}>
                <Square className="h-4 w-4 mr-2" />
                Stop Wipe
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="component-border component-border-hover">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Shield className="h-5 w-5" />
                <span>Device Information</span>
              </CardTitle>
              <CardDescription>Hardware specifications and identifiers</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">Device Name</label>
                  <p className="text-lg font-medium text-foreground">{device.name}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Type</label>
                  <p className="text-lg font-medium text-foreground">{device.type}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Model</label>
                  <p className="text-lg font-medium text-foreground">{device.model}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Capacity</label>
                  <p className="text-lg font-medium text-foreground">{device.capacity}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Serial Number</label>
                  <p className="text-lg font-medium text-foreground font-mono">{device.serial}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Firmware</label>
                  <p className="text-lg font-medium text-foreground">{device.firmware}</p>
                </div>
              </div>

              <Separator />

              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Partitions</label>
                <div className="space-y-2">
                  {device.partitions.map((partition, index) => (
                    <div
                      key={index}
                      className="flex justify-between items-center p-2 bg-muted rounded-md component-border"
                    >
                      <div>
                        <span className="font-medium text-sm text-foreground">{partition.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">({partition.type})</span>
                      </div>
                      <span className="text-sm font-medium text-foreground">{partition.size}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="component-border component-border-hover">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Zap className="h-5 w-5" />
                <span>Health & SMART Data</span>
              </CardTitle>
              <CardDescription>Device health information and diagnostics</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">Overall Health</label>
                  <div className="flex items-center space-x-2">
                    <Badge className="bg-success/20 text-success">{device.smart.health}</Badge>
                  </div>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Temperature</label>
                  <p className="text-lg font-medium text-foreground">{device.smart.temperature}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Power On Hours</label>
                  <p className="text-lg font-medium text-foreground">{device.smart.powerOnHours}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Total Writes</label>
                  <p className="text-lg font-medium text-foreground">{device.smart.totalWrites}</p>
                </div>
                {device.smart.wearLeveling !== "N/A" && (
                  <div>
                    <label className="text-sm text-muted-foreground">Wear Leveling</label>
                    <p className="text-lg font-medium text-foreground">{device.smart.wearLeveling}</p>
                  </div>
                )}
                <div>
                  <label className="text-sm text-muted-foreground">Bad Sectors</label>
                  <p className="text-lg font-medium text-foreground">{device.smart.badSectors}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="component-border component-border-hover">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Settings className="h-5 w-5" />
              <span>Wipe Configuration</span>
            </CardTitle>
            <CardDescription>Configure data destruction method and parameters</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Wipe Method</label>
                <Select value={wipeMethod} onValueChange={setWipeMethod} disabled={isWiping}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quick">Quick Wipe (1-pass zero)</SelectItem>
                    <SelectItem value="dod">DoD 5220.22-M (3-pass)</SelectItem>
                    <SelectItem value="gutmann">Gutmann (35-pass)</SelectItem>
                    {isSSD && <SelectItem value="crypto">Crypto Erase (SSD)</SelectItem>}
                    {isSSD && <SelectItem value="sanitize">NVMe Sanitize</SelectItem>}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Verification</label>
                <Select defaultValue="basic" disabled={isWiping}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Verification</SelectItem>
                    <SelectItem value="basic">Basic Verification</SelectItem>
                    <SelectItem value="full">Full Read Verification</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm" onClick={() => setShowAdvanced(!showAdvanced)} disabled={isWiping}>
                <Settings className="h-4 w-4 mr-2" />
                {showAdvanced ? "Hide" : "Show"} Advanced Options
              </Button>
            </div>

            {showAdvanced && (
              <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Block Size</label>
                    <Select defaultValue="1mb" disabled={isWiping}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="64kb">64 KB</SelectItem>
                        <SelectItem value="1mb">1 MB</SelectItem>
                        <SelectItem value="4mb">4 MB</SelectItem>
                        <SelectItem value="16mb">16 MB</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Thread Count</label>
                    <Select defaultValue="auto" disabled={isWiping}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 Thread</SelectItem>
                        <SelectItem value="2">2 Threads</SelectItem>
                        <SelectItem value="4">4 Threads</SelectItem>
                        <SelectItem value="auto">Auto</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            <Separator />

            <div className="flex flex-wrap gap-3">
              {isNotReady && (
                <Button
                  size="lg"
                  variant="destructive"
                  onClick={handleMountDevice}
                  className="bg-red-600 hover:bg-red-700"
                >
                  <HardDrive className="h-4 w-4 mr-2" />
                  Mount Device
                </Button>
              )}

              <Button
                size="lg"
                disabled={isWiping || isCompleted || isNotReady}
                className="bg-primary hover:bg-primary/90"
                onClick={handleStartWipe}
              >
                <Play className="h-4 w-4 mr-2" />
                {isWiping ? "Wiping in Progress..." : isCompleted ? "Wipe Completed" : "Start Wipe"}
              </Button>

              <Button variant="outline" size="lg" disabled={isWiping} onClick={handleGenerateCertificate}>
                <FileText className="h-4 w-4 mr-2" />
                Generate Certificate
              </Button>

              {!isReady && (
                <Button variant="outline" size="lg" disabled={isWiping}>
                  <Shield className="h-4 w-4 mr-2" />
                  Export Device Info
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <ConfirmationModal
        isOpen={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        onConfirm={handleConfirmWipe}
        device={device}
        wipeMethod={
          wipeMethod === "quick"
            ? "Quick Wipe (1-pass zero)"
            : wipeMethod === "dod"
              ? "DoD 5220.22-M (3-pass)"
              : wipeMethod === "gutmann"
                ? "Gutmann (35-pass)"
                : wipeMethod === "crypto"
                  ? "Crypto Erase (SSD)"
                  : wipeMethod === "sanitize"
                    ? "NVMe Sanitize"
                    : "Unknown Method"
        }
      />

      <ConfirmationModal
        isOpen={showStopConfirmation}
        onClose={() => setShowStopConfirmation(false)}
        onConfirm={handleConfirmStopWipe}
        device={device}
        wipeMethod="Stop Wipe Operation"
        title="Stop Wipe Operation"
        description="Wiped data will not be recovered now, do you still want to stop?"
        confirmText="Yes, Stop Wipe"
        isDestructive={true}
      />
    </>
  )
}
