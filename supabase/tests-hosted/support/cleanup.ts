import { SupabaseClient } from "@supabase/supabase-js"
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "./env"

const CAMPAIGN_TITLE_PREFIX = "hosted-test-"
const TEST_USER_EMAILS = [
  "hosted-brand-owner-1@biboh.test",
  "hosted-brand-owner-2@biboh.test",
  "hosted-creator-1@biboh.test",
  "hosted-creator-2@biboh.test",
  "hosted-creator-3@biboh.test",
  "hosted-creator-4@biboh.test",
  "hosted-creator-5@biboh.test",
  "hosted-creator-6@biboh.test",
  "hosted-creator-7@biboh.test",
  "hosted-creator-8@biboh.test",
  "hosted-outsider@biboh.test",
] as const

export async function cleanup(serviceClient: SupabaseClient): Promise<void> {
  // Delete campaigns created by tests (by title prefix)
  await serviceClient.from("campaigns").delete().like("title", `${CAMPAIGN_TITLE_PREFIX}%`)

  // Delete all test users via the service-role admin API
  for (const email of TEST_USER_EMAILS) {
    try {
      await serviceClient.auth.admin.deleteUser(
        (await serviceClient.from("profiles").select("id").eq("email", email).single()).data?.id ??
          ""
      )
    } catch {
      // Ignore errors - user may not exist
    }
  }
}

export { CAMPAIGN_TITLE_PREFIX }