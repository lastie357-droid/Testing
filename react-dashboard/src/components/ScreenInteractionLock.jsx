import React, { useEffect, useState } from 'react';

export default function ScreenInteractionLock({ isActive }) {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (!isActive || !locked) return undefined;
    const mainContent = document.querySelector('.main-content');
    mainContent?.classList.add('screen-interaction-locked');
    return () => mainContent?.classList.remove('screen-interaction-locked');
  }, [isActive, locked]);

  useEffect(() => {
    if (!isActive) setLocked(false);
  }, [isActive]);

  if (!isActive) return null;

  return (
    <button
      type="button"
      className={`screen-interaction-lock${locked ? ' is-locked' : ''}`}
      aria-pressed={locked}
      onClick={() => setLocked(value => !value)}
      title={locked ? 'Unlock page scrolling' : 'Lock page scrolling while using the phone screen'}
    >
      {locked ? '🔒 Page Locked' : '🔓 Lock Page'}
    </button>
  );
}
