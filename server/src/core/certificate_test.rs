use crate::core::certificate::*;
use chrono::{TimeZone, Utc};

#[test]
fn hash_matches_go_payload_format() {
    // Go: fmt.Sprintf("%s|%s|%s|%s|%s", model, serial, method,
    //                  timestamp.Format(time.RFC3339), logHash) -> sha256
    let data = CertificateData {
        device_model: "Samsung SSD 980".to_string(),
        device_serial: "S123456".to_string(),
        wipe_method: "overwrite_1_pass".to_string(),
        timestamp: Utc.with_ymd_and_hms(2025, 1, 15, 10, 30, 0).unwrap(),
        verification_hash: "abc123".to_string(),
    };
    let hash = hash_certificate_data(&data);
    assert_eq!(hash.len(), 32);

    // Independently computed expected value.
    use sha2::{Digest, Sha256};
    let expected =
        Sha256::digest(b"Samsung SSD 980|S123456|overwrite_1_pass|2025-01-15T10:30:00Z|abc123");
    assert_eq!(hash, expected.to_vec());
}

#[test]
fn certificate_json_matches_go_shape() {
    init_for_tests();
    let cert = generate_certificate("Model X", "SN42", "nvme_format", "deadbeef").unwrap();

    let v = serde_json::to_value(&cert).unwrap();
    // Exact top-level keys, and QR data must NOT leak into JSON (Go: json:"-").
    let obj = v.as_object().unwrap();
    let keys: std::collections::HashSet<&str> = obj.keys().map(String::as_str).collect();
    assert_eq!(
        keys,
        ["data", "signature", "publicKey"].into_iter().collect()
    );
    let data = &v["data"];
    for key in [
        "deviceModel",
        "deviceSerial",
        "wipeMethod",
        "timestamp",
        "verificationHash",
    ] {
        assert!(data.get(key).is_some(), "missing key {key} in {data}");
    }
    assert_eq!(data["deviceModel"], serde_json::json!("Model X"));
    assert_eq!(data["deviceSerial"], serde_json::json!("SN42"));
    assert_eq!(data["wipeMethod"], serde_json::json!("nvme_format"));
    assert_eq!(data["verificationHash"], serde_json::json!("deadbeef"));

    // RSA-2048 signature => 256 bytes => 512 hex chars.
    let sig = v["signature"].as_str().unwrap();
    assert_eq!(sig.len(), 512);
    assert!(sig.chars().all(|c| c.is_ascii_hexdigit()));

    // Public key is a PEM-encoded PKIX key.
    let pem = v["publicKey"].as_str().unwrap();
    assert!(pem.starts_with("-----BEGIN PUBLIC KEY-----"));
    assert!(pem.trim_end().ends_with("-----END PUBLIC KEY-----"));

    // A QR code was attached for the PDF (but stays out of JSON).
    assert!(cert.qr_code.is_some());
}

#[test]
fn signature_verifies_against_public_key() {
    init_for_tests();
    let cert = generate_certificate("M", "S", "overwrite_2_pass", "hash").unwrap();

    let hash = hash_certificate_data(&cert.data);
    let sig_bytes = hex::decode(&cert.signature).unwrap();

    // Parse the PEM public key from the certificate itself and verify the
    // way Go's rsa.VerifyPKCS1v15 would: digest + DigestInfo prefix.
    use rsa::Pkcs1v15Sign;
    use rsa::pkcs8::DecodePublicKey;
    let pub_key = rsa::RsaPublicKey::from_public_key_pem(&cert.public_key).unwrap();
    pub_key
        .verify(Pkcs1v15Sign::new::<sha2::Sha256>(), &hash, &sig_bytes)
        .expect("signature must verify against the embedded public key");

    // And it must NOT verify for tampered data.
    let mut tampered = cert.data.clone();
    tampered.device_serial = "TAMPERED".to_string();
    let bad_hash = hash_certificate_data(&tampered);
    assert!(
        pub_key
            .verify(Pkcs1v15Sign::new::<sha2::Sha256>(), &bad_hash, &sig_bytes)
            .is_err()
    );
}

#[test]
fn pdf_is_well_formed_and_contains_certificate_content() {
    init_for_tests();
    let cert = generate_certificate("PdfModel", "PdfSerial", "sata_secure_erase", "h").unwrap();
    let pdf = cert.generate_pdf().unwrap();

    // Structural checks.
    assert!(pdf.starts_with(b"%PDF-1.4\n"));
    assert!(pdf.windows(5).any(|w| w == b"%%EOF"));
    let text = String::from_utf8_lossy(&pdf);
    for needle in [
        "/Type /Catalog",
        "/Type /Pages",
        "/BaseFont /Helvetica-Bold",
        "/BaseFont /Courier",
        "xref",
        "trailer",
        "startxref",
        "Data Destruction Certificate",
        "Device Model:",
        "PdfModel",
        "Digital Signature",
        "Public Key:",
        "Scan to Verify",
        &cert.signature[..32], // signature text appears in the content stream
    ] {
        assert!(text.contains(needle), "PDF missing {needle:?}");
    }

    // The QR code should produce a non-trivial number of dark module rects.
    let dark_rects = text.matches(" re f").count();
    assert!(dark_rects > 100, "expected QR modules, found {dark_rects}");

    // Every xref offset must point at its object header.
    let xref_pos = text.find("xref\n").unwrap();
    let offsets: Vec<usize> = text[xref_pos..]
        .lines()
        .skip(2) // "xref" and "0 N"
        .filter(|l| l.ends_with(" n "))
        .map(|l| l[..10].parse().unwrap())
        .collect();
    assert!(!offsets.is_empty());
    for (idx, off) in offsets.iter().enumerate() {
        let at = &pdf[*off..];
        let header = format!("{} 0 obj", idx + 1);
        assert!(
            at.starts_with(header.as_bytes()),
            "xref entry {} points to wrong offset",
            idx + 1
        );
    }
}

#[test]
fn generated_certificate_round_trips_through_list_format() {
    // The certificates endpoint deserializes stored JSON back into
    // SignedCertificate — make sure our Serialize/Deserialize are symmetric.
    init_for_tests();
    let cert = generate_certificate("RT", "SN", "overwrite_3_pass", "x").unwrap();
    let json = serde_json::to_string(&cert).unwrap();
    let back: SignedCertificate = serde_json::from_str(&json).unwrap();
    assert_eq!(back.data.device_model, "RT");
    assert_eq!(back.signature, cert.signature);
    assert_eq!(back.public_key, cert.public_key);
}

#[test]
fn private_key_is_persisted_with_restricted_permissions_and_reloaded() {
    use rsa::traits::PublicKeyParts;
    use std::os::unix::fs::PermissionsExt;

    let dir = std::env::temp_dir().join(format!("dzap-test-key-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("private.pem");

    let generated = load_or_generate_private_key_at(&path).unwrap();
    assert!(path.exists());
    assert_eq!(
        std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );

    let reloaded = load_or_generate_private_key_at(&path).unwrap();
    assert_eq!(generated.n(), reloaded.n());
    assert_eq!(generated.e(), reloaded.e());

    std::fs::write(&path, "not a private key").unwrap();
    let err = load_or_generate_private_key_at(&path).unwrap_err();
    assert!(
        err.starts_with("failed to decode PEM block containing private key:"),
        "got: {err}"
    );

    std::fs::remove_dir_all(&dir).ok();
}
