// Port of server-go/core/certificate.go
use chrono::{DateTime, Utc};
use rsa::pkcs1::{DecodeRsaPrivateKey, EncodeRsaPrivateKey};
use rsa::pkcs8::{EncodePublicKey, LineEnding};
use rsa::{Pkcs1v15Sign, RsaPrivateKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use super::drives::log_line;

static APP_PRIVATE_KEY: OnceLock<RsaPrivateKey> = OnceLock::new();

/// Loads (or generates) the application private key. Fatal on error,
/// mirroring the Go `init()` behaviour.
pub fn init() {
    match load_or_generate_private_key() {
        Ok(key) => {
            let _ = APP_PRIVATE_KEY.set(key);
        }
        Err(e) => {
            eprintln!("FATAL: Could not load or generate the application private key: {e}");
            std::process::exit(1);
        }
    }
}

/// Test-only init: use an ephemeral key so tests never touch the real
/// key at ~/.config/DZap/private.pem.
#[cfg(test)]
pub fn init_for_tests() {
    let _ = APP_PRIVATE_KEY.get_or_init(|| {
        let mut rng = rand::thread_rng();
        RsaPrivateKey::new(&mut rng, 2048).expect("failed to generate test key")
    });
}

fn private_key() -> &'static RsaPrivateKey {
    APP_PRIVATE_KEY
        .get()
        .expect("certificate module not initialized")
}

fn key_path() -> Result<PathBuf, String> {
    let config_dir = dirs::config_dir().ok_or("could not get user config directory".to_string())?;
    Ok(config_dir.join("DZap").join("private.pem"))
}

fn load_or_generate_private_key() -> Result<RsaPrivateKey, String> {
    let key_path = key_path()?;
    load_or_generate_private_key_at(&key_path)
}

pub(crate) fn load_or_generate_private_key_at(key_path: &Path) -> Result<RsaPrivateKey, String> {
    if key_path.exists() {
        let key_data = std::fs::read_to_string(key_path)
            .map_err(|e| format!("could not read private key file: {e}"))?;
        return RsaPrivateKey::from_pkcs1_pem(&key_data)
            .map_err(|e| format!("failed to decode PEM block containing private key: {e}"));
    }

    let mut rng = rand::thread_rng();
    let private_key = RsaPrivateKey::new(&mut rng, 2048)
        .map_err(|e| format!("failed to generate new private key: {e}"))?;

    let pem = private_key
        .to_pkcs1_pem(LineEnding::LF)
        .map_err(|e| format!("failed to encode private key: {e}"))?;

    if let Some(dir) = key_path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("failed to create config directory: {e}"))?;
        let _ = std::fs::set_permissions(dir, {
            use std::os::unix::fs::PermissionsExt;
            std::fs::Permissions::from_mode(0o700)
        });
    }
    std::fs::write(key_path, pem.as_bytes())
        .map_err(|e| format!("failed to save new private key: {e}"))?;
    let _ = std::fs::set_permissions(key_path, {
        use std::os::unix::fs::PermissionsExt;
        std::fs::Permissions::from_mode(0o600)
    });

    log_line(&format!("New private key saved to {}", key_path.display()));
    Ok(private_key)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateData {
    #[serde(rename = "deviceModel")]
    pub device_model: String,
    #[serde(rename = "deviceSerial")]
    pub device_serial: String,
    #[serde(rename = "wipeMethod")]
    pub wipe_method: String,
    pub timestamp: DateTime<Utc>,
    #[serde(rename = "verificationHash")]
    pub verification_hash: String,
}

#[derive(Serialize, Deserialize)]
pub struct SignedCertificate {
    pub data: CertificateData,
    pub signature: String,
    #[serde(rename = "publicKey")]
    pub public_key: String,
    /// QR code module matrix for PDF rendering. Excluded from JSON,
    /// mirroring Go's `json:"-"`.
    #[serde(skip)]
    pub qr_code: Option<qrcode::QrCode>,
}

pub fn generate_certificate(
    model: &str,
    serial: &str,
    method: &str,
    log_hash: &str,
) -> Result<SignedCertificate, String> {
    let cert_data = CertificateData {
        device_model: model.to_string(),
        device_serial: serial.to_string(),
        wipe_method: method.to_string(),
        timestamp: Utc::now(),
        verification_hash: log_hash.to_string(),
    };

    let hash = hash_certificate_data(&cert_data);

    let mut rng = rand::thread_rng();
    let signature_bytes = private_key()
        .sign_with_rng(&mut rng, Pkcs1v15Sign::new::<Sha256>(), &hash)
        .map_err(|e| format!("failed to sign certificate: {e}"))?;
    let signature = hex::encode(signature_bytes);

    let public_key = private_key()
        .to_public_key()
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| format!("failed to encode public key: {e}"))?;

    let mut signed_cert = SignedCertificate {
        data: cert_data,
        signature,
        public_key,
        qr_code: None,
    };

    // Generate QR Code from the JSON representation of the certificate
    let cert_json = serde_json::to_string(&signed_cert)
        .map_err(|e| format!("failed to marshal certificate to JSON for QR code: {e}"))?;

    let qr = qrcode::QrCode::new(cert_json.as_bytes())
        .map_err(|e| format!("failed to generate QR code: {e}"))?;
    signed_cert.qr_code = Some(qr);

    Ok(signed_cert)
}

pub(crate) fn hash_certificate_data(data: &CertificateData) -> Vec<u8> {
    // Matches Go's time.RFC3339 formatting for UTC timestamps.
    let ts = data.timestamp.format("%Y-%m-%dT%H:%M:%SZ");
    let payload = format!(
        "{}|{}|{}|{}|{}",
        data.device_model, data.device_serial, data.wipe_method, ts, data.verification_hash
    );
    Sha256::digest(payload.as_bytes()).to_vec()
}

// ---------------------------------------------------------------------------
// Minimal PDF generation (replaces gofpdf).
// ---------------------------------------------------------------------------

const MM: f64 = 72.0 / 25.4; // mm -> pt
const PAGE_W: f64 = 595.28; // A4
const PAGE_H: f64 = 841.89;

fn escape_pdf_text(text: &str) -> String {
    let mut out = String::new();
    for b in text.bytes() {
        match b {
            b'(' | b')' | b'\\' => {
                out.push('\\');
                out.push(b as char);
            }
            0x20..=0x7e => out.push(b as char),
            _ => out.push_str(&format!("\\{b:03o}")),
        }
    }
    out
}

struct Content {
    buf: String,
}

impl Content {
    fn new() -> Self {
        Content { buf: String::new() }
    }

    /// Draw text; `y_mm` is the baseline measured from the TOP of the page.
    fn text(&mut self, font: &str, size: f64, x_mm: f64, y_mm: f64, text: &str) {
        let x = x_mm * MM;
        let y = PAGE_H - y_mm * MM;
        self.buf.push_str(&format!(
            "BT /{font} {size} Tf 1 0 0 1 {x:.2} {y:.2} Tm ({}) Tj ET\n",
            escape_pdf_text(text)
        ));
    }

    /// Filled rectangle; `y_mm` is the TOP edge of the rect.
    fn rect_fill(&mut self, x_mm: f64, y_mm: f64, w_mm: f64, h_mm: f64) {
        let x = x_mm * MM;
        let y = PAGE_H - (y_mm + h_mm) * MM;
        self.buf.push_str(&format!(
            "{x:.2} {y:.2} {:.2} {:.2} re f\n",
            w_mm * MM,
            h_mm * MM
        ));
    }

    /// Stroked rectangle; `y_mm` is the TOP edge of the rect.
    fn rect_stroke(&mut self, x_mm: f64, y_mm: f64, w_mm: f64, h_mm: f64) {
        let x = x_mm * MM;
        let y = PAGE_H - (y_mm + h_mm) * MM;
        self.buf.push_str(&format!(
            "{x:.2} {y:.2} {:.2} {:.2} re S\n",
            w_mm * MM,
            h_mm * MM
        ));
    }
}

/// Wrap text to fit a width, given a monospace font size in pt.
fn wrap_mono(text: &str, font_size: f64, max_width_mm: f64) -> Vec<String> {
    let char_w_mm = font_size * 0.6 / MM;
    let max_chars = (max_width_mm / char_w_mm).floor().max(1.0) as usize;
    let mut lines = Vec::new();
    for raw_line in text.lines() {
        let mut line = raw_line;
        while line.len() > max_chars {
            lines.push(line[..max_chars].to_string());
            line = &line[max_chars..];
        }
        lines.push(line.to_string());
    }
    lines
}

impl SignedCertificate {
    pub fn generate_pdf(&self) -> Result<Vec<u8>, String> {
        let mut c = Content::new();

        // --- Title ---
        c.text("F1", 20.0, 10.0, 25.0, "Data Destruction Certificate");

        // --- Certificate Details ---
        c.text("F1", 12.0, 10.0, 42.0, "Device Model:");
        c.text("F2", 12.0, 50.0, 42.0, &self.data.device_model);

        // --- QR Code for Verification ---
        if let Some(qr) = &self.qr_code {
            let quiet = 4isize;
            let width = qr.width() as isize;
            let total = (width + quiet * 2) as f64;
            let cell = 40.0 / total; // mm per module
            let colors = qr.to_colors();
            for y in 0..width {
                for x in 0..width {
                    if colors[(y * width + x) as usize] == qrcode::Color::Dark {
                        c.rect_fill(
                            150.0 + (x + quiet) as f64 * cell,
                            25.0 + (y + quiet) as f64 * cell,
                            cell,
                            cell,
                        );
                    }
                }
            }
        }
        c.text("F4", 9.0, 150.0, 72.0, "Scan to Verify");

        // --- Digital Signature ---
        let mut y = 105.0;
        c.text("F1", 10.0, 10.0, y, "Digital Signature (SHA256withRSA):");
        y += 5.0;
        let sig_lines = wrap_mono(&self.signature, 8.0, 186.0);
        let block_h = sig_lines.len() as f64 * 4.0 + 2.0;
        c.rect_stroke(10.0, y - 3.0, 190.0, block_h);
        for line in &sig_lines {
            y += 4.0;
            c.text("F3", 8.0, 11.0, y, line);
        }
        y += 5.0 + 5.0;

        c.text("F1", 10.0, 10.0, y, "Public Key:");
        y += 5.0;
        let key_lines = wrap_mono(&self.public_key, 7.0, 186.0);
        let block_h = key_lines.len() as f64 * 4.0 + 2.0;
        c.rect_stroke(10.0, y - 3.0, 190.0, block_h);
        for line in &key_lines {
            y += 4.0;
            c.text("F3", 7.0, 11.0, y, line);
        }

        build_pdf(&c.buf)
    }
}

fn build_pdf(content: &str) -> Result<Vec<u8>, String> {
    let mut buf: Vec<u8> = Vec::new();
    let mut offsets: Vec<usize> = Vec::new();

    buf.extend_from_slice(b"%PDF-1.4\n");

    let obj = |buf: &mut Vec<u8>, offsets: &mut Vec<usize>, body: &[u8]| {
        offsets.push(buf.len());
        buf.extend_from_slice(format!("{} 0 obj\n", offsets.len()).as_bytes());
        buf.extend_from_slice(body);
        buf.extend_from_slice(b"\nendobj\n");
    };

    obj(&mut buf, &mut offsets, b"<< /Type /Catalog /Pages 2 0 R >>");
    obj(
        &mut buf,
        &mut offsets,
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    );
    obj(
        &mut buf,
        &mut offsets,
        format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R /F4 7 0 R >> >> /Contents 8 0 R >>"
        )
        .as_bytes(),
    );
    for base_font in [
        "Helvetica-Bold",
        "Helvetica",
        "Courier",
        "Helvetica-Oblique",
    ] {
        obj(
            &mut buf,
            &mut offsets,
            format!("<< /Type /Font /Subtype /Type1 /BaseFont /{base_font} >>").as_bytes(),
        );
    }
    obj(
        &mut buf,
        &mut offsets,
        format!(
            "<< /Length {} >>\nstream\n{content}endstream",
            content.len()
        )
        .as_bytes(),
    );

    let xref_start = buf.len();
    let count = offsets.len() + 1;
    buf.extend_from_slice(format!("xref\n0 {count}\n").as_bytes());
    buf.extend_from_slice(b"0000000000 65535 f \n");
    for off in &offsets {
        buf.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    buf.extend_from_slice(
        format!("trailer\n<< /Size {count} /Root 1 0 R >>\nstartxref\n{xref_start}\n%%EOF\n")
            .as_bytes(),
    );

    Ok(buf)
}
