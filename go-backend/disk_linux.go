//go:build linux || darwin

package main

import (
    "syscall"
)

// On Linux/macOS, just return filesystem size
func getDiskUsage(path string) (free, total int64) {
    var stat syscall.Statfs_t
    if err := syscall.Statfs(path, &stat); err == nil {
        free = int64(stat.Bavail) * int64(stat.Bsize)
        total = int64(stat.Blocks) * int64(stat.Bsize)
        return free, total
    }
    return 0, 0
}
