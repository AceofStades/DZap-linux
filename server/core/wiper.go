package core

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"time"
)

type WipeConfig struct {
	DevicePath string
	Method     string
}

func SanitizeDrive(config WipeConfig, progress chan<- string) error {
	defer close(progress)

	drives, err := DetectDrives()
	if err != nil {
		return fmt.Errorf("could not verify drive status: %w", err)
	}

	var targetDrive *Drive
	for i := range drives {
		if drives[i].Name == config.DevicePath {
			targetDrive = &drives[i]
			break
		}
	}

	if targetDrive == nil {
		return fmt.Errorf("drive %s not found", config.DevicePath)
	}
	if targetDrive.IsMounted {
		return fmt.Errorf("cannot wipe a mounted drive")
	}

	progress <- "Sanitization started..."
	switch targetDrive.Type {
	case NVME:
		return sanitizeNVMe(targetDrive.Name, progress)
	case SSD:
		if targetDrive.IsFrozen {
			return fmt.Errorf("drive is in a frozen state")
		}
		return sanitizeSATA(targetDrive.Name, progress)
	case HDD, USB, UNKN:
		return sanitizeOverwrite(targetDrive.Name, 1, progress)
	default:
		return fmt.Errorf("unsupported drive type for sanitization")
	}
}

func runCommand(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	if err := cmd.Run(); err != nil {
		// exec.ExitError contains more details
		if exitErr, ok := err.(*exec.ExitError); ok {
			return fmt.Errorf("command %s failed: %s", name, string(exitErr.Stderr))
		}
		return fmt.Errorf("command %s failed: %w", name, err)
	}
	return nil
}

func sanitizeNVMe(path string, progress chan<- string) error {
	progress <- "Executing NVMe Format command..."
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	err := runCommand(ctx, "nvme", "format", path, "-s", "1")
	if err != nil {
		return err
	}
	progress <- "NVMe Format completed."
	return nil
}

func sanitizeSATA(path string, progress chan<- string) error {
	progress <- "Executing ATA Secure Erase command..."
	// This process involves setting a temporary password and then issuing the erase command.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()

	err := runCommand(ctx, "hdparm", "--user-master", "user", "--security-set-pass", "dZap", path)
	if err != nil {
		return fmt.Errorf("failed to set security password: %w", err)
	}
	progress <- "Security password set. Issuing erase command..."

	err = runCommand(ctx, "hdparm", "--user-master", "user", "--security-erase", "dZap", path)
	if err != nil {
		return fmt.Errorf("failed to execute secure erase: %w", err)
	}
	progress <- "ATA Secure Erase completed."
	return nil
}

func sanitizeOverwrite(path string, passes int, progress chan<- string) error {
	file, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		return fmt.Errorf("failed to open device: %w", err)
	}
	defer file.Close()

	size, err := file.Seek(0, io.SeekEnd)
	if err != nil {
		return fmt.Errorf("could not determine device size: %w", err)
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("could not seek to start: %w", err)
	}

	buffer := make([]byte, 4*1024*1024) // 4MB buffer
	for pass := 1; pass <= passes; pass++ {
		var written int64
		for written < size {
			progress <- fmt.Sprintf("Pass %d/%d: %.2f%%", pass, passes, float64(written)*100/float64(size))
			n, err := file.Write(buffer)
			if err != nil {
				if err == io.EOF {
					break
				}
				return fmt.Errorf("write error on pass %d: %w", pass, err)
			}
			written += int64(n)
		}
	}
	progress <- "Overwrite completed."
	return nil
}
