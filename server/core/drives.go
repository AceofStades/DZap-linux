// server/core/drives.go
package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

type DriveType string

const (
	HDD  DriveType = "HDD"
	SSD  DriveType = "SATA SSD"
	NVME DriveType = "NVMe SSD"
	USB  DriveType = "USB Drive"
	UNKN DriveType = "Unknown"
)

type Partition struct {
	Name string `json:"name"`
	Size string `json:"size"`
	Type string `json:"type"`
}

type Drive struct {
	Name       string      `json:"name"`
	Model      string      `json:"model"`
	Size       string      `json:"size"`
	Type       DriveType   `json:"type"`
	IsMounted  bool        `json:"isMounted"`
	IsFrozen   bool        `json:"isFrozen"`
	Partitions []Partition `json:"partitions"`
}

type MobileDevice struct {
	Name   string `json:"name"`
	Model  string `json:"model"`
	Serial string `json:"serial"`
	Type   string `json:"type"` // e.g., "Android"
}

// internal struct for parsing lsblk output
type lsblkDevice struct {
	Name       string        `json:"name"`
	Model      string        `json:"model"`
	Size       int64         `json:"size"`
	Rotational bool          `json:"rota"`
	Type       string        `json:"type"`
	MountPoint string        `json:"mountpoint"`
	Children   []lsblkDevice `json:"children"`
	FsType     string        `json:"fstype"`
}

type lsblkOutput struct {
	BlockDevices []lsblkDevice `json:"blockdevices"`
}

// DetectDevices is the main entry point for finding all supported hardware.
func DetectDevices() (map[string]interface{}, error) {
	allDevices := make(map[string]interface{})

	storageDrives, err := detectStorageDrives()
	if err != nil {
		fmt.Printf("Warning: Could not detect storage drives: %v\n", err)
	}
	allDevices["storage"] = storageDrives

	mobileDevices, err := detectAndroidDevices()
	if err != nil {
		fmt.Printf("Warning: Could not detect Android devices: %v\n", err)
	}
	allDevices["mobile"] = mobileDevices

	return allDevices, nil
}

func detectStorageDrives() ([]Drive, error) {
	cmd := exec.Command("lsblk", "-J", "-b", "-o", "NAME,MODEL,SIZE,ROTA,TYPE,MOUNTPOINT,FSTYPE")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("lsblk command failed: %w", err)
	}

	var lsblkData lsblkOutput
	if err := json.Unmarshal(out, &lsblkData); err != nil {
		return nil, fmt.Errorf("failed to parse lsblk JSON: %w", err)
	}

	var drives []Drive
	for _, dev := range lsblkData.BlockDevices {
		if dev.Type != "disk" && dev.Type != "rom" {
			continue
		}

		isMounted := dev.MountPoint != ""
		var partitions []Partition
		for _, child := range dev.Children {
			if child.MountPoint != "" {
				isMounted = true
			}
			partitions = append(partitions, Partition{
				Name: "/dev/" + child.Name,
				Size: strconv.FormatInt(child.Size, 10),
				Type: child.FsType,
			})
		}

		drive := Drive{
			Name:       "/dev/" + dev.Name,
			Model:      strings.TrimSpace(dev.Model),
			Size:       strconv.FormatInt(dev.Size, 10),
			IsMounted:  isMounted,
			Partitions: partitions,
		}
		drive.determineDriveType(dev.Name, dev.Rotational)

		if drive.Type == SSD {
			frozen, _ := isDriveFrozen(drive.Name)
			drive.IsFrozen = frozen
		}
		drives = append(drives, drive)
	}
	return drives, nil
}

func detectAndroidDevices() ([]MobileDevice, error) {
	cmd := exec.Command("adb", "devices")
	out, err := cmd.Output()
	if err != nil {
		// This is not a fatal error; adb might just not be installed.
		return []MobileDevice{}, fmt.Errorf("adb command not found or failed: %w", err)
	}

	lines := strings.Split(string(out), "\n")
	var devices []MobileDevice
	// Start from line 1 to skip the "List of devices attached" header
	for _, line := range lines[1:] {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[1] == "device" {
			serial := fields[0]
			modelCmd := exec.Command("adb", "-s", serial, "shell", "getprop", "ro.product.model")
			modelOut, err := modelCmd.Output()
			if err != nil {
				continue // Skip if we can't get the model
			}
			model := strings.TrimSpace(string(modelOut))

			devices = append(devices, MobileDevice{
				Name:   model,
				Model:  model,
				Serial: serial,
				Type:   "Android",
			})
		}
	}

	return devices, nil
}

func (d *Drive) determineDriveType(name string, isRotational bool) {
	if strings.HasPrefix(name, "nbd") {
		d.Type = UNKN
		return
	}
	if strings.HasPrefix(name, "nvme") {
		d.Type = NVME
		return
	}
	if strings.Contains(strings.ToLower(d.Model), "usb") {
		d.Type = USB
		return
	}
	if isRotational {
		d.Type = HDD
	} else {
		d.Type = SSD
	}
}

func isDriveFrozen(devicePath string) (bool, error) {
	cmd := exec.Command("hdparm", "-I", devicePath)
	var out bytes.Buffer
	cmd.Stdout = &out
	err := cmd.Run()
	if err != nil {
		return false, err
	}

	output := out.String()
	for _, line := range strings.Split(output, "\n") {
		trimmedLine := strings.TrimSpace(line)
		if strings.HasPrefix(trimmedLine, "Security:") {
			if strings.Contains(trimmedLine, "frozen") {
				return true, nil
			}
		}
	}
	return false, nil
}
