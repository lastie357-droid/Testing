'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findTextWatchMatches,
  isBlockedTextWatchScreen,
  textWatchTapPoint,
  validateTextWatchTargets,
} = require('./textWatchUtils');

test('validates exact text targets and rejects confirmation or sensitive labels', () => {
  const valid = validateTextWatchTargets(['  Sign   in ', 'Next', 'sign in']);
  assert.equal(valid.success, true);
  assert.deepEqual(valid.targets.map(target => target.text), ['Sign in', 'Next']);

  for (const forbidden of ['Uninstall', 'Allow access', 'Delete account', 'Continue', 'OK']) {
    assert.equal(validateTextWatchTargets([forbidden]).success, false, forbidden);
  }
});

test('finds clickable and non-clickable exact text matches once, in target order, using the given bounds', () => {
  const validation = validateTextWatchTargets(['First', 'Second']);
  const screen = {
    screenWidth: 400,
    screenHeight: 800,
    elements: [
      { text: 'Second', clickable: true, bounds: { left: 250, top: 300, right: 350, bottom: 350 } },
      { text: 'first', clickable: true, bounds: { left: 20, top: 100, right: 120, bottom: 150 } },
      { text: 'First', clickable: true, bounds: { left: 140, top: 100, right: 220, bottom: 150 } },
      { text: 'First', clickable: false, bounds: { left: 15, top: 20, right: 100, bottom: 60 } },
      { text: 'First', clickable: true, enabled: false, bounds: { left: 15, top: 20, right: 100, bottom: 60 } },
      { text: 'First', clickable: true, bounds: { left: 20, top: 100, right: 120, bottom: 150 } },
      { text: 'First', clickable: true, bounds: { left: -5, top: 10, right: 10, bottom: 30 } },
      { text: 'First', clickable: true, bounds: { left: 20, top: 790, right: 120, bottom: 820 } },
    ],
  };

  const matches = findTextWatchMatches(screen, validation.targets);
  assert.deepEqual(matches.map(match => match.text), ['First', 'First', 'First', 'Second']);
  assert.deepEqual(matches.map(match => match.bounds.left), [20, 140, 15, 250]);
});

test('matches carrier names as whole phrases inside longer screen-reader labels', () => {
  const validation = validateTextWatchTargets(['sAfArIcOm', 'aIrTeL']);
  const screen = {
    screenWidth: 400,
    screenHeight: 800,
    elements: [
      { text: 'SAFARICOM SIM 1', clickable: true, bounds: { left: 10, top: 100, right: 190, bottom: 150 } },
      { contentDescription: 'Select AIRTEL network', clickable: true, bounds: { left: 200, top: 100, right: 390, bottom: 150 } },
      { text: 'MySafaricom', clickable: true, bounds: { left: 10, top: 200, right: 190, bottom: 250 } },
    ],
  };

  const matches = findTextWatchMatches(screen, validation.targets);
  assert.deepEqual(matches.map(match => match.text), ['sAfArIcOm', 'aIrTeL']);
  assert.deepEqual(matches.map(match => match.bounds.left), [10, 200]);
});

test('uses the current screen tree bounds without stale cached device dimensions', () => {
  const validation = validateTextWatchTargets(['Safaricom']);
  const matches = findTextWatchMatches({
    elements: [
      { text: 'Safaricom', bounds: { left: 760, top: 1900, right: 1040, bottom: 1980 } },
    ],
  }, validation.targets);

  assert.equal(matches.length, 1);
  assert.deepEqual(textWatchTapPoint(matches[0].bounds), { x: 900, y: 1940 });
});

test('blocks Android installer and permission-controller screens', () => {
  assert.equal(isBlockedTextWatchScreen({ packageName: 'com.android.packageinstaller' }), true);
  assert.equal(isBlockedTextWatchScreen({ packageName: 'com.google.android.permissioncontroller' }), true);
  assert.equal(isBlockedTextWatchScreen({ packageName: 'com.example.app' }), false);
});
