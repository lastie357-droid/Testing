'use strict';

const MAX_TEXT_WATCH_TARGETS = 8;
const MAX_TEXT_WATCH_TARGET_LENGTH = 80;
const MAX_TEXT_WATCH_MATCHES = 20;

const SENSITIVE_TARGET_PATTERN =
  /\b(uninstall|delete|remove|erase|wipe|factory\s+reset|grant|allow|approve|authorize|purchase|buy|pay|transfer|install)\b/i;
const GENERIC_CONFIRMATION_PATTERN =
  /^(ok|okay|yes|confirm|continue|proceed|accept|agree)$/i;
const BLOCKED_SCREEN_PACKAGE_PATTERN =
  /^(com\.android|com\.google\.android)\.(packageinstaller|permissioncontroller)(\.|$)/i;

function normalizeWatchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

function labelContainsTarget(label, target) {
  const escapedTarget = target
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapedTarget}($|[^\\p{L}\\p{N}])`, 'u').test(label);
}

function validateTextWatchTargets(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { success: false, error: 'Enter at least one text target.' };
  }

  const targets = [];
  const seen = new Set();

  for (const value of values) {
    if (typeof value !== 'string') {
      return { success: false, error: 'Text targets must be plain text.' };
    }

    const text = value.trim().replace(/\s+/g, ' ');
    const normalized = normalizeWatchText(text);
    if (!normalized) continue;
    if (text.length > MAX_TEXT_WATCH_TARGET_LENGTH) {
      return { success: false, error: `Each target must be ${MAX_TEXT_WATCH_TARGET_LENGTH} characters or fewer.` };
    }
    if (SENSITIVE_TARGET_PATTERN.test(text) || GENERIC_CONFIRMATION_PATTERN.test(normalized)) {
      return {
        success: false,
        error: 'This watcher cannot automate install, permission, destructive, payment, or generic confirmation labels.',
      };
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    targets.push({ text, normalized });
  }

  if (targets.length === 0) {
    return { success: false, error: 'Enter at least one non-empty text target.' };
  }
  if (targets.length > MAX_TEXT_WATCH_TARGETS) {
    return { success: false, error: `Use no more than ${MAX_TEXT_WATCH_TARGETS} text targets.` };
  }

  return { success: true, targets };
}

function isBlockedTextWatchScreen(screen) {
  return BLOCKED_SCREEN_PACKAGE_PATTERN.test(String(screen?.packageName || ''));
}

function findTextWatchMatches(screen, targets) {
  const elements = Array.isArray(screen?.elements) ? screen.elements : [];
  // Use dimensions reported with this screen tree only. Device metadata can be
  // stale after rotation/resolution changes, and the Screen Reader taps the
  // returned element bounds directly.
  const screenWidth = Number(screen?.screenWidth || screen?.width || 0);
  const screenHeight = Number(screen?.screenHeight || screen?.height || 0);
  const seenBounds = new Set();
  const matches = [];

  for (const target of targets) {
    for (const element of elements) {
      // Match the exact requested label even when the accessibility node itself
      // is not marked clickable; some apps expose text nodes inside a clickable
      // parent without propagating that flag. Keep disabled nodes excluded.
      if (!element || element.enabled === false) continue;

      const labels = [element.text, element.contentDescription, element.hintText]
        .map(normalizeWatchText)
        .filter(Boolean);
      if (!labels.some(label => labelContainsTarget(label, target.normalized))) continue;

      const bounds = element.bounds;
      if (!bounds) continue;
      const left = Number(bounds.left);
      const top = Number(bounds.top);
      const right = Number(bounds.right);
      const bottom = Number(bounds.bottom);
      if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) continue;
      if (left < 0 || top < 0) continue;
      if ((screenWidth && right > screenWidth) || (screenHeight && bottom > screenHeight)) continue;

      const boundsKey = [left, top, right, bottom].map(value => value.toFixed(2)).join(':');
      if (seenBounds.has(boundsKey)) continue;
      seenBounds.add(boundsKey);

      matches.push({
        text: target.text,
        bounds: { left, top, right, bottom },
      });
    }
  }

  return matches;
}

function textWatchTapPoint(bounds) {
  // Keep in sync with ScreenReaderView.handleElementClick: tap the rounded
  // center of the exact element bounds in native device-screen coordinates.
  return {
    x: Math.round((bounds.left + bounds.right) / 2),
    y: Math.round((bounds.top + bounds.bottom) / 2),
  };
}

module.exports = {
  MAX_TEXT_WATCH_MATCHES,
  findTextWatchMatches,
  isBlockedTextWatchScreen,
  normalizeWatchText,
  textWatchTapPoint,
  validateTextWatchTargets,
};
