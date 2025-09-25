"use client"

import { useState } from "react"
import { RefreshCw, HardDrive, Smartphone, UsbIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { TabType } from "@/app/page"

interface Device {
  id: string
  name: string
  type: "SSD" | "HDD" | "USB" | "Mobile"
  model: string
  capacity: string
  status: "ready" | "wiping" | "completed" | "error"
  serial: string
}

interface SidebarProps {
  activeTab: TabType
  selectedDevice: string | null
  onSelectDevice: (deviceId: string) => void
}

const mockDevices: Device[] = [
  {
    id: "dev-1",
    name: "/dev/sda",
    type: "SSD",
    model: "Samsung 980 PRO",
    capacity: "1TB",
    status: "ready",
    serial: "S6B2NS0R123456",
  },
  {
    id: "dev-2",
    name: "/dev/sdb",
    type: "HDD",
    model: "WD Blue",
    capacity: "2TB",
    status: "wiping",
    serial: "WD-WCC4N7123456",
  },
  {
    id: "dev-3",
    name: "USB Drive",
    type: "USB",
    model: "SanDisk Ultra",
    capacity: "64GB",
    status: "completed",
    serial: "AA00000000001234",
  },
]

export function Sidebar({ activeTab, selectedDevice, onSelectDevice }: SidebarProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    // Simulate refresh delay
    await new Promise((resolve) => setTimeout(resolve, 1000))
    setIsRefreshing(false)
  }

  const getDeviceIcon = (type: Device["type"]) => {
    switch (type) {
      case "SSD":
      case "HDD":
        return <HardDrive className="h-4 w-4" />
      case "USB":
        return <UsbIcon className="h-4 w-4" />
      case "Mobile":
        return <Smartphone className="h-4 w-4" />
    }
  }

  const getStatusColor = (status: Device["status"]) => {
    switch (status) {
      case "ready":
        return "border-success bg-success/10 text-success"
      case "wiping":
        return "border-warning bg-warning/10 text-warning"
      case "completed":
        return "border-success bg-success/10 text-success"
      case "error":
        return "border-destructive bg-destructive/10 text-destructive"
    }
  }

  const getStatusBadgeColor = (status: Device["status"]) => {
    switch (status) {
      case "ready":
        return "bg-success/20 text-success hover:bg-success/30"
      case "wiping":
        return "bg-warning/20 text-warning hover:bg-warning/30"
      case "completed":
        return "bg-success/20 text-success hover:bg-success/30"
      case "error":
        return "bg-destructive/20 text-destructive hover:bg-destructive/30"
    }
  }

  if (activeTab !== "devices") {
    return null
  }

  return (
    <aside className="w-80 bg-sidebar border-r border-sidebar-border p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-sidebar-foreground">Devices</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
          </Button>
        </div>

        <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto">
          {mockDevices.map((device) => (
            <Card
              key={device.id}
              className={cn(
                "p-4 cursor-pointer transition-all duration-200 hover:shadow-md",
                getStatusColor(device.status),
                selectedDevice === device.id && "ring-2 ring-primary",
              )}
              onClick={() => onSelectDevice(device.id)}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {getDeviceIcon(device.type)}
                    <span className="font-medium text-sm">{device.name}</span>
                  </div>
                  <Badge className={getStatusBadgeColor(device.status)}>{device.status}</Badge>
                </div>

                <div className="text-xs text-muted-foreground space-y-1">
                  <div>{device.model}</div>
                  <div className="flex justify-between">
                    <span>{device.type}</span>
                    <span>{device.capacity}</span>
                  </div>
                </div>

                {device.status === "wiping" && (
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div className="bg-warning h-1.5 rounded-full animate-pulse" style={{ width: "45%" }} />
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </aside>
  )
}
