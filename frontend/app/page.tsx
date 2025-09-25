"use client"

import { useState, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Header } from "@/components/header"
import { Sidebar } from "@/components/sidebar"
import { DeviceManager } from "@/components/device-manager"
import { ProgressTracker } from "@/components/progress-tracker"
import { CertificateManager } from "@/components/certificate-manager"

export type TabType = "devices" | "progress" | "certificates"

const deviceDetails = {
  "dev-1": { name: "/dev/sda", model: "Samsung 980 PRO", status: "not-ready" }, // Updated status to not-ready
  "dev-2": { name: "/dev/sdb", model: "WD Blue", status: "wiping" },
  "dev-3": { name: "USB Drive", model: "SanDisk Ultra", status: "ready" }, // Updated status to ready
}

export default function HomePage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabType>("devices")
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null)

  useEffect(() => {
    const tabParam = searchParams.get("tab") as TabType
    if (tabParam && ["devices", "progress", "certificates"].includes(tabParam)) {
      setActiveTab(tabParam)
    }
  }, [searchParams])

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    const url = new URL(window.location.href)
    url.searchParams.set("tab", tab)
    router.push(url.pathname + url.search, { scroll: false })
  }

  const selectedDeviceInfo = selectedDevice ? deviceDetails[selectedDevice as keyof typeof deviceDetails] : null

  const renderContent = () => {
    switch (activeTab) {
      case "devices":
        return <DeviceManager selectedDevice={selectedDevice} onSelectDevice={setSelectedDevice} />
      case "progress":
        return <ProgressTracker />
      case "certificates":
        return <CertificateManager />
      default:
        return <DeviceManager selectedDevice={selectedDevice} onSelectDevice={setSelectedDevice} />
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header
        activeTab={activeTab}
        onTabChange={handleTabChange}
        selectedDeviceName={
          selectedDeviceInfo ? `${selectedDeviceInfo.name} (${selectedDeviceInfo.status.toUpperCase()})` : undefined
        }
      />
      <div className="flex">
        <Sidebar activeTab={activeTab} selectedDevice={selectedDevice} onSelectDevice={setSelectedDevice} />
        <main className="flex-1 p-6">{renderContent()}</main>
      </div>
    </div>
  )
}
