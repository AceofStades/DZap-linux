import { useState, useEffect } from "react";
import ConfirmModal from "./ConfirmModal";

export default function Layout() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDrive, setSelectedDrive] = useState("/dev/sda");
  const [logs, setLogs] = useState<string[]>([
    "➜  ~ rm -r stuff",
    "➜  ~ ls",
    "[INFO] Secure Wiper initialized...",
    "[INFO] Scanning for available drives...",
    "[INFO] Found 2 drives: /dev/sda (256GB SSD), /dev/sdb (1TB HDD)",
    "[INFO] Waiting for user action..."
  ]);
const handleWipeClick = () => {
  setIsModalOpen(true);
};


useEffect(() => {
  const fetchDrives = async () => {
    if ((window as any).electron && (window as any).electron.ipcRenderer) {
      const drives = await (window as any).electron.ipcRenderer.invoke("detect-drives");
      console.log("Drives from backend:", drives);
      // If you want to use drives, add logic here
    }
  };

  fetchDrives();
}, []);


  const handleConfirm = () => {
  setIsModalOpen(false);
  console.log("Drive wipe confirmed for", selectedDrive);

  // ✅ Send command to Electron → Go backend
  if ((window as any).electron && (window as any).electron.ipcRenderer) {
    (window as any).electron.ipcRenderer.send("backend-command", {
      action: "wipe",
      drive: selectedDrive,
    });
  }
};


  const generateCertificate = () => {
    // Open certificate in new tab
    const certificateWindow = window.open('', '_blank', 'width=800,height=700');
    if (certificateWindow) {
      certificateWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Data Destruction Certificate</title>
          <style>
            body { 
              font-family: 'Times New Roman', serif; 
              margin: 40px; 
              background: #f7f7f2;
              color: #121113;
            }
            .certificate { 
              background: white; 
              padding: 60px; 
              border: 3px solid #222725;
              max-width: 700px;
              margin: 0 auto;
              box-shadow: 0 0 20px rgba(0,0,0,0.1);
            }
            .header { 
              text-align: center; 
              color: #222725; 
              font-size: 28px; 
              font-weight: bold; 
              margin-bottom: 30px;
              letter-spacing: 2px;
            }
            .title {
              text-align: center;
              font-size: 22px;
              font-weight: bold;
              color: #222725;
              margin: 30px 0;
            }
            .content {
              font-size: 14px;
              line-height: 1.6;
              text-align: center;
              margin: 25px 0;
            }
            .info-table {
              width: 100%;
              margin: 30px 0;
              border-collapse: collapse;
            }
            .info-table th, .info-table td {
              border: 1px solid #899878;
              padding: 12px;
              text-align: center;
            }
            .info-table th {
              background: #e4e6c3;
              font-weight: bold;
            }
            .signatures {
              display: flex;
              justify-content: space-between;
              margin-top: 50px;
            }
            .signature {
              text-align: center;
              width: 45%;
            }
            .signature-line {
              border-bottom: 1px solid #121113;
              margin-bottom: 5px;
              height: 40px;
            }
            .note {
              font-size: 11px;
              margin-top: 30px;
              text-align: justify;
              line-height: 1.4;
            }
            .download-section {
              text-align: center;
              margin: 30px 0;
              padding: 20px;
              background: #f7f7f2;
              border: 2px solid #899878;
              border-radius: 10px;
            }
            .download-btn {
              background: #222725;
              color: #f7f7f2;
              border: 2px solid #899878;
              padding: 12px 24px;
              border-radius: 8px;
              font-size: 16px;
              font-weight: bold;
              cursor: pointer;
              margin: 0 10px;
              transition: all 0.3s ease;
            }
            .download-btn:hover {
              background: #899878;
              transform: scale(1.05);
            }
            @media print {
              .download-section {
                display: none;
              }
            }
          </style>
        </head>
        <body>
          <div class="certificate">
            <div class="header">DATA DESTRUCTION CERTIFICATE</div>
            
            <div class="content">This is to certify that</div>
            
            <div class="title">SOLID-STATE DRIVES (SSDS)</div>
            
            <div class="content">
              Containing client tax records, payroll information, and internal audit reports<br>
              were securely destroyed. The method used was a certified NIST 800-88 Purge<br>
              conducted with an industrial-grade degausser.
            </div>
            
            <table class="info-table">
              <tr>
                <th>Destruction Date</th>
                <th>Certificate ID</th>
                <th>Chain of Custody</th>
              </tr>
              <tr>
                <td>01/06/2025</td>
                <td>CDD-947382-XF-HAS-7685-HUSN</td>
                <td>#SDT-77891-25</td>
              </tr>
            </table>
            
            <div class="signatures">
              <div class="signature">
                <div class="signature-line"></div>
                <strong>Adrian Wilson</strong><br>
                Senior Compliance Officer
              </div>
              <div class="signature">
                <div class="signature-line"></div>
                <strong>Linda Martin</strong><br>
                Information Security Manager
              </div>
            </div>
            
            <div class="note">
              This destruction was executed in accordance with industry standards and regulatory requirements, ensuring no data remains recoverable. The process was verified and documented by trained personnel.
            </div>
          </div>
          
          <div class="download-section">
            <h3 style="color: #222725; margin-bottom: 15px;">📥 Download Options</h3>
            <button class="download-btn" onclick="window.print()">🖨️ Print/Save as PDF</button>
            <button class="download-btn" onclick="downloadAsHTML()">💾 Download as HTML</button>
          </div>
          
          <script>
            function downloadAsHTML() {
              const certificateContent = document.documentElement.outerHTML;
              const blob = new Blob([certificateContent], { type: 'text/html' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'Data_Destruction_Certificate_CDD-947382-XF-HAS-7685-HUSN.html';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }
          </script>
        </body>
        </html>
      `);
    }
  };

  useEffect(() => {
    if ((window as any).electronAPI) {
      (window as any).electronAPI.onBackendLog((log: string) => {
        setLogs((prev) => [...prev, log]);
      });
    }
  }, []);

  return (
    <div className="flex h-screen" style={{ backgroundColor: '#f7f7f2' }}>
      {/* Sidebar */}
      <aside className="w-80 flex flex-col shadow-2xl" style={{ backgroundColor: '#222725' }}>
        <div className="p-6 text-xl font-bold border-b text-white" style={{ borderColor: '#899878' }}>
          🔐 Secure Wiper Pro
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          <h2 className="text-sm font-semibold mb-4 text-white uppercase tracking-wide">Detected Storage Devices</h2>
          <ul className="space-y-3">
            <li
              onClick={() => setSelectedDrive("/dev/sda")}
              className={`p-4 rounded-lg cursor-pointer transition-all duration-200 ${
                selectedDrive === "/dev/sda" 
                  ? "shadow-lg transform scale-105" 
                  : "hover:shadow-md hover:transform hover:scale-102"
              }`}
              style={{ 
                backgroundColor: selectedDrive === "/dev/sda" ? '#899878' : '#121113',
                color: '#f7f7f2',
                border: selectedDrive === "/dev/sda" ? '2px solid #e4e6c3' : '1px solid #899878'
              }}
            >
              <div className="font-semibold">💾 /dev/sda</div>
              <div className="text-sm opacity-90">256GB SSD • Samsung EVO</div>
              <div className="text-xs opacity-75 mt-1">Primary System Drive</div>
            </li>
            <li
              onClick={() => setSelectedDrive("/dev/sdb")}
              className={`p-4 rounded-lg cursor-pointer transition-all duration-200 ${
                selectedDrive === "/dev/sdb" 
                  ? "shadow-lg transform scale-105" 
                  : "hover:shadow-md hover:transform hover:scale-102"
              }`}
              style={{ 
                backgroundColor: selectedDrive === "/dev/sdb" ? '#899878' : '#121113',
                color: '#f7f7f2',
                border: selectedDrive === "/dev/sdb" ? '2px solid #e4e6c3' : '1px solid #899878'
              }}
            >
              <div className="font-semibold">🗄️ /dev/sdb</div>
              <div className="text-sm opacity-90">1TB HDD • Western Digital</div>
              <div className="text-xs opacity-75 mt-1">Secondary Storage</div>
            </li>
          </ul>
        </div>

        <div className="p-4 border-t" style={{ borderColor: '#899878' }}>
          <button
            onClick={generateCertificate}
            className="w-full px-4 py-3 rounded-lg font-semibold transition-all duration-200 hover:shadow-lg transform hover:scale-105"
            style={{ 
              backgroundColor: '#e4e6c3', 
              color: '#222725',
              border: '2px solid #899878'
            }}
          >
            📜 Generate Certificate
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col p-8">
        {/* Drive Info */}
        <section className="mb-6">
          <h1 className="text-3xl font-bold mb-4" style={{ color: '#222725' }}>
            📊 Drive Analysis Dashboard
          </h1>
          <div className="shadow-xl rounded-xl p-6" style={{ backgroundColor: '#e4e6c3', border: '2px solid #899878' }}>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="mb-2"><strong style={{ color: '#222725' }}>Device Model:</strong> <span style={{ color: '#121113' }}>Lenovo ThinkPad X1 Carbon</span></p>
                <p className="mb-2"><strong style={{ color: '#222725' }}>Selected Drive:</strong> <span style={{ color: '#121113' }}>{selectedDrive}</span></p>
              </div>
              <div>
                <p className="mb-2"><strong style={{ color: '#222725' }}>Capacity:</strong> <span style={{ color: '#121113' }}>{selectedDrive === "/dev/sda" ? "256GB SSD" : "1TB HDD"}</span></p>
                <p className="mb-2"><strong style={{ color: '#222725' }}>Security Status:</strong> 
                  <span className="px-3 py-1 rounded-full text-sm font-semibold ml-2" style={{ backgroundColor: '#899878', color: '#f7f7f2' }}>
                    🟡 Awaiting Wipe
                  </span>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Action Buttons - Moved to top */}
        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-3" style={{ color: '#222725' }}>
            🔥 Destruction Options
          </h2>
          <div className="flex gap-6">
            <button
              onClick={handleWipeClick}
              className="px-8 py-4 rounded-xl font-bold text-lg transition-all duration-200 hover:shadow-2xl transform hover:scale-105 flex items-center gap-3"
              style={{ 
                backgroundColor: '#899878', 
                color: '#f7f7f2',
                border: '3px solid #222725'
              }}
            >
              ⚡ Quick Wipe (3-Pass)
            </button>
            <button
              onClick={handleWipeClick}
              className="px-8 py-4 rounded-xl font-bold text-lg transition-all duration-200 hover:shadow-2xl transform hover:scale-105 flex items-center gap-3"
              style={{ 
                backgroundColor: '#899878', 
                color: '#f7f7f2',
                border: '3px solid #222725'
              }}
            >
              🔒 Advanced Wipe (35-Pass DoD)
            </button>
          </div>
        </section>

        {/* Terminal - Fixed height and scrollable */}
        <section className="flex-1 min-h-0">
          <h2 className="text-xl font-semibold mb-3" style={{ color: '#222725' }}>
            💻 System Terminal
          </h2>
          <div className="h-full rounded-xl shadow-2xl overflow-hidden border-2 flex flex-col" style={{ backgroundColor: '#121113', borderColor: '#222725' }}>
            {/* Terminal Header */}
            <div className="flex items-center px-4 py-3 flex-shrink-0" style={{ backgroundColor: '#222725' }}>
              <div className="flex space-x-2">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
              </div>
              <div className="flex-1 text-center text-sm font-mono" style={{ color: '#e4e6c3' }}>
                joshua@Joshs-MacBook-Pro-188:~
              </div>
            </div>
            
            {/* Terminal Content - Scrollable */}
            <div className="flex-1 p-4 overflow-y-auto font-mono text-sm" style={{ backgroundColor: '#121113' }}>
              <div style={{ color: '#e4e6c3' }}>
                <div className="mb-2">
                  <span style={{ color: '#899878' }}>Applications</span>
                  <span className="ml-8" style={{ color: '#e4e6c3' }}>Music</span>
                </div>
                <div className="mb-2">
                  <span style={{ color: '#899878' }}>Creative Cloud Files</span>
                  <span className="ml-4" style={{ color: '#e4e6c3' }}>Pictures</span>
                </div>
                <div className="mb-2">
                  <span style={{ color: '#899878' }}>Desktop</span>
                  <span className="ml-12" style={{ color: '#e4e6c3' }}>Public</span>
                </div>
                <div className="mb-2">
                  <span style={{ color: '#899878' }}>Documents</span>
                  <span className="ml-10" style={{ color: '#f7f7f2' }}>Blender</span>
                </div>
                <div className="mb-2">
                  <span style={{ color: '#899878' }}>Downloads</span>
                  <span className="ml-10" style={{ color: '#f7f7f2' }}>dj-music</span>
                </div>
                <div className="mb-2">
                  <span style={{ color: '#899878' }}>Library</span>
                  <span className="ml-12" style={{ color: '#ffffff' }}>index.html</span>
                </div>
                <div className="mb-2">
                  <span style={{ color: '#899878' }}>Movies</span>
                  <span className="ml-14" style={{ color: '#e4e6c3' }}>work</span>
                </div>
              </div>
              
              <div className="mt-4">
                {logs.map((log, i) => (
                  <div key={i} className="mb-1">
                    {log.startsWith('➜') ? (
                      <span style={{ color: '#e4e6c3' }}>{log}</span>
                    ) : log.startsWith('[INFO]') ? (
                      <span style={{ color: '#899878' }}>{log}</span>
                    ) : log.startsWith('[ERROR]') ? (
                      <span className="text-red-400">{log}</span>
                    ) : log.startsWith('[SUCCESS]') ? (
                      <span style={{ color: '#e4e6c3' }}>{log}</span>
                    ) : (
                      <span style={{ color: '#f7f7f2' }}>{log}</span>
                    )}
                  </div>
                ))}
              </div>
              
              <div className="flex items-center mt-2">
                <span style={{ color: '#e4e6c3' }}>➜ </span>
                <span style={{ color: '#899878' }} className="ml-2">~ </span>
                <span className="text-pink-400 ml-1">█</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Confirmation Modal */}
      <ConfirmModal
        driveName={selectedDrive}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={handleConfirm}
      />
    </div>
  );
}