// Product identity, in one place.
//
// The name is expected to change again — "Great Lakes" may be dropped once the
// coverage outgrows it, leaving just "Harbor Report" — so no USER-FACING copy
// hardcodes it. Renaming is an edit to this file plus the two docs headings
// (CLAUDE.md, README.md).
//
// Three places deliberately keep the retired name, and renaming them would be a
// mistake rather than tidiness:
//   • The NOAA User-Agent fallback in ndbc/nws/alerts and the live scripts. That is a
//     courtesy identifier for NOAA, not branding, and is overridden by NWS_USER_AGENT.
//   • The Firebase project id chicago-harbor-sailing-app (lib/firebase.ts). Project
//     ids are permanent; changing it would orphan every existing account.
//   • The Hosting site chicago-harbor-sailing.web.app. Site ids cannot be renamed —
//     attach a custom domain instead, and the .web.app id stops being visible.
//
// Note the two traps the previous name fell into, and don't reintroduce them:
//   • Geography it will outgrow. "Chicago" broke once coverage reached Wisconsin and
//     Michigan; "Lake Michigan" would break the same way at the next lake.
//   • The word "sailing". The app rates kayaks and paddleboards too (BoatProfile.craft),
//     and the copy is deliberately craft-neutral — the name should stay that way.

export const APP_NAME = "Great Lakes Harbor Report";

/** The question the product answers. Craft-neutral: "go out" covers paddling. */
export const TAGLINE = "should you go out right now?";

/** Meta description. Carries the geography for search; revisit alongside APP_NAME. */
export const DESCRIPTION =
  `Green / yellow / red harbor conditions across the Great Lakes, personalized to your ` +
  `boat and skill — ${TAGLINE}`;
