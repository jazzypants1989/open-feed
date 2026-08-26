// Extend Open Feed's WebFinger response with an AP actor link.
// If a bridge is present, the WebFinger response SHOULD include the actor.
import { webfinger as baseWebfinger } from '../src/views.js';

export function webfinger(name, feedLocation, bridgeOrigin) {
  const base = JSON.parse(baseWebfinger(name, feedLocation));
  base.links.push({
    rel: 'self',
    type: 'application/activity+json',
    href: `${bridgeOrigin}/users/${name}`,
  });
  return JSON.stringify(base, null, 1);
}
