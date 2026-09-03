---
name: Expo preview native dependency quirk
description: Expo Metro can run normally even when React Native DevTools logs a missing system library.
---

The Expo preview can remain usable when the optional React Native DevTools installer reports a missing Linux shared library; treat Metro readiness and the app bundle as the decisive checks.

**Why:** The Replit Nix environment may not include every desktop library used by optional DevTools tooling, while the mobile/web bundle itself still starts correctly.

**How to apply:** Do not change app code for this warning alone. Check that Metro is serving and the bundle completes before investigating further.