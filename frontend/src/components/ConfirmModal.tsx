import { useState } from "react";

interface ConfirmModalProps {
  driveName: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function ConfirmModal({ driveName, isOpen, onClose, onConfirm }: ConfirmModalProps) {
  const [input, setInput] = useState("");

  if (!isOpen) return null;

  const isMatch = input === driveName;

  const handleConfirmClick = () => {
    if (isMatch) {
      onConfirm();
      setInput(""); // Reset input after confirmation
    }
  };

  const handleClose = () => {
    setInput(""); // Reset input on close
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
      <div 
        className="rounded-2xl shadow-2xl w-96 p-8 transform transition-all duration-300 border-2" 
        style={{ 
          backgroundColor: '#e4e6c3',
          borderColor: '#222725'
        }}
      >
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">⚠️</div>
          <h2 className="text-2xl font-bold" style={{ color: '#222725' }}>
            Confirm Data Destruction
          </h2>
        </div>

        {/* Warning Section */}
        <div 
          className="mb-6 p-4 rounded-lg border-2" 
          style={{ 
            backgroundColor: '#f7f7f2',
            borderColor: '#899878'
          }}
        >
          <div className="text-center mb-3">
            <span 
              className="px-3 py-1 rounded-full text-sm font-bold"
              style={{ 
                backgroundColor: '#222725', 
                color: '#f7f7f2' 
              }}
            >
              CRITICAL WARNING
            </span>
          </div>
          <p className="mb-3 text-center font-semibold" style={{ color: '#121113' }}>
            This action is <strong>IRREVERSIBLE</strong> and will permanently destroy all data!
          </p>
          <p className="mb-4 text-center" style={{ color: '#222725' }}>
            Type{' '}
            <span 
              className="px-2 py-1 rounded font-mono font-bold mx-1" 
              style={{ 
                backgroundColor: '#899878', 
                color: '#f7f7f2' 
              }}
            >
              {driveName}
            </span>
            {' '}exactly to confirm wiping this drive.
          </p>
        </div>

        {/* Input Field */}
        <div className="mb-6">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter drive name exactly..."
            className="w-full border-2 px-4 py-3 rounded-lg text-center font-mono font-semibold focus:outline-none focus:ring-4 transition-all duration-200"
            style={{ 
              borderColor: isMatch ? '#899878' : '#222725',
              backgroundColor: '#ffffff',
              color: '#121113',
            }}
            autoFocus
          />
          <div className="mt-2 text-center text-sm">
            {input && (
              <span style={{ 
                color: isMatch ? '#899878' : '#222725' 
              }}>
                {isMatch ? '✓ Drive name matches' : '✗ Drive name does not match'}
              </span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleClose}
            className="flex-1 px-6 py-3 rounded-lg font-semibold transition-all duration-200 hover:shadow-lg transform hover:scale-105"
            style={{ 
              backgroundColor: '#f7f7f2', 
              color: '#222725',
              border: '2px solid #899878'
            }}
          >
            ❌ Cancel
          </button>
          <button
            onClick={handleConfirmClick}
            disabled={!isMatch}
            className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all duration-200 ${
              isMatch 
                ? "hover:shadow-lg transform hover:scale-105" 
                : "cursor-not-allowed opacity-50"
            }`}
            style={{
              backgroundColor: isMatch ? '#222725' : '#899878',
              color: '#f7f7f2',
              border: '2px solid #222725'
            }}
          >
            {isMatch ? '🔥 Confirm Wipe' : '⚠️ Enter Drive Name'}
          </button>
        </div>

        {/* Additional Warning */}
        <div 
          className="mt-6 p-3 rounded-lg text-xs text-center"
          style={{ 
            backgroundColor: '#222725', 
            color: '#f7f7f2' 
          }}
        >
          <strong>Legal Notice:</strong> By confirming, you acknowledge that this action will permanently erase all data and cannot be undone. Ensure you have proper backups of any important information.
        </div>
      </div>
    </div>
  );
}