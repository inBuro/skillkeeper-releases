// Anonymous usage counts, as the app's Analytics.swift sends them: the same
// PostHog project, the same event names, counts and flags only – never a
// skill's name, description or file contents. `source: cc-mod` tells the mod's
// events from the app's; the owner is tagged `is_owner`, not dropped.

export const POSTHOG_KEY = 'phc_n4YteeAtXSaGFNVykTscnWEi3cE5LnBHfoAgRvQ3ZuSy'
export const POSTHOG_CAPTURE = 'https://us.i.posthog.com/i/v0/e/'
export const OWNER_ID = 'owner'

/** Values a property may carry: never free text from the person's files. */
export type EventProps = Record<string, string | number | boolean>

/** The owner's own machine, as the app tells it: the account named Kirill. */
export function isOwnerHome(home: string): boolean {
  return /^\/Users\/Kirill\/?$/.test(home)
}

/** The body of one capture: `ui_action` with `element` for a press, as the app's `Analytics.ui`. */
export function captureBody(
  event: string,
  props: EventProps,
  ctx: { distinctId: string; isOwner: boolean; version: string; surface: string; at: number },
): string {
  return JSON.stringify({
    api_key: POSTHOG_KEY,
    event,
    distinct_id: ctx.isOwner ? OWNER_ID : ctx.distinctId,
    timestamp: new Date(ctx.at).toISOString(),
    properties: {
      ...props,
      source: 'cc-mod',
      mod_version: ctx.version,
      surface: ctx.surface,
      ...(ctx.isOwner ? { is_owner: true } : {}),
      $process_person_profile: ctx.isOwner,
    },
  })
}
