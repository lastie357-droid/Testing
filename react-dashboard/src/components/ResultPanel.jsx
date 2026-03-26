import React, { useState } from 'react';
import { generateReport } from '../utils/reportGenerator.js';

function formatResult(response) {
  if (!response) return '(no data)';
  try {
    const obj = typeof response === 'string' ? JSON.parse(response) : response;
    return JSON.stringify(obj, null, 2);
  } catch (_) {
    return String(response);
  }
}

function ResultItem({ result }) {
  const [expanded, setExpanded] = useState(false);

  const hasReport = result.success && result.response;

  return (
    <div className={`result-item ${result.success ? 'success' : 'error'}`}>
      <div className="result-cmd">
        <span>{result.command}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {hasReport && (
            <button
              className="result-report-btn"
              onClick={() => generateReport(result)}
              title="Open HTML Report"
            >
              📋 Report
            </button>
          )}
          <span className={`result-badge ${result.success ? 'ok' : 'fail'}`}>
            {result.success ? '✓ OK' : '✗ FAIL'}
          </span>
        </div>
      </div>
      {result.error && (
        <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>{result.error}</div>
      )}
      {result.response && (
        <>
          <div
            className="result-data"
            style={{ maxHeight: expanded ? 'none' : 100 }}
          >
            {formatResult(result.response)}
          </div>
          <div
            style={{ fontSize: 11, color: '#7c3aed', cursor: 'pointer', marginTop: 4 }}
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? '▲ Collapse' : '▼ Expand'}
          </div>
        </>
      )}
      <div className="result-time">{result.time?.toLocaleTimeString()}</div>
    </div>
  );
}

export default function ResultPanel({ results }) {
  const [list, setList] = useState(null);
  const displayed = list !== null ? list : results;

  return (
    <div className="result-panel">
      <div className="result-header">
        <span>📊 Results ({results.length})</span>
        {results.length > 0 && (
          <button className="result-clear" onClick={() => setList([])}>Clear</button>
        )}
      </div>
      <div className="result-list">
        {displayed.length === 0 && (
          <div className="empty">
            <div className="empty-icon">📭</div>
            <div className="empty-text">Send a command to see results</div>
          </div>
        )}
        {displayed.map(r => (
          <ResultItem key={r.id} result={r} />
        ))}
      </div>
    </div>
  );
}
