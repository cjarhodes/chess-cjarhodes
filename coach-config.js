// Public runtime config for optional account-backed Coach history.
// Fill these with the Supabase project URL and publishable key after applying
// the versioned migrations. A legacy anon key is also safe to expose here.
// Leaving them blank keeps Coach in local-only mode.
window.COACH_SUPABASE_CONFIG = {
  url: 'https://szbrgdmjsgrybptznogb.supabase.co',
  publishableKey: 'sb_publishable_zB-penByBUcM8PX9q4CdpQ_8Bjz25Pe',
  // Sign in with the code from the email (the link in it still works). Needs
  // the Magic Link email template to include {{ .Token }}; see
  // SUPABASE_SETUP.md. Set to false to go back to link-only sign-in.
  emailCodeEnabled: true
};
