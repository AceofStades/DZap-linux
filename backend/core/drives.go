// dzap-backend/core/detection.go
package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os/exec"
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

type Drive struct {
	Name      string    `json:"name"`
	Model     string    `json:"model"`
	Size      string    `json:"size"`
	Type      DriveType `json:"type"`
	IsMounted bool      `json:"isMounted"`
	IsFrozen  bool      `json:"isFrozen"`
}

type lsblkOutput struct {
	BlockDevices []struct {
		Name       string `json:"name"`
		Model      string `json:"model"`
		Size       string `json:"size"`
		Rotational bool   `json:"rota"`
		Type       string `json:"type"`
		MountPoint string `json:"mountpoint"`
	} `json:"blockdevices"`
}

func DetectDrives() ([]Drive, error) {
	cmd := exec.Command("lsblk", "-J", "-b", "-o", "NAME,MODEL,SIZE,ROTA,TYPE,MOUNTPOINT")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("lsblk failed: %w", err)
	}

	var lsblkData lsblkOutput
	if err := json.Unmarshal(out, &lsblkData); err != nil {
		return nil, err
	}

	var drives []Drive
	for _, dev := range lsblkData.BlockDevices {
		if dev.Type != "disk" && dev.Type != "rom" {
			continue
		}

		drive := Drive{
			Name:      "/dev/" + dev.Name,
			Model:     strings.TrimSpace(dev.Model),
			Size:      dev.Size,
			IsMounted: dev.MountPoint != "",
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

func (d *Drive) determineDriveType(name string, isRotational bool) {
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

// isDriveFrozen checks the output of hdparm for the "frozen" state.
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
