package core

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// WipeControls holds the channels for controlling a wipe process.
type WipeControls struct {
	cancel context.CancelFunc
	pause  chan bool
	paused bool
}

var (
	activeWipes = make(map[string]*WipeControls)
	wipeMutex   = &sync.Mutex{}
)

type WipeProgress struct {
	DeviceID     string  `json:"deviceId"`
	DeviceModel  string  `json:"deviceModel,omitempty"`
	Method       string  `json:"method"`
	MethodName   string  `json:"methodName,omitempty"`
	Status       string  `json:"status"`
	Progress     float64 `json:"progress"`
	CurrentPass  int     `json:"currentPass"`
	TotalPasses  int     `json:"totalPasses"`
	Speed        string  `json:"speed"` // MB/s
	ETA          string  `json:"eta"`   // seconds
	Error        string  `json:"error,omitempty"`
	SectorNumber int64   `json:"sectorNumber"`
}

type WipeConfig struct {
	DevicePath   string
	Method       string
	DeviceSerial string
	DeviceType   string
	DeviceModel  string `json:"deviceModel,omitempty"`
}

type WipeMethod struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

var wipeMethodNames = map[string]string{
	"nvme_format":           "Purge: NVMe Format",
	"overwrite_1_pass":      "Clear: 1-Pass Overwrite",
	"sata_secure_erase":     "Purge: ATA Secure Erase",
	"overwrite_3_pass":      "Purge: 3-Pass Overwrite",
	"overwrite_2_pass":      "Clear: 2-Pass Overwrite",
	"android_factory_reset": "Clear: Factory Reset",
}

func getWipeMethodName(methodId string) string {
	if name, ok := wipeMethodNames[methodId]; ok {
		return name
	}
	return "Unknown"
}

// GetWipeMethodsForDrive returns NIST-compliant methods for standard storage.
func GetWipeMethodsForDrive(drive Drive) []WipeMethod {
	switch drive.Type {
	case NVME:
		return []WipeMethod{
			{ID: "nvme_format", Name: "Purge: NVMe Format", Description: "Uses the drive's built-in, high-speed firmware command (NVM Express Format)."},
			{ID: "overwrite_1_pass", Name: "Clear: Overwrite", Description: "Not fully effective for flash media due to wear-leveling and over-provisioning."},
		}
	case SSD:
		return []WipeMethod{
			{ID: "sata_secure_erase", Name: "Purge: ATA Secure Erase", Description: "Uses the drive's built-in firmware command to reset all memory cells."},
			{ID: "overwrite_1_pass", Name: "Clear: Overwrite", Description: "Not fully effective for flash media due to wear-leveling and over-provisioning."},
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

// GetWipeMethods returns the available wipe methods for a specific device.
func GetWipeMethods(devicePath string) ([]WipeMethod, error) {
	drives, err := detectStorageDrives()
	if err != nil {
		return nil, fmt.Errorf("could not detect drives: %w", err)
	}

	for _, drive := range drives {
		if drive.Name == devicePath {
			return GetWipeMethodsForDrive(drive), nil
		}
	}

	// Also check mobile devices
	mobileDevices, err := detectAndroidDevices()
	if err != nil {
		// Non-fatal, just log it
		fmt.Printf("could not detect mobile devices: %v", err)
	}
	for _, device := range mobileDevices {
		if device.Serial == devicePath { // Assuming devicePath is the serial for mobile
			return GetWipeMethodsForMobile(device), nil
		}
	}

	return nil, fmt.Errorf("device %s not found", devicePath)
}

func SanitizeDevice(config WipeConfig, progress chan<- string) error {
	if config.DeviceType == "Android" {
		return sanitizeAndroid(config.DeviceSerial, progress)
	}
	return sanitizeStorageDrive(config, progress)
}

func sanitizeStorageDrive(config WipeConfig, progress chan<- string) error {
	ctx, cancel := context.WithCancel(context.Background())

	controls := &WipeControls{
		cancel: cancel,
		pause:  make(chan bool), // Assuming pause is handled elsewhere or not needed for all paths
	}
	wipeMutex.Lock()
	activeWipes[config.DevicePath] = controls
	wipeMutex.Unlock()

	// Defer the cancellation and cleanup
	defer func() {
		cancel() // Ensure context is always cancelled
		wipeMutex.Lock()
		delete(activeWipes, config.DevicePath)
		wipeMutex.Unlock()
	}()
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
		return sanitizeNVMe(ctx, config, progress)
	case "sata_secure_erase":
		return sanitizeSATA(ctx, config, progress)
	case "overwrite_1_pass":
		return sanitizeOverwrite(ctx, controls, config, 1, progress)
	case "overwrite_3_pass":
		return sanitizeOverwrite(ctx, controls, config, 3, progress)
	case "overwrite_2_pass":
		return sanitizeOverwriteTwoPass(ctx, controls, config, progress)
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
	// Prepend ionice to the command to set I/O scheduling class to Idle
	fullArgs := append([]string{"-c", "3", name}, args...)
	cmd := exec.CommandContext(ctx, "ionice", fullArgs...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("command %s failed: %w. Output: %s", name, err, string(output))
	}
	return nil
}

func sanitizeNVMe(path string, progress chan<- string) error {
	progress <- "Executing NVMe Format..."
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	controls := &WipeControls{
		cancel: cancel,
		pause:  make(chan bool), // Not used for this method, but required by struct
	}
	wipeMutex.Lock()
	activeWipes[path] = controls
	wipeMutex.Unlock()

	defer func() {
		wipeMutex.Lock()
		delete(activeWipes, path)
		wipeMutex.Unlock()
	}()

	return runCommand(ctx, "nvme", "format", path, "-s", "1")
}

func sanitizeSATA(path string, progress chan<- string) error {
	progress <- "Executing ATA Secure Erase..."
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	controls := &WipeControls{
		cancel: cancel,
		pause:  make(chan bool), // Not used, but required by struct
	}
	wipeMutex.Lock()
	activeWipes[path] = controls
	wipeMutex.Unlock()

	defer func() {
		wipeMutex.Lock()
		delete(activeWipes, path)
		wipeMutex.Unlock()
	}()

	err := runCommand(ctx, "hdparm", "--user-master", "user", "--security-set-pass", "dZap", path)
	if err != nil {
		return fmt.Errorf("failed to set security password: %w", err)
	}
	progress <- "Security password set. Issuing erase..."

	return runCommand(ctx, "hdparm", "--user-master", "user", "--security-erase", "dZap", path)
}

func overwritePass(ctx context.Context, controls *WipeControls, config WipeConfig, pattern byte, passNum int, totalPasses int, progress chan<- string) error {
	file, err := os.OpenFile(config.DevicePath, os.O_WRONLY, 0)
	if err != nil {
		return fmt.Errorf("failed to open device: %w", err)
	}
	defer file.Close()

	size, err := file.Seek(0, io.SeekEnd)
	if err != nil {
		return fmt.Errorf("could not determine device size: %w", err)
	}
	log.Printf("overwritePass pass %d, device size: %d", passNum, size)
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("could not seek to start: %w", err)
	}

	buffer := make([]byte, 128*1024) // 128KB buffer
	for i := range buffer {
		buffer[i] = pattern
	}

	var written int64
	startTime := time.Now()

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	writeDone := make(chan int, 1)
	errChan := make(chan error, 1)
	writing := false

	for written < size {
		if !writing {
			go func() {
				n, err := file.Write(buffer)
				if err != nil {
					errChan <- err
					return
				}
				writeDone <- n
			}()
			writing = true
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case paused := <-controls.pause:
			if paused {
				// Paused: wait for resume signal
				<-controls.pause
			}
		case n := <-writeDone:
			written += int64(n)
			writing = false
		case err := <-errChan:
			log.Printf("overwritePass pass %d, write error: %v", passNum, err)
			if err == io.EOF || (err != nil && strings.Contains(err.Error(), "no space left on device")) {
				written = size // Mark as complete
				break
			}
			return fmt.Errorf("write error on pass %d: %w", passNum, err)
		case <-ticker.C:
			elapsed := time.Since(startTime).Seconds()
			if elapsed > 0 {
				speed := float64(written) / elapsed / 1024 / 1024      // MB/s
				eta := (float64(size-written) / (speed * 1024 * 1024)) // seconds

				passProgress := float64(written) * 100 / float64(size)
				overallProgress := (float64(passNum-1) + passProgress/100) * 100 / float64(totalPasses)

				progressMsg := WipeProgress{
					DeviceID:     config.DevicePath,
					DeviceModel:  config.DeviceModel,
					Method:       config.Method,
					MethodName:   getWipeMethodName(config.Method),
					Status:       fmt.Sprintf("Pass %d/%d", passNum, totalPasses),
					Progress:     overallProgress,
					CurrentPass:  passNum,
					TotalPasses:  totalPasses,
					Speed:        fmt.Sprintf("%.2f MB/s", speed),
					ETA:          fmt.Sprintf("%.0fs", eta),
					SectorNumber: written,
				}
				jsonMsg, _ := json.Marshal(progressMsg)
				progress <- string(jsonMsg)
			}
		}
	}

	// Final progress update for the pass
	finalProgress := (float64(passNum) * 100) / float64(totalPasses)
	progressMsg := WipeProgress{
		DeviceID:     config.DevicePath,
		Method:       config.Method,
		Status:       fmt.Sprintf("Pass %d/%d complete", passNum, totalPasses),
		Progress:     finalProgress,
		CurrentPass:  passNum,
		TotalPasses:  totalPasses,
		SectorNumber: written,
	}
	jsonMsg, _ := json.Marshal(progressMsg)
	progress <- string(jsonMsg)

	return nil
}

func AbortWipe(deviceId string) error {
	wipeMutex.Lock()
	defer wipeMutex.Unlock()

	controls, ok := activeWipes[deviceId]
	if !ok {
		return fmt.Errorf("no active wipe found for device %s", deviceId)
	}

	controls.cancel()
	delete(activeWipes, deviceId)
	return nil
}

func PauseWipe(deviceId string) error {
	wipeMutex.Lock()
	defer wipeMutex.Unlock()

	controls, ok := activeWipes[deviceId]
	if !ok {
		return fmt.Errorf("no active wipe found for device %s", deviceId)
	}

	controls.paused = !controls.paused
	controls.pause <- controls.paused
	return nil
}

func sanitizeOverwriteTwoPass(config WipeConfig, progress chan<- string) error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	controls := &WipeControls{
		cancel: cancel,
		pause:  make(chan bool),
	}
	wipeMutex.Lock()
	activeWipes[config.DevicePath] = controls
	wipeMutex.Unlock()

	defer func() {
		wipeMutex.Lock()
		delete(activeWipes, config.DevicePath)
		wipeMutex.Unlock()
	}()
	progress <- "Executing Pass 1/2 (Pattern: 0x55)..."
	if err := overwritePass(ctx, controls, config, 0x55, 1, 2, progress); err != nil {
		return err
	}

	log.Println("First pass complete, starting second pass.")

	progress <- "Executing Pass 2/2 (Pattern: 0xAA)..."
	if err := overwritePass(ctx, controls, config, 0xAA, 2, 2, progress); err != nil {
		return err
	}

	completion := WipeProgress{
		DeviceID: config.DevicePath,
		Status:   "done",
		Progress: 100,
	}
	jsonMsg, _ := json.Marshal(completion)
	progress <- string(jsonMsg)
	return nil
}

func sanitizeOverwrite(config WipeConfig, passes int, progress chan<- string) error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	controls := &WipeControls{
		cancel: cancel,
		pause:  make(chan bool),
	}
	wipeMutex.Lock()
	activeWipes[config.DevicePath] = controls
	wipeMutex.Unlock()

	defer func() {
		wipeMutex.Lock()
		delete(activeWipes, config.DevicePath)
		wipeMutex.Unlock()
	}()
	patterns := []byte{0x00, 0xFF, 0x55} // A simple set of patterns for multi-pass

	for i := 1; i <= passes; i++ {
		pattern := patterns[(i-1)%len(patterns)]
		progress <- fmt.Sprintf("Executing Pass %d/%d (Pattern: 0x%02X)...", i, passes, pattern)
		if err := overwritePass(ctx, controls, config, pattern, i, passes, progress); err != nil {
			return err
		}
	}
	completion := WipeProgress{
		DeviceID: config.DevicePath,
		Status:   "done",
		Progress: 100,
	}
	jsonMsg, _ := json.Marshal(completion)
	progress <- string(jsonMsg)
	return nil
}
