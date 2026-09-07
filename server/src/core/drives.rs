// Port of server-go/core/drives.go
use serde::{Deserialize, Serialize};
use std::fmt;
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DriveType {
    Hdd,
    Ssd,
    Nvme,
    Usb,
    /// Mirrors Go's UNKN constant; kept for NIST method mapping of
    /// unknown/removable media even though detection never yields it.
    #[allow(dead_code)]
    Unknown,
}

impl DriveType {
    pub fn as_str(&self) -> &'static str {
        match self {
            DriveType::Hdd => "HDD",
            DriveType::Ssd => "SATA SSD",
            DriveType::Nvme => "NVMe SSD",
            DriveType::Usb => "USB Drive",
            DriveType::Unknown => "Unknown",
        }
    }
}

impl Serialize for DriveType {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl fmt::Display for DriveType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Partition {
    pub name: String,
    pub size: String,
    #[serde(rename = "type")]
    pub fs_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Drive {
    pub name: String,
    pub model: String,
    pub size: String,
    #[serde(rename = "type")]
    pub drive_type: DriveType,
    #[serde(rename = "isMounted")]
    pub is_mounted: bool,
    #[serde(rename = "isFrozen")]
    pub is_frozen: bool,
    #[serde(rename = "isOSDrive")]
    pub is_os_drive: bool,
    pub partitions: Vec<Partition>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MobileDevice {
    pub name: String,
    pub model: String,
    pub serial: String,
    #[serde(rename = "type")]
    pub device_type: String, // e.g., "Android"
}

// internal struct for parsing lsblk output
#[derive(Debug, Clone, Deserialize)]
pub struct LsblkDevice {
    pub name: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub size: Option<i64>,
    #[serde(default)]
    pub rota: Option<bool>,
    #[serde(rename = "type", default)]
    pub dev_type: Option<String>,
    #[serde(default)]
    pub mountpoints: Vec<Option<String>>,
    #[serde(default)]
    pub children: Vec<LsblkDevice>,
    #[serde(default)]
    pub fstype: Option<String>,
    #[serde(default)]
    pub tran: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LsblkOutput {
    blockdevices: Vec<LsblkDevice>,
}

/// Main entry point for finding all supported hardware.
pub fn detect_devices() -> serde_json::Value {
    let storage_drives = match detect_storage_drives() {
        Ok(drives) => serde_json::to_value(drives).unwrap_or(serde_json::Value::Null),
        Err(e) => {
            println!("Warning: Could not detect storage drives: {e}");
            serde_json::Value::Null
        }
    };

    let mobile_devices = match detect_android_devices() {
        Ok(devices) => serde_json::to_value(devices).unwrap_or(serde_json::Value::Null),
        Err(e) => {
            println!("Warning: Could not detect Android devices: {e}");
            serde_json::Value::Null
        }
    };

    serde_json::json!({
        "storage": storage_drives,
        "mobile": mobile_devices,
    })
}

pub fn detect_storage_drives() -> Result<Vec<Drive>, String> {
    let out = Command::new("lsblk")
        .args(["-J", "-b", "-o", "NAME,MODEL,SIZE,ROTA,TYPE,MOUNTPOINTS,FSTYPE,TRAN"])
        .output()
        .map_err(|e| format!("lsblk command failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "lsblk command failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    let lsblk_data: LsblkOutput = serde_json::from_slice(&out.stdout)
        .map_err(|e| format!("failed to parse lsblk JSON: {e}"))?;

    let mut drives = Vec::new();
    for dev in &lsblk_data.blockdevices {
        let dev_type = dev.dev_type.as_deref().unwrap_or("");
        if dev_type != "disk" && dev_type != "rom" {
            continue;
        }

        let first_mount = dev.mountpoints.first().and_then(|m| m.as_deref());
        let mut is_mounted = first_mount.is_some_and(|m| !m.is_empty());
        let mut is_os_drive = dev
            .mountpoints
            .iter()
            .flatten()
            .any(|mp| mp == "/");

        let mut partitions = Vec::new();
        for child in &dev.children {
            if child
                .mountpoints
                .first()
                .and_then(|m| m.as_deref())
                .is_some_and(|m| !m.is_empty())
            {
                is_mounted = true;
            }
            if child.mountpoints.iter().flatten().any(|mp| mp == "/") {
                is_os_drive = true;
            }
            partitions.push(Partition {
                name: format!("/dev/{}", child.name),
                size: child.size.unwrap_or(0).to_string(),
                fs_type: child.fstype.clone().unwrap_or_default(),
            });
        }

        let mut drive = Drive {
            name: format!("/dev/{}", dev.name),
            model: dev
                .model
                .as_deref()
                .unwrap_or("")
                .trim()
                .to_string(),
            size: dev.size.unwrap_or(0).to_string(),
            drive_type: determine_drive_type(dev),
            is_mounted,
            is_frozen: false,
            is_os_drive,
            partitions,
        };

        if drive.drive_type == DriveType::Ssd
            && let Ok(frozen) = is_drive_frozen(&drive.name)
        {
            drive.is_frozen = frozen;
        }
        drives.push(drive);
    }
    Ok(drives)
}

pub fn unmount_device(device_path: &str) -> Result<(), String> {
    log_line(&format!("Attempting to unmount device: {device_path}"));

    let out = Command::new("lsblk")
        .args(["-J", "-o", "NAME,MOUNTPOINTS"])
        .output()
        .map_err(|e| format!("lsblk command failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "lsblk command failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    let lsblk_data: LsblkOutput = serde_json::from_slice(&out.stdout)
        .map_err(|e| format!("failed to parse lsblk JSON: {e}"))?;

    let target = lsblk_data
        .blockdevices
        .iter()
        .find(|dev| format!("/dev/{}", dev.name) == device_path)
        .ok_or_else(|| format!("device {device_path} not found in lsblk output"))?;

    let mut unmount_errors: Vec<String> = Vec::new();

    // Unmount partitions (children)
    for child in &target.children {
        for mp in child.mountpoints.iter().flatten() {
            if !mp.is_empty() {
                unmount_one(&child.name, mp, &mut unmount_errors);
            }
        }
    }

    // Unmount the device itself
    for mp in target.mountpoints.iter().flatten() {
        if !mp.is_empty() {
            unmount_one(&target.name, mp, &mut unmount_errors);
        }
    }

    if !unmount_errors.is_empty() {
        return Err(unmount_errors.join("; "));
    }

    log_line(&format!(
        "Successfully processed unmount request for {device_path}"
    ));
    Ok(())
}

fn unmount_one(name: &str, mountpoint: &str, errors: &mut Vec<String>) {
    log_line(&format!(
        "Attempting to unmount partition {name} from {mountpoint}"
    ));
    match Command::new("umount").arg(mountpoint).output() {
        Ok(out) if out.status.success() => {
            log_line(&format!("Successfully unmounted {mountpoint}"));
        }
        Ok(out) => {
            let msg = format!(
                "failed to unmount {mountpoint}: {}. Output: {}",
                out.status,
                String::from_utf8_lossy(&out.stderr)
            );
            log_line(&msg);
            errors.push(msg);
        }
        Err(e) => {
            let msg = format!("failed to unmount {mountpoint}: {e}");
            log_line(&msg);
            errors.push(msg);
        }
    }
}

pub fn detect_android_devices() -> Result<Vec<MobileDevice>, String> {
    let out = Command::new("adb")
        .arg("devices")
        .output()
        // This is not a fatal error; adb might just not be installed.
        .map_err(|e| format!("adb command not found or failed: {e}"))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut devices = Vec::new();
    // Skip the "List of devices attached" header
    for line in stdout.lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() == 2 && fields[1] == "device" {
            let serial = fields[0];
            let model_out = Command::new("adb")
                .args(["-s", serial, "shell", "getprop", "ro.product.model"])
                .output();
            let Ok(model_out) = model_out else {
                continue; // Skip if we can't get the model
            };
            let model = String::from_utf8_lossy(&model_out.stdout)
                .trim()
                .to_string();

            devices.push(MobileDevice {
                name: model.clone(),
                model,
                serial: serial.to_string(),
                device_type: "Android".to_string(),
            });
        }
    }

    Ok(devices)
}

fn determine_drive_type(dev: &LsblkDevice) -> DriveType {
    if dev.name.starts_with("nbd") {
        return DriveType::Hdd;
    }
    if dev.tran.as_deref() == Some("usb") {
        return DriveType::Usb;
    }
    if dev.name.starts_with("nvme") {
        return DriveType::Nvme;
    }
    if dev.rota.unwrap_or(false) {
        DriveType::Hdd
    } else {
        DriveType::Ssd
    }
}

fn is_drive_frozen(device_path: &str) -> Result<bool, String> {
    let out = Command::new("hdparm")
        .args(["-I", device_path])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("hdparm failed: {}", out.status));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Security:") && trimmed.contains("frozen") {
            return Ok(true);
        }
    }
    Ok(false)
}

pub(crate) fn log_line(msg: &str) {
    eprintln!("{} {msg}", chrono::Utc::now().format("%Y/%m/%d %H:%M:%S"));
}
