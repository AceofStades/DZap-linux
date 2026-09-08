use server::core::drives::{Drive, DriveType, MobileDevice};
use server::core::preflight::{
    PreflightCheckStatus, PreflightDecision, authorize_mobile_wipe, authorize_storage_wipe,
    evaluate_mobile_wipe, evaluate_storage_wipe,
};
use server::core::wiper::WipeConfig;

fn config(method: &str) -> WipeConfig {
    WipeConfig {
        device_path: "/dev/test-disk".to_string(),
        method: method.to_string(),
        device_serial: String::new(),
        device_type: "HDD".to_string(),
        device_model: Some("Client supplied model".to_string()),
        expected_identity: None,
    }
}

fn drive(drive_type: DriveType) -> Drive {
    Drive {
        name: "/dev/test-disk".to_string(),
        model: "Detected model".to_string(),
        serial: "SERIAL-1".to_string(),
        wwn: "0x5000000000000001".to_string(),
        size: "1000000".to_string(),
        transport: "sata".to_string(),
        major_minor: "8:16".to_string(),
        drive_type,
        is_mounted: false,
        is_frozen: false,
        is_os_drive: false,
        partitions: vec![],
    }
}

#[test]
fn safe_storage_request_produces_ready_plan_from_detected_device() {
    let plan = evaluate_storage_wipe(&config("overwrite_1_pass"), &drive(DriveType::Hdd));

    assert_eq!(plan.decision, PreflightDecision::Ready);
    assert!(plan.is_ready());
    assert_eq!(plan.device_path, "/dev/test-disk");
    assert_eq!(plan.device_model, "Detected model");
    assert_eq!(plan.device_type, "HDD");
    assert_eq!(plan.method, "overwrite_1_pass");
    assert_eq!(plan.identity.as_ref().unwrap().serial, "SERIAL-1");
    assert_eq!(plan.identity.as_ref().unwrap().major_minor, "8:16");
    assert_eq!(plan.checks.len(), 5);
    assert!(
        plan.checks
            .iter()
            .all(|check| check.status == PreflightCheckStatus::Passed)
    );

    let json = serde_json::to_value(plan).unwrap();
    assert_eq!(json["decision"], "ready");
    assert_eq!(json["devicePath"], "/dev/test-disk");
    assert_eq!(json["checks"][0]["status"], "passed");
}

#[test]
fn execution_requires_the_identity_approved_during_preflight() {
    let target = drive(DriveType::Hdd);
    let mut request = config("overwrite_1_pass");

    let missing = authorize_storage_wipe(&request, &target);
    assert_eq!(missing.decision, PreflightDecision::Blocked);
    assert!(
        missing
            .blocking_message()
            .contains("No approved device identity")
    );

    request.expected_identity = Some(target.identity());
    let approved = authorize_storage_wipe(&request, &target);
    assert_eq!(approved.decision, PreflightDecision::Ready);

    request.expected_identity.as_mut().unwrap().serial = "DIFFERENT-DISK".to_string();
    let changed = authorize_storage_wipe(&request, &target);
    assert_eq!(changed.decision, PreflightDecision::Blocked);
    assert!(changed.blocking_message().contains("identity changed"));
}

#[test]
fn mounted_os_drive_reports_every_blocking_condition() {
    let mut target = drive(DriveType::Hdd);
    target.is_mounted = true;
    target.is_os_drive = true;

    let plan = evaluate_storage_wipe(&config("overwrite_1_pass"), &target);
    let blocked_codes: Vec<&str> = plan
        .checks
        .iter()
        .filter(|check| check.status == PreflightCheckStatus::Blocked)
        .map(|check| check.code.as_str())
        .collect();

    assert_eq!(plan.decision, PreflightDecision::Blocked);
    assert_eq!(blocked_codes, ["os_drive", "mounted"]);
    assert!(plan.blocking_message().contains("operating-system drive"));
    assert!(plan.blocking_message().contains("is mounted"));
}

#[test]
fn frozen_sata_ssd_is_blocked() {
    let mut target = drive(DriveType::Ssd);
    target.is_frozen = true;

    let plan = evaluate_storage_wipe(&config("sata_secure_erase"), &target);

    assert_eq!(plan.decision, PreflightDecision::Blocked);
    assert_eq!(
        plan.checks
            .iter()
            .find(|check| check.code == "frozen")
            .unwrap()
            .status,
        PreflightCheckStatus::Blocked
    );
}

#[test]
fn method_must_match_detected_drive_type() {
    let plan = evaluate_storage_wipe(&config("nvme_format"), &drive(DriveType::Hdd));

    assert_eq!(plan.decision, PreflightDecision::Blocked);
    let method_check = plan
        .checks
        .iter()
        .find(|check| check.code == "method_supported")
        .unwrap();
    assert_eq!(method_check.status, PreflightCheckStatus::Blocked);
    assert!(method_check.message.contains("overwrite_1_pass"));
}

#[test]
fn android_plan_validates_the_requested_method() {
    let device = MobileDevice {
        name: "Pixel".to_string(),
        model: "Pixel 9".to_string(),
        serial: "ANDROID-1".to_string(),
        device_type: "Android".to_string(),
    };
    let mut request = config("android_factory_reset");
    request.device_path = "ANDROID-1".to_string();
    request.device_serial = "ANDROID-1".to_string();
    request.device_type = "Android".to_string();

    let ready = evaluate_mobile_wipe(&request, &device);
    assert_eq!(ready.decision, PreflightDecision::Ready);

    request.expected_identity = ready.identity.clone();
    assert_eq!(
        authorize_mobile_wipe(&request, &device).decision,
        PreflightDecision::Ready
    );

    request.method = "overwrite_1_pass".to_string();
    let blocked = evaluate_mobile_wipe(&request, &device);
    assert_eq!(blocked.decision, PreflightDecision::Blocked);
    assert_eq!(
        blocked
            .checks
            .iter()
            .find(|check| check.code == "method_supported")
            .unwrap()
            .status,
        PreflightCheckStatus::Blocked
    );
}
