//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

func getDiskUsage(path string) (free, total int64) {
	var freeBytesAvailable, totalNumberOfBytes, totalNumberOfFreeBytes int64
	r, _, _ := syscall.NewLazyDLL("kernel32.dll").
		NewProc("GetDiskFreeSpaceExW").
		Call(
			uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr(path))),
			uintptr(unsafe.Pointer(&freeBytesAvailable)),
			uintptr(unsafe.Pointer(&totalNumberOfBytes)),
			uintptr(unsafe.Pointer(&totalNumberOfFreeBytes)),
		)
	if r != 0 {
		return freeBytesAvailable, totalNumberOfBytes
	}
	return 0, 0
}
