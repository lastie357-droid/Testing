import React, { useState } from 'react';

export default function ParamModal({ cmd, onSend, onClose }) {
  const initial = {};
  (cmd.params || []).forEach(p => { initial[p.key] = p.default || ''; });
  const [values, setValues] = useState(initial);

  const set = (key, val) => setValues(prev => ({ ...prev, [key]: val }));
  const canSend = (cmd.params || []).every(p => {
    const value = values[p.key] || '';
    return (!p.required || value.trim().length > 0)
      && (!p.maxLength || value.length <= p.maxLength);
  });

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-title">
          {cmd.icon} {cmd.label}
        </div>
        {cmd.params.map(p => (
          <div key={p.key} className="modal-field">
            <label>{p.label}</label>
            <input
              data-testid={`input-${cmd.id}-${p.key}`}
              value={values[p.key]}
              onChange={e => set(p.key, e.target.value)}
              placeholder={p.default || ''}
              required={Boolean(p.required)}
              maxLength={p.maxLength}
            />
          </div>
        ))}
        <div className="modal-actions">
          <button
            data-testid={`button-send-${cmd.id}`}
            className="btn-primary"
            onClick={() => canSend && onSend(values)}
            disabled={!canSend}
            style={!canSend ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            Send Command
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
