import React from 'react';

interface DebugPanelProps {
  logs: string[];
  onClear: () => void;
}

const DebugPanel: React.FC<DebugPanelProps> = ({ logs, onClear }) => {
  return (
    <div className="debug-panel">
      <div className="debug-panel-header">
        <h3>Debug Log</h3>
        <button className="debug-button" onClick={onClear}>Clear</button>
      </div>
      <div className="debug-logs">
        {logs.map((log, i) => (
          <div key={i} className="debug-entry">{log}</div>
        ))}
      </div>
    </div>
  );
};

export default DebugPanel; 