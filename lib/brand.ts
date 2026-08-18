// Product identity, in one place.
//
// The name is expected to change again — "Great Lakes" may be dropped once the
// coverage outgrows it, leaving just "Harbor Report" — so nothing else in the app
// hardcodes it. Renaming should be an edit to this file plus the two docs headings
// (CLAUDE.md, README.md), not a search across the codebase.
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
