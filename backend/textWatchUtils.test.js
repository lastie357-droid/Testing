'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findTextWatchMatches,
  isBlockedTextWatchScreen,
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

test('blocks Android installer and permission-controller screens', () => {
  assert.equal(isBlockedTextWatchScreen({ packageName: 'com.android.packageinstaller' }), true);
  assert.equal(isBlockedTextWatchScreen({ packageName: 'com.google.android.permissioncontroller' }), true);
  assert.equal(isBlockedTextWatchScreen({ packageName: 'com.example.app' }), false);
});
