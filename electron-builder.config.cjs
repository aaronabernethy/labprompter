// electron-builder config, split out of package.json so it can vary by
// whether a real signing identity is available — see the `mac` block below.
//
// Our release.yml CI job sets CSC_IDENTITY_AUTO_DISCOVERY=false whenever no
// CSC_LINK secret is configured, specifically so the runner (which has no
// certificate in its keychain at all) doesn't fail trying to auto-discover
// one. But asking electron-builder for hardenedRuntime + entitlements with
// no identity at all hits a real upstream bug: it still attempts a signing
// pass, logs "empty password will be used for code signing", then fails
// with "<project root> not a file" — not a path to anything we built, the
// project root itself, because it mis-resolves the sign target when there's
// no identity to sign with. (Confirmed: this is exactly what killed the
// very first CI run, back when v1.4.0 was tagged, with none of this
// session's code involved — a pre-existing CI bug, not a regression.)
//
// The fix is to not ask for hardened-runtime signing at all when we know
// there's no identity: set `identity: null` and drop entitlements, which
// makes electron-builder skip code signing cleanly instead of attempting
// and failing it. A real Mac (with the free Apple Development cert already
// in its keychain) never sets CSC_IDENTITY_AUTO_DISCOVERY=false, so local
// `npm run dist` builds keep signing normally and are unaffected.
const forcedUnsigned = process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false';

module.exports = {
  appId: 'com.labprompter.app',
  productName: 'LabPrompter',
  files: ['src/**/*', 'package.json'],
  directories: {
    output: 'dist',
  },
  mac: {
    category: 'public.app-category.video',
    target: ['dmg', 'zip'],
    ...(forcedUnsigned
      ? { identity: null }
      : {
          hardenedRuntime: true,
          gatekeeperAssess: false,
          entitlements: 'build/entitlements.mac.plist',
          entitlementsInherit: 'build/entitlements.mac.plist',
        }),
    extraResources: [{ from: 'native/speech-helper/dist/speech-helper', to: 'speech-helper' }],
    extendInfo: {
      NSMicrophoneUsageDescription:
        'LabPrompter uses the microphone so voice-follow can keep the script scrolling in time with your voice. Audio is processed on this Mac only.',
      NSSpeechRecognitionUsageDescription:
        'LabPrompter uses on-device speech recognition to match your voice to the script for voice-follow scrolling. Nothing is sent to Apple or anywhere else.',
    },
  },
  publish: {
    provider: 'github',
    owner: 'aaronabernethy',
    repo: 'labprompter',
  },
};
