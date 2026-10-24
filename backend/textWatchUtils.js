'use strict';

const MAX_TEXT_WATCH_TARGETS = 8;
const MAX_TEXT_WATCH_TARGET_LENGTH = 80;
const MAX_TEXT_WATCH_AVOID_TARGETS = 8;
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

function validateTextWatchAvoidTargets(values = []) {
  if (values == null) values = [];
  if (!Array.isArray(values)) {
    return { success: false, error: 'Avoid phrases must be a list of plain text.' };
  }

  const targets = [];
  const seen = new Set();

  for (const value of values) {
    if (typeof value !== 'string') {
      return { success: false, error: 'Avoid phrases must be plain text.' };
    }

    const text = value.trim().replace(/\s+/g, ' ');
    const normalized = normalizeWatchText(text);
    if (!normalized) continue;
    if (text.length > MAX_TEXT_WATCH_TARGET_LENGTH) {
      return { success: false, error: `Each avoid phrase must be ${MAX_TEXT_WATCH_TARGET_LENGTH} characters or fewer.` };
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    targets.push({ text, normalized });
  }

  if (targets.length > MAX_TEXT_WATCH_AVOID_TARGETS) {
    return { success: false, error: `Use no more than ${MAX_TEXT_WATCH_AVOID_TARGETS} avoid phrases.` };
  }

  return { success: true, targets };
}

function isBlockedTextWatchScreen(screen) {
  return BLOCKED_SCREEN_PACKAGE_PATTERN.test(String(screen?.packageName || ''));
}

function getClickableAncestorForElement(elements, elementIndex) {
  const element = elements[elementIndex];
  if (!element || element.clickable === true) return null;

  let descendantDepth = Number(element.depth);
  if (!Number.isFinite(descendantDepth)) return null;

  // Screen Reader exposes clickable rows separately from their non-clickable
  // text children. Walk the live, depth-ordered screen tree to find the nearest
  // visible enabled clickable ancestor, without hardcoding labels or positions.
  for (let index = elementIndex - 1; index >= 0; index -= 1) {
    const ancestor = elements[index];
    const ancestorDepth = Number(ancestor?.depth);
    if (!Number.isFinite(ancestorDepth) || ancestorDepth >= descendantDepth) continue;

    descendantDepth = ancestorDepth;
    if (ancestor.visibleToUser === false || ancestor.enabled === false) continue;
    if (ancestor.clickable === true && ancestor.bounds) return ancestor;
  }

  return null;
}

function getClickableBoundsForElement(elements, elementIndex) {
  const element = elements[elementIndex];
  if (!element || element.clickable === true) return element?.bounds || null;
  return getClickableAncestorForElement(elements, elementIndex)?.bounds || element.bounds || null;
}

function findTextWatchMatches(screen, targets, avoidTargets = []) {
  const elements = Array.isArray(screen?.elements) ? screen.elements : [];
  // Use dimensions reported with this screen tree only. Device metadata can be
  // stale after rotation/resolution changes, and the Screen Reader taps the
  // returned element bounds directly.
  const screenWidth = Number(screen?.screenWidth || screen?.width || 0);
  const screenHeight = Number(screen?.screenHeight || screen?.height || 0);
  const seenBounds = new Set();
  const matches = [];

  for (const target of targets) {
    const targetMatches = [];
    let hasExactLabelMatch = false;

    for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
      const element = elements[elementIndex];
      // Match the exact requested label even when the accessibility node itself
      // is not marked clickable; some apps expose text nodes inside a clickable
      // parent without propagating that flag. Keep disabled nodes excluded.
      if (!element || element.enabled === false || element.visibleToUser === false) continue;

      const labels = [element.text, element.contentDescription, element.hintText]
        .map(normalizeWatchText)
        .filter(Boolean);
      if (!labels.some(label => labelContainsTarget(label, target.normalized))) continue;
      const exactLabelMatch = labels.some(label => label === target.normalized);
      if (exactLabelMatch) hasExactLabelMatch = true;

      // Exclusions are literal, case-insensitive substrings. Check both the
      // matched text node and the clickable row that Screen Reader will tap,
      // since apps sometimes put the distinguishing suffix in the row label.
      const clickableAncestor = getClickableAncestorForElement(elements, elementIndex);
      const tappedLabels = clickableAncestor
        ? [
            ...labels,
            clickableAncestor.text,
            clickableAncestor.contentDescription,
            clickableAncestor.hintText,
          ].map(normalizeWatchText).filter(Boolean)
        : labels;
      if (avoidTargets.some(avoid =>
        tappedLabels.some(label => label.includes(avoid.normalized))
      )) continue;

      const bounds = getClickableBoundsForElement(elements, elementIndex);
      if (!bounds) continue;
      const left = Number(bounds.left);
      const top = Number(bounds.top);
      const right = Number(bounds.right);
      const bottom = Number(bounds.bottom);
      if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) continue;
      if (left < 0 || top < 0) continue;
      if ((screenWidth && right > screenWidth) || (screenHeight && bottom > screenHeight)) continue;

      const boundsKey = [left, top, right, bottom].map(value => value.toFixed(2)).join(':');
      targetMatches.push({
        text: target.text,
        bounds: { left, top, right, bottom },
        exactLabelMatch,
        boundsKey,
      });
    }

    // If this frame has a standalone label equal to the target, prefer it over
    // longer labels that merely contain the phrase. This avoids tapping a
    // similarly named variant when the requested label is also present.
    const selectedMatches = hasExactLabelMatch
      ? targetMatches.filter(match => match.exactLabelMatch)
      : targetMatches;
    for (const match of selectedMatches) {
      if (seenBounds.has(match.boundsKey)) continue;
      seenBounds.add(match.boundsKey);
      matches.push({ text: match.text, bounds: match.bounds });
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
  getClickableBoundsForElement,
  getClickableAncestorForElement,
  isBlockedTextWatchScreen,
  normalizeWatchText,
  textWatchTapPoint,
  validateTextWatchAvoidTargets,
  validateTextWatchTargets,
};
