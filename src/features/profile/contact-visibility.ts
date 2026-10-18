/** Who can see a contact detail on a profile. */
export const CONTACT_VISIBILITY_VALUES = ['public', 'connections', 'private'] as const;
export type ContactVisibilityLevel = (typeof CONTACT_VISIBILITY_VALUES)[number];

/** The contact groups the owner can control. `location` covers city, country and timezone. */
export const CONTACT_FIELDS = ['location', 'website', 'phone'] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

export type ContactVisibility = Record<ContactField, ContactVisibilityLevel>;

/** Used when a profile has no setting yet (profiles created before this feature existed). */
export const DEFAULT_CONTACT_VISIBILITY: ContactVisibility = {
  location: 'public',
  website: 'public',
  phone: 'private',
};

/** How the viewer relates to the profile owner. "connected" = they follow each other. */
export type ViewerRelation = 'self' | 'connected' | 'other';

export const canSee = (level: ContactVisibilityLevel, relation: ViewerRelation): boolean =>
  relation === 'self' ||
  level === 'public' ||
  (level === 'connections' && relation === 'connected');

/** Fields removed from the response when a group is hidden from the viewer. */
const FIELDS_OF: Record<ContactField, string[]> = {
  location: ['city', 'country', 'timezone'],
  website: ['website'],
  phone: ['phone'],
};

/**
 * Removes what the viewer may not see. The owner gets everything; everybody else never
 * receives the visibility settings themselves.
 */
export function redactContact<T extends Record<string, any>>(
  profile: T,
  relation: ViewerRelation,
): T {
  const levels = { ...DEFAULT_CONTACT_VISIBILITY, ...(profile.contactVisibility ?? {}) };
  if (relation === 'self') return { ...profile, contactVisibility: levels };

  const out: Record<string, any> = { ...profile };
  for (const group of CONTACT_FIELDS) {
    if (!canSee(levels[group], relation)) {
      for (const key of FIELDS_OF[group]) delete out[key];
    }
  }
  delete out.contactVisibility;
  return out as T;
}
