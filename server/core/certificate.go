package core

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/jung-kurt/gofpdf"
	"github.com/skip2/go-qrcode"
)

var appPrivateKey *rsa.PrivateKey

func init() {
	var err error
	appPrivateKey, err = loadOrGeneratePrivateKey()
	if err != nil {
		log.Fatalf("FATAL: Could not load or generate the application private key: %v", err)
	}
}

func loadOrGeneratePrivateKey() (*rsa.PrivateKey, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return nil, fmt.Errorf("could not get user config directory: %w", err)
	}
	keyPath := filepath.Join(configDir, "DZap", "private.pem")

	if _, err := os.Stat(keyPath); err == nil {
		keyData, err := os.ReadFile(keyPath)
		if err != nil {
			return nil, fmt.Errorf("could not read private key file: %w", err)
		}
		block, _ := pem.Decode(keyData)
		if block == nil {
			return nil, fmt.Errorf("failed to decode PEM block containing private key")
		}
		return x509.ParsePKCS1PrivateKey(block.Bytes)
	}

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, fmt.Errorf("failed to generate new private key: %w", err)
	}

	keyBytes := x509.MarshalPKCS1PrivateKey(privateKey)
	pemBlock := &pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: keyBytes,
	}

	if err := os.MkdirAll(filepath.Dir(keyPath), 0700); err != nil {
		return nil, fmt.Errorf("failed to create config directory: %w", err)
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(pemBlock), 0600); err != nil {
		return nil, fmt.Errorf("failed to save new private key: %w", err)
	}

	log.Printf("New private key saved to %s", keyPath)
	return privateKey, nil
}

type CertificateData struct {
	DeviceModel      string    `json:"deviceModel"`
	DeviceSerial     string    `json:"deviceSerial"`
	WipeMethod       string    `json:"wipeMethod"`
	Timestamp        time.Time `json:"timestamp"`
	VerificationHash string    `json:"verificationHash"`
}

type SignedCertificate struct {
	Data      CertificateData `json:"data"`
	Signature string          `json:"signature"`
	PublicKey string          `json:"publicKey"`
	QRCodePNG []byte          `json:"-"` // Exclude QR from JSON response
}

func GenerateCertificate(model, serial, method, logHash string) (*SignedCertificate, error) {
	certData := CertificateData{
		DeviceModel:      model,
		DeviceSerial:     serial,
		WipeMethod:       method,
		Timestamp:        time.Now().UTC(),
		VerificationHash: logHash,
	}

	hash, err := hashCertificateData(certData)
	if err != nil {
		return nil, err
	}

	signatureBytes, err := rsa.SignPKCS1v15(rand.Reader, appPrivateKey, crypto.SHA256, hash)
	if err != nil {
		return nil, err
	}
	signature := hex.EncodeToString(signatureBytes)

	pubKeyBytes, err := x509.MarshalPKIXPublicKey(&appPrivateKey.PublicKey)
	if err != nil {
		return nil, err
	}
	pubKeyPem := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: pubKeyBytes,
	})

	signedCert := &SignedCertificate{
		Data:      certData,
		Signature: signature,
		PublicKey: string(pubKeyPem),
	}

	// Generate QR Code from the JSON representation of the certificate
	certJSON, err := json.Marshal(signedCert)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal certificate to JSON for QR code: %w", err)
	}

	qrBytes, err := qrcode.Encode(string(certJSON), qrcode.Medium, 256)
	if err != nil {
		return nil, fmt.Errorf("failed to generate QR code: %w", err)
	}
	signedCert.QRCodePNG = qrBytes

	return signedCert, nil
}

func hashCertificateData(data CertificateData) ([]byte, error) {
	payload := fmt.Sprintf("%s|%s|%s|%s|%s", data.DeviceModel, data.DeviceSerial, data.WipeMethod, data.Timestamp.Format(time.RFC3339), data.VerificationHash)
	hash := sha256.Sum256([]byte(payload))
	return hash[:], nil
}

func (sc *SignedCertificate) GeneratePDF() ([]byte, error) {
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.AddPage()
	pdf.SetFont("Arial", "B", 20)
	pdf.Cell(0, 20, "Data Destruction Certificate")
	pdf.Ln(25)

	// --- Certificate Details ---
	pdf.SetFont("Arial", "B", 12)
	pdf.Cell(40, 10, "Device Model:")
	pdf.SetFont("Arial", "", 12)
	pdf.Cell(0, 10, sc.Data.DeviceModel)
	pdf.Ln(8)
	// ... (Add other fields: Serial, Method, Timestamp) ...
	pdf.Ln(15)

	// --- QR Code for Verification ---
	// The RegisterImageOptionsReader allows embedding an image from a byte slice in memory
	pdf.RegisterImageOptionsReader("qr_code", gofpdf.ImageOptions{ImageType: "PNG"}, bytes.NewReader(sc.QRCodePNG))
	// Place the image on the PDF (x, y, width, height)
	pdf.ImageOptions("qr_code", 150, 25, 40, 40, false, gofpdf.ImageOptions{ImageType: "PNG"}, 0, "")
	pdf.SetFont("Arial", "I", 9)
	pdf.SetXY(150, 65)
	pdf.Cell(40, 10, "Scan to Verify")

	// --- Digital Signature ---
	pdf.SetXY(10, 100) // Reset position
	pdf.SetFont("Arial", "B", 10)
	pdf.MultiCell(0, 5, "Digital Signature (SHA256withRSA):", "", "L", false)
	pdf.SetFont("Courier", "", 8)
	pdf.MultiCell(0, 4, sc.Signature, "1", "L", false)
	pdf.Ln(5)

	pdf.SetFont("Arial", "B", 10)
	pdf.MultiCell(0, 5, "Public Key:", "", "L", false)
	pdf.SetFont("Courier", "", 7)
	pdf.MultiCell(0, 4, sc.PublicKey, "1", "L", false)

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
