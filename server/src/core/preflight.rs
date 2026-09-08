use serde::Serialize;

use super::drives::{
    DeviceIdentity, Drive, MobileDevice, detect_android_devices, detect_storage_drives,
};
use super::wiper::{WipeConfig, get_wipe_methods_for_drive, get_wipe_methods_for_mobile};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PreflightDecision {
    Ready,
    Blocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PreflightCheckStatus {
    Passed,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightCheck {
    pub code: String,
    pub status: PreflightCheckStatus,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WipePlan {
    pub decision: PreflightDecision,
    pub device_path: String,
    pub device_model: String,
    pub device_type: String,
    pub method: String,
    pub identity: Option<DeviceIdentity>,
    pub checks: Vec<PreflightCheck>,
}

impl WipePlan {
    pub fn is_ready(&self) -> bool {
        self.decision == PreflightDecision::Ready
    }

    pub fn blocking_message(&self) -> String {
        self.checks
            .iter()
            .filter(|check| check.status == PreflightCheckStatus::Blocked)
            .map(|check| check.message.as_str())
            .collect::<Vec<_>>()
            .join("; ")
    }
}

fn check(
    code: &str,
    passed: bool,
    passed_message: &str,
    blocked_message: String,
) -> PreflightCheck {
    PreflightCheck {
        code: code.to_string(),
        status: if passed {
            PreflightCheckStatus::Passed
        } else {
            PreflightCheckStatus::Blocked
        },
        message: if passed {
            passed_message.to_string()
        } else {
            blocked_message
        },
    }
}

fn finish_plan(
    config: &WipeConfig,
    device_model: String,
    device_type: String,
    identity: Option<DeviceIdentity>,
    checks: Vec<PreflightCheck>,
) -> WipePlan {
    let decision = if checks
        .iter()
        .any(|check| check.status == PreflightCheckStatus::Blocked)
    {
        PreflightDecision::Blocked
    } else {
        PreflightDecision::Ready
    };

    WipePlan {
        decision,
        device_path: config.device_path.clone(),
        device_model,
        device_type,
        method: config.method.clone(),
        identity,
        checks,
    }
}

fn missing_device_plan(config: &WipeConfig, identifier: &str) -> WipePlan {
    finish_plan(
        config,
        config.device_model.clone().unwrap_or_default(),
        config.device_type.clone(),
        None,
        vec![check(
            "device_exists",
            false,
            "Device is present.",
            format!("Device {identifier} was not found during preflight."),
        )],
    )
}

fn identity_check(config: &WipeConfig, detected: &DeviceIdentity) -> PreflightCheck {
    match &config.expected_identity {
        Some(expected) => check(
            "device_identity",
            expected == detected,
            "Device identity matches the approved preflight plan.",
            "Device identity changed after preflight. Review the device and confirm it again."
                .to_string(),
        ),
        None => check(
            "device_identity",
            false,
            "Device identity matches the approved preflight plan.",
            "No approved device identity was supplied. Run preflight and confirm the device again."
                .to_string(),
        ),
    }
}

fn evaluate_storage_wipe_with_identity(
    config: &WipeConfig,
    drive: &Drive,
    require_identity: bool,
) -> WipePlan {
    let supported_methods = get_wipe_methods_for_drive(drive);
    let method_supported = supported_methods
        .iter()
        .any(|method| method.id == config.method);
    let supported_ids = supported_methods
        .iter()
        .map(|method| method.id.as_str())
        .collect::<Vec<_>>()
        .join(", ");

    let detected_identity = drive.identity();
    let mut checks = vec![
        check("device_exists", true, "Device is present.", String::new()),
        check(
            "method_supported",
            method_supported,
            "Requested wipe method is supported for this device type.",
            format!(
                "Method {} is not supported for {}. Supported methods: {}.",
                config.method, drive.drive_type, supported_ids
            ),
        ),
        check(
            "os_drive",
            !drive.is_os_drive,
            "Device does not contain the running operating system.",
            "The running operating-system drive cannot be wiped.".to_string(),
        ),
        check(
            "mounted",
            !drive.is_mounted,
            "Device and its partitions are unmounted.",
            "The device or one of its partitions is mounted.".to_string(),
        ),
        check(
            "frozen",
            !(drive.drive_type == super::drives::DriveType::Ssd && drive.is_frozen),
            "Device is not in an ATA security-frozen state.",
            "The SATA SSD is in an ATA security-frozen state.".to_string(),
        ),
    ];
    if require_identity {
        checks.push(identity_check(config, &detected_identity));
    }

    finish_plan(
        config,
        drive.model.clone(),
        drive.drive_type.to_string(),
        Some(detected_identity),
        checks,
    )
}

pub fn evaluate_storage_wipe(config: &WipeConfig, drive: &Drive) -> WipePlan {
    evaluate_storage_wipe_with_identity(config, drive, false)
}

pub fn authorize_storage_wipe(config: &WipeConfig, drive: &Drive) -> WipePlan {
    evaluate_storage_wipe_with_identity(config, drive, true)
}

fn evaluate_mobile_wipe_with_identity(
    config: &WipeConfig,
    device: &MobileDevice,
    require_identity: bool,
) -> WipePlan {
    let method_supported = get_wipe_methods_for_mobile(device)
        .iter()
        .any(|method| method.id == config.method);
    let detected_identity = device.identity();
    let mut checks = vec![
        check(
            "device_exists",
            true,
            "Device is present and available through ADB.",
            String::new(),
        ),
        check(
            "method_supported",
            method_supported,
            "Requested wipe method is supported for this device type.",
            format!(
                "Method {} is not supported for {} devices.",
                config.method, device.device_type
            ),
        ),
    ];
    if require_identity {
        checks.push(identity_check(config, &detected_identity));
    }

    finish_plan(
        config,
        device.model.clone(),
        device.device_type.clone(),
        Some(detected_identity),
        checks,
    )
}

pub fn evaluate_mobile_wipe(config: &WipeConfig, device: &MobileDevice) -> WipePlan {
    evaluate_mobile_wipe_with_identity(config, device, false)
}

pub fn authorize_mobile_wipe(config: &WipeConfig, device: &MobileDevice) -> WipePlan {
    evaluate_mobile_wipe_with_identity(config, device, true)
}

fn build_wipe_plan(config: &WipeConfig, require_identity: bool) -> Result<WipePlan, String> {
    if config.device_type.eq_ignore_ascii_case("android") {
        let identifier = if config.device_serial.is_empty() {
            config.device_path.as_str()
        } else {
            config.device_serial.as_str()
        };
        let devices = detect_android_devices()
            .map_err(|e| format!("could not verify Android device status: {e}"))?;
        return Ok(
            match devices.iter().find(|device| device.serial == identifier) {
                Some(device) => {
                    evaluate_mobile_wipe_with_identity(config, device, require_identity)
                }
                None => missing_device_plan(config, identifier),
            },
        );
    }

    let drives =
        detect_storage_drives().map_err(|e| format!("could not verify drive status: {e}"))?;
    Ok(
        match drives.iter().find(|drive| drive.name == config.device_path) {
            Some(drive) => evaluate_storage_wipe_with_identity(config, drive, require_identity),
            None => missing_device_plan(config, &config.device_path),
        },
    )
}

pub fn preflight_wipe(config: &WipeConfig) -> Result<WipePlan, String> {
    build_wipe_plan(config, false)
}

pub fn authorize_wipe(config: &WipeConfig) -> Result<WipePlan, String> {
    build_wipe_plan(config, true)
}
