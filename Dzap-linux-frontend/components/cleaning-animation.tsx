"use client"

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"

interface CleaningAnimationProps {
  deviceType: "SSD" | "USB"
  progress: number
  isActive: boolean
}

export function CleaningAnimation({ deviceType, progress, isActive }: CleaningAnimationProps) {
  const [animationProgress, setAnimationProgress] = useState(0)

  useEffect(() => {
    if (isActive) {
      const interval = setInterval(() => {
        setAnimationProgress((prev) => Math.min(prev + 1, progress))
      }, 50)
      return () => clearInterval(interval)
    }
  }, [isActive, progress])

  if (deviceType === "SSD") {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="relative">
          {/* CD-shaped disk */}
          <div className="w-32 h-32 rounded-full border-4 border-gray-300 relative overflow-hidden">
            {/* Cleaning progress overlay */}
            <div
              className="absolute inset-0 bg-gradient-to-r from-blue-500 to-green-500 opacity-70 transition-all duration-300"
              style={{
                clipPath: `polygon(50% 50%, 50% 0%, ${50 + (animationProgress / 100) * 50}% 0%, ${50 + (animationProgress / 100) * 50}% 100%, 50% 100%)`,
              }}
            />
            {/* Center hole */}
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background border-2 border-gray-300" />
            {/* Spinning animation when active */}
            <div
              className={cn("absolute inset-0 rounded-full border-t-4 border-blue-500", isActive && "animate-spin")}
            />
          </div>
          <div className="text-center mt-4">
            <p className="text-sm font-medium">SSD Cleaning</p>
            <p className="text-xs text-muted-foreground">{Math.round(animationProgress)}% Complete</p>
          </div>
        </div>
      </div>
    )
  }

  if (deviceType === "USB") {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="relative">
          {/* USB-shaped component */}
          <div className="relative">
            {/* USB body */}
            <div className="w-20 h-8 bg-gray-300 rounded-r-lg relative overflow-hidden">
              {/* Cleaning progress */}
              <div
                className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-300"
                style={{ width: `${animationProgress}%` }}
              />
              {/* USB connector */}
              <div className="absolute -left-2 top-1 w-4 h-6 bg-gray-400 rounded-l" />
            </div>
            {/* Progress bar below */}
            <div className="w-20 h-2 bg-gray-200 rounded-full mt-2 overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${animationProgress}%` }}
              />
            </div>
          </div>
          <div className="text-center mt-4">
            <p className="text-sm font-medium">USB Cleaning</p>
            <p className="text-xs text-muted-foreground">{Math.round(animationProgress)}% Complete</p>
          </div>
        </div>
      </div>
    )
  }

  return null
}
