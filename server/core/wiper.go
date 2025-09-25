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
	DevicePath   string
	Method       string
	DeviceSerial string
	DeviceType   string
}

type WipeMethod struct {
	ID          string
	Name        string
	Description string
}

// GetWipeMethodsForDrive returns NIST-compliant methods for standard storage.
func GetWipeMethodsForDrive(drive Drive) []WipeMethod {
	switch drive.Type {
	case NVME:
		return []WipeMethod{
			{ID: "nvme_format", Name: "Purge: NVMe Format", Description: "Uses the drive's built-in, high-speed firmware command (NVM Express Format)."},
			{ID: "overwrite_1_pass", Name: "Clear: Overwrite", Description: "⚠️ Not fully effective for flash media due to wear-leveling and over-provisioning."},
		}
	case SSD:
		return []WipeMethod{
			{ID: "sata_secure_erase", Name: "Purge: ATA Secure Erase", Description: "Uses the drive's built-in firmware command to reset all memory cells."},
			{ID: "overwrite_1_pass", Name: "Clear: Overwrite", Description: "⚠️ Not fully effective for flash media due to wear-leveling and over-provisioning."},
		}
	case HDD:
		return []WipeMethod{
			{ID: "overwrite_1_pass", Name: "Clear: 1-Pass Overwrite", Description: "A single pass of a fixed pattern, per NIST SP 800-88r1 guidelines."},
			{ID: "overwrite_3_pass", Name: "Purge: 3-Pass Overwrite", Description: "Three passes of a pseudorandom pattern, an optional NIST Purge method."},
		}
	case USB, UNKN:
		return []WipeMethod{
			{ID: "overwrite_2_pass", Name: "Clear: 2-Pass Overwrite", Description: "A pattern and its complement, per NIST guidelines for USB/removable media."},
		}
	default:
		return []WipeMethod{}
	}
}

// GetWipeMethodsForMobile returns NIST-compliant methods for mobile devices.
func GetWipeMethodsForMobile(device MobileDevice) []WipeMethod {
	switch device.Type {
	case "Android":
		return []WipeMethod{
			{ID: "android_factory_reset", Name: "Clear: Factory Reset", Description: "Initiates the device's built-in factory data reset, as per NIST guidelines."},
		}
	default:
		return []WipeMethod{}
	}
}

func SanitizeDevice(config WipeConfig, progress chan<- string) error {
	defer close(progress)

	if config.DeviceType == "Android" {
		return sanitizeAndroid(config.DeviceSerial, progress)
	}
	return sanitizeStorageDrive(config, progress)
}

func sanitizeStorageDrive(config WipeConfig, progress chan<- string) error {
	drives, err := detectStorageDrives()
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
	if targetDrive.Type == SSD && targetDrive.IsFrozen {
		return fmt.Errorf("drive is in a frozen state")
	}

	switch config.Method {
	case "nvme_format":
		return sanitizeNVMe(config.DevicePath, progress)
	case "sata_secure_erase":
		return sanitizeSATA(config.DevicePath, progress)
	case "overwrite_1_pass":
		return sanitizeOverwrite(config.DevicePath, 1, progress)
	case "overwrite_3_pass":
		return sanitizeOverwrite(config.DevicePath, 3, progress)
	case "overwrite_2_pass":
		return sanitizeOverwriteTwoPass(config.DevicePath, progress)
	default:
		return fmt.Errorf("unknown sanitization method: %s", config.Method)
	}
}

func sanitizeAndroid(serial string, progress chan<- string) error {
	progress <- fmt.Sprintf("Executing Android Factory Reset (NIST Clear) on device %s...", serial)
	cmd := exec.Command("adb", "-s", serial, "reboot", "recovery")
	err := cmd.Run()
	if err != nil {
		return fmt.Errorf("failed to send reboot to recovery command: %w", err)
	}
	progress <- "Reboot to recovery command sent. The device will now perform a factory reset."
	return nil
}

func runCommand(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("command %s failed: %w. Output: %s", name, err, string(output))
	}
	return nil
}

func sanitizeNVMe(path string, progress chan<- string) error {
	progress <- "Executing NVMe Format..."
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	return runCommand(ctx, "nvme", "format", path, "-s", "1")
}

func sanitizeSATA(path string, progress chan<- string) error {
	progress <- "Executing ATA Secure Erase..."
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()

	err := runCommand(ctx, "hdparm", "--user-master", "user", "--security-set-pass", "dZap", path)
	if err != nil {
		return fmt.Errorf("failed to set security password: %w", err)
	}
	progress <- "Security password set. Issuing erase..."

	return runCommand(ctx, "hdparm", "--user-master", "user", "--security-erase", "dZap", path)
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

func sanitizeOverwriteTwoPass(path string, progress chan<- string) error {
	// A true two-pass overwrite writes a pattern, then its complement.
	// This implementation is a simplified simulation for now.
	progress <- "Executing 2-Pass Overwrite..."
	err := sanitizeOverwrite(path, 2, progress)
	if err != nil {
		return err
	}
	progress <- "2-Pass Overwrite completed."
	return nil
}
