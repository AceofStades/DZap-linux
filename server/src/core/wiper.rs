// Port of server-go/core/wiper.go
use super::drives::{
    Drive, DriveType, MobileDevice, detect_android_devices, detect_storage_drives, log_line,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Shared controls for an in-progress wipe: cancellation + pause flag.
pub struct WipeControls {
    pub cancel: Arc<AtomicBool>,
    pub paused: Arc<AtomicBool>,
}

fn active_wipes() -> &'static Mutex<HashMap<String, Arc<WipeControls>>> {
    static ACTIVE_WIPES: OnceLock<Mutex<HashMap<String, Arc<WipeControls>>>> = OnceLock::new();
    ACTIVE_WIPES.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, Serialize)]
pub struct WipeProgress {
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "deviceModel", skip_serializing_if = "Option::is_none")]
    pub device_model: Option<String>,
    #[serde(default)]
    pub method: String,
    #[serde(rename = "methodName", skip_serializing_if = "Option::is_none")]
    pub method_name: Option<String>,
    pub status: String,
    pub progress: f64,
    #[serde(rename = "currentPass")]
    pub current_pass: i32,
    #[serde(rename = "totalPasses")]
    pub total_passes: i32,
    #[serde(default)]
    pub speed: String,
    #[serde(default)]
    pub eta: String,
    #[serde(rename = "error", skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(rename = "sectorNumber")]
    pub sector_number: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WipeConfig {
    #[serde(rename = "DevicePath", alias = "devicePath", alias = "device_path")]
    pub device_path: String,
    #[serde(rename = "Method", alias = "method")]
    pub method: String,
    #[serde(rename = "DeviceSerial", alias = "deviceSerial", alias = "device_serial", default)]
    pub device_serial: String,
    #[serde(rename = "DeviceType", alias = "deviceType", alias = "device_type", default)]
    pub device_type: String,
    #[serde(rename = "deviceModel", alias = "DeviceModel", alias = "device_model", default)]
    pub device_model: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WipeMethod {
    pub id: String,
    pub name: String,
    pub description: String,
}

fn wipe_method_name(method_id: &str) -> &'static str {
    match method_id {
        "nvme_format" => "Purge: NVMe Format",
        "overwrite_1_pass" => "Clear: 1-Pass Overwrite",
        "sata_secure_erase" => "Purge: ATA Secure Erase",
        "overwrite_3_pass" => "Purge: 3-Pass Overwrite",
        "overwrite_2_pass" => "Clear: 2-Pass Overwrite",
        "android_factory_reset" => "Clear: Factory Reset",
        _ => "Unknown",
    }
}

/// NIST-compliant methods for standard storage.
pub fn get_wipe_methods_for_drive(drive: &Drive) -> Vec<WipeMethod> {
    let m = |id: &str, name: &str, desc: &str| WipeMethod {
        id: id.to_string(),
        name: name.to_string(),
        description: desc.to_string(),
    };
    match drive.drive_type {
        DriveType::Nvme => vec![
            m("nvme_format", "Purge: NVMe Format", "Uses the drive's built-in, high-speed firmware command (NVM Express Format)."),
            m("overwrite_1_pass", "Clear: Overwrite", "Not fully effective for flash media due to wear-leveling and over-provisioning."),
        ],
        DriveType::Ssd => vec![
            m("sata_secure_erase", "Purge: ATA Secure Erase", "Uses the drive's built-in firmware command to reset all memory cells."),
            m("overwrite_1_pass", "Clear: Overwrite", "Not fully effective for flash media due to wear-leveling and over-provisioning."),
        ],
        DriveType::Hdd => vec![
            m("overwrite_1_pass", "Clear: 1-Pass Overwrite", "A single pass of a fixed pattern, per NIST SP 800-88r1 guidelines."),
            m("overwrite_3_pass", "Purge: 3-Pass Overwrite", "Three passes of a pseudorandom pattern, an optional NIST Purge method."),
        ],
        DriveType::Usb | DriveType::Unknown => vec![
            m("overwrite_2_pass", "Clear: 2-Pass Overwrite", "A pattern and its complement, per NIST guidelines for USB/removable media."),
        ],
    }
}

/// NIST-compliant methods for mobile devices.
pub fn get_wipe_methods_for_mobile(device: &MobileDevice) -> Vec<WipeMethod> {
    match device.device_type.as_str() {
        "Android" => vec![WipeMethod {
            id: "android_factory_reset".to_string(),
            name: "Clear: Factory Reset".to_string(),
            description: "Initiates the device's built-in factory data reset, as per NIST guidelines."
                .to_string(),
        }],
        _ => vec![],
    }
}

/// Returns the available wipe methods for a specific device.
pub fn get_wipe_methods(device_path: &str) -> Result<Vec<WipeMethod>, String> {
    let drives =
        detect_storage_drives().map_err(|e| format!("could not detect drives: {e}"))?;

    for drive in &drives {
        if drive.name == device_path {
            return Ok(get_wipe_methods_for_drive(drive));
        }
    }

    // Also check mobile devices
    match detect_android_devices() {
        Ok(devices) => {
            for device in &devices {
                if device.serial == device_path {
                    // device_path is the serial for mobile
                    return Ok(get_wipe_methods_for_mobile(device));
                }
            }
        }
        Err(e) => {
            // Non-fatal, just log it
            println!("could not detect mobile devices: {e}");
        }
    }

    Err(format!("device {device_path} not found"))
}

pub fn sanitize_device(
    config: WipeConfig,
    progress: &tokio::sync::mpsc::UnboundedSender<String>,
) -> Result<(), String> {
    if config.device_type == "Android" {
        return sanitize_android(&config.device_serial, progress);
    }
    sanitize_storage_drive(config, progress)
}

fn sanitize_storage_drive(
    config: WipeConfig,
    progress: &tokio::sync::mpsc::UnboundedSender<String>,
) -> Result<(), String> {
    let drives =
        detect_storage_drives().map_err(|e| format!("could not verify drive status: {e}"))?;

    let target = drives
        .iter()
        .find(|d| d.name == config.device_path)
        .ok_or_else(|| format!("drive {} not found", config.device_path))?;

    if target.is_mounted {
        return Err("cannot wipe a mounted drive".to_string());
    }
    if target.drive_type == DriveType::Ssd && target.is_frozen {
        return Err("drive is in a frozen state".to_string());
    }

    match config.method.as_str() {
        "nvme_format" => sanitize_nvme(&config.device_path, progress),
        "sata_secure_erase" => sanitize_sata(&config.device_path, progress),
        "overwrite_1_pass" => sanitize_overwrite(config, 1, progress),
        "overwrite_3_pass" => sanitize_overwrite(config, 3, progress),
        "overwrite_2_pass" => sanitize_overwrite_two_pass(config, progress),
        other => Err(format!("unknown sanitization method: {other}")),
    }
}

fn sanitize_android(
    serial: &str,
    progress: &tokio::sync::mpsc::UnboundedSender<String>,
) -> Result<(), String> {
    let _ = progress.send(format!(
        "Executing Android Factory Reset (NIST Clear) on device {serial}..."
    ));
    let status = Command::new("adb")
        .args(["-s", serial, "reboot", "recovery"])
        .status()
        .map_err(|e| format!("failed to send reboot to recovery command: {e}"))?;
    if !status.success() {
        return Err(format!(
            "failed to send reboot to recovery command: {status}"
        ));
    }
    let _ = progress.send(
        "Reboot to recovery command sent. The device will now perform a factory reset."
            .to_string(),
    );
    Ok(())
}

fn run_command(cancel: &Arc<AtomicBool>, name: &str, args: &[&str]) -> Result<(), String> {
    // Prepend ionice to the command to set I/O scheduling class to Idle
    let mut child = Command::new("ionice")
        .arg("-c")
        .arg("3")
        .arg(name)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("command {name} failed to start: {e}"))?;

    // Poll the child so we can honour cancellation like Go's CommandContext.
    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("wipe aborted".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut out = String::new();
                if let Some(mut stdout) = child.stdout.take() {
                    let _ = stdout.read_to_string(&mut out);
                }
                if let Some(mut stderr) = child.stderr.take() {
                    let _ = stderr.read_to_string(&mut out);
                }
                if status.success() {
                    return Ok(());
                }
                return Err(format!(
                    "command {name} failed: {status}. Output: {out}"
                ));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => return Err(format!("command {name} failed: {e}")),
        }
    }
}

fn register_wipe(device_path: &str) -> Arc<WipeControls> {
    let controls = Arc::new(WipeControls {
        cancel: Arc::new(AtomicBool::new(false)),
        paused: Arc::new(AtomicBool::new(false)),
    });
    active_wipes()
        .lock()
        .unwrap()
        .insert(device_path.to_string(), controls.clone());
    controls
}

fn unregister_wipe(device_path: &str) {
    active_wipes().lock().unwrap().remove(device_path);
}

fn sanitize_nvme(
    path: &str,
    progress: &tokio::sync::mpsc::UnboundedSender<String>,
) -> Result<(), String> {
    let _ = progress.send("Executing NVMe Format...".to_string());
    let controls = register_wipe(path);
    let result = run_command(&controls.cancel, "nvme", &["format", path, "-s", "1"]);
    unregister_wipe(path);
    result
}

fn sanitize_sata(
    path: &str,
    progress: &tokio::sync::mpsc::UnboundedSender<String>,
) -> Result<(), String> {
    let _ = progress.send("Executing ATA Secure Erase...".to_string());
    let controls = register_wipe(path);
    let result = (|| {
        run_command(
            &controls.cancel,
            "hdparm",
            &["--user-master", "user", "--security-set-pass", "dZap", path],
        )
        .map_err(|e| format!("failed to set security password: {e}"))?;
        let _ = progress.send("Security password set. Issuing erase...".to_string());
        run_command(
            &controls.cancel,
            "hdparm",
            &["--user-master", "user", "--security-erase", "dZap", path],
        )
    })();
    unregister_wipe(path);
    result
}

#[allow(clippy::too_many_arguments)]
fn overwrite_pass(
    controls: &WipeControls,
    config: &WipeConfig,
    pattern: u8,
    pass_num: i32,
    total_passes: i32,
    progress: &tokio::sync::mpsc::UnboundedSender<String>,
) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .open(&config.device_path)
        .map_err(|e| format!("failed to open device: {e}"))?;

    let size = file
        .seek(SeekFrom::End(0))
        .map_err(|e| format!("could not determine device size: {e}"))? as i64;
    log_line(&format!(
        "overwrite_pass pass {pass_num}, device size: {size}"
    ));
    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("could not seek to start: {e}"))?;

    let buffer = vec![pattern; 128 * 1024]; // 128KB buffer

    let mut written: i64 = 0;
    let start_time = Instant::now();
    let mut last_report = Instant::now();

    while written < size {
        if controls.cancel.load(Ordering::SeqCst) {
            return Err("wipe aborted".to_string());
        }
        // Paused: wait for resume or abort signal
        while controls.paused.load(Ordering::SeqCst) {
            if controls.cancel.load(Ordering::SeqCst) {
                return Err("wipe aborted".to_string());
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        match file.write(&buffer) {
            Ok(n) => written += n as i64,
            Err(e) => {
                log_line(&format!(
                    "overwrite_pass pass {pass_num}, write error: {e}"
                ));
                if e.kind() == std::io::ErrorKind::UnexpectedEof
                    || e.to_string().contains("no space left on device")
                {
                    written = size; // Mark as complete
                    break;
                }
                return Err(format!("write error on pass {pass_num}: {e}"));
            }
        }

        if last_report.elapsed() >= Duration::from_millis(500) {
            last_report = Instant::now();
            let elapsed = start_time.elapsed().as_secs_f64();
            if elapsed > 0.0 {
                let speed = written as f64 / elapsed / 1024.0 / 1024.0; // MB/s
                let eta = (size - written) as f64 / (speed * 1024.0 * 1024.0); // seconds

                let pass_progress = written as f64 * 100.0 / size as f64;
                let overall_progress =
                    ((pass_num - 1) as f64 + pass_progress / 100.0) * 100.0 / total_passes as f64;

                let msg = WipeProgress {
                    device_id: config.device_path.clone(),
                    device_model: config.device_model.clone(),
                    method: config.method.clone(),
                    method_name: Some(wipe_method_name(&config.method).to_string()),
                    status: format!("Pass {pass_num}/{total_passes}"),
                    progress: overall_progress,
                    current_pass: pass_num,
                    total_passes,
                    speed: format!("{speed:.2} MB/s"),
                    eta: format!("{eta:.0}s"),
                    error: None,
                    sector_number: written,
                };
                if let Ok(json) = serde_json::to_string(&msg) {
                    let _ = progress.send(json);
                }
            }
        }
    }

    // Final progress update for the pass
    let final_progress = (pass_num as f64 * 100.0) / total_passes as f64;
    let msg = WipeProgress {
        device_id: config.device_path.clone(),
        device_model: None,
        method: config.method.clone(),
        method_name: None,
        status: format!("Pass {pass_num}/{total_passes} complete"),
        progress: final_progress,
        current_pass: pass_num,
        total_passes,
        speed: String::new(),
        eta: String::new(),
        error: None,
        sector_number: written,
    };
    if let Ok(json) = serde_json::to_string(&msg) {
        let _ = progress.send(json);
    }

    Ok(())
}

pub fn abort_wipe(device_id: &str) -> Result<(), String> {
    let mut wipes = active_wipes().lock().unwrap();
    match wipes.get(device_id) {
        Some(controls) => {
            controls.cancel.store(true, Ordering::SeqCst);
            wipes.remove(device_id);
            Ok(())
        }
        None => Err(format!("no active wipe found for device {device_id}")),
    }
}

pub fn pause_wipe(device_id: &str) -> Result<(), String> {
    let wipes = active_wipes().lock().unwrap();
    match wipes.get(device_id) {
        Some(controls) => {
            let was_paused = controls.paused.fetch_xor(true, Ordering::SeqCst);
            log_line(&format!(
                "Wipe for {device_id} {}",
                if was_paused { "resumed" } else { "paused" }
            ));
            Ok(())
        }
        None => Err(format!("no active wipe found for device {device_id}")),
    }
}

fn send_completion(config: &WipeConfig, progress: &tokio::sync::mpsc::UnboundedSender<String>) {
    let completion = WipeProgress {
        device_id: config.device_path.clone(),
        device_model: None,
        method: String::new(),
        method_name: None,
        status: "done".to_string(),
        progress: 100.0,
        current_pass: 0,
        total_passes: 0,
        speed: String::new(),
        eta: String::new(),
        error: None,
        sector_number: 0,
    };
    if let Ok(json) = serde_json::to_string(&completion) {
        let _ = progress.send(json);
    }
}

fn sanitize_overwrite_two_pass(
    config: WipeConfig,
    progress: &tokio::sync::mpsc::UnboundedSender<String>,
) -> Result<(), String> {
    let controls = register_wipe(&config.device_path);
    let result: Result<(), String> = (|| {
        let _ = progress.send("Executing Pass 1/2 (Pattern: 0x55)...".to_string());
        overwrite_pass(&controls, &config, 0x55, 1, 2, progress)?;

        log_line("First pass complete, starting second pass.");

        let _ = progress.send("Executing Pass 2/2 (Pattern: 0xAA)...".to_string());
        overwrite_pass(&controls, &config, 0xAA, 2, 2, progress)?;
        Ok(())
    })();
    unregister_wipe(&config.device_path);
    result?;
    send_completion(&config, progress);
    Ok(())
}

fn sanitize_overwrite(
    config: WipeConfig,
    passes: i32,
    progress: &tokio::sync::mpsc::UnboundedSender<String>,
) -> Result<(), String> {
    let controls = register_wipe(&config.device_path);
    let patterns: [u8; 3] = [0x00, 0xFF, 0x55]; // A simple set of patterns for multi-pass

    let result: Result<(), String> = (|| {
        for i in 1..=passes {
            let pattern = patterns[((i - 1) as usize) % patterns.len()];
            let _ = progress.send(format!(
                "Executing Pass {i}/{passes} (Pattern: 0x{pattern:02X})..."
            ));
            overwrite_pass(&controls, &config, pattern, i, passes, progress)?;
        }
        Ok(())
    })();
    unregister_wipe(&config.device_path);
    result?;
    send_completion(&config, progress);
    Ok(())
}
