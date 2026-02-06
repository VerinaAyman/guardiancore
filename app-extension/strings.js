// GuardianCore UI Strings - Centralized for future i18n
// Week 4: All user-visible strings in one place

export const strings = {
  // Common
  app_name: "GuardianCore",
  ok: "OK",
  cancel: "Cancel",
  save: "Save",
  delete: "Delete",
  confirm: "Confirm",
  close: "Close",
  
  // PIN & Authentication
  pin_enter: "Enter Parent PIN",
  pin_incorrect: "Incorrect PIN. Please try again.",
  pin_create: "Create a 4-digit PIN",
  pin_confirm: "Confirm your PIN",
  pin_mismatch: "PINs don't match. Please try again.",
  pin_success: "PIN saved successfully",
  pin_change: "Change PIN",
  pin_forgot: "Forgot PIN?",
  
  // Recovery Codes
  recovery_title: "Recovery Codes",
  recovery_generate: "Generate Recovery Codes",
  recovery_regenerate: "Regenerate Codes",
  recovery_download: "Download Codes",
  recovery_warning: "Keep these codes offline and secure. Each can be used once to reset your PIN.",
  recovery_regenerate_warning: "This will invalidate all existing recovery codes. Continue?",
  recovery_codes_generated: "Recovery codes generated. Download them now!",
  recovery_enter_code: "Enter a recovery code to reset PIN",
  recovery_code_invalid: "Invalid or already used recovery code",
  recovery_code_success: "Recovery code verified. Please set a new PIN.",
  recovery_status: "Recovery Codes Status",
  recovery_unused: "unused",
  recovery_used: "used",
  
  // Gamification
  safe_streak: "Safe Streak",
  safe_streak_hours: "hours without violations",
  risk_score: "Risk Score",
  time_left: "Time Left",
  minutes_remaining: "minutes remaining",
  compliant_message: "Great job! Keep up the safe browsing.",
  
  // Blocking & Explanations
  blocked_title: "Content Blocked",
  blocked_time_window: "Blocked due to time restrictions",
  blocked_category: "Blocked: restricted content",
  blocked_ask_parent: "Ask a parent in Options for more information.",
  blocked_reason: "Reason",
  
  // Options Page Tabs
  tab_rules: "Rules",
  tab_security: "Security",
  tab_recovery: "Recovery Codes",
  tab_export: "Export/Import",
  tab_about: "About",
  
  // Rules Management
  rules_add: "Add Rule",
  rules_empty: "No rules yet. Add one above!",
  rules_configure_backend: "Configure backend settings first",
  rule_type: "Rule Type",
  rule_pattern: "Pattern",
  rule_enabled: "Enabled",
  rule_explanation: "Explanation",
  rule_allowlist: "Allowlist",
  rule_blocklist: "Blocklist",
  rule_time_window: "Time Window",
  
  // Export/Import
  export_title: "Export Rules",
  export_button: "Export All Rules",
  import_title: "Import Rules",
  import_button: "Import Rules",
  import_success: "Rules imported successfully",
  import_error: "Failed to import rules",
  
  // Factory Reset
  factory_reset: "Factory Reset",
  factory_reset_warning: "This will erase local rules cache, PIN, and recovery codes from this browser profile. This cannot be undone.",
  factory_reset_confirm: "Are you absolutely sure?",
  factory_reset_success: "Factory reset complete. Extension reloading...",
  
  // WebAuthn (Stub)
  webauthn_register: "Register Device",
  webauthn_coming_soon: "WebAuthn support coming soon",
  
  // Stats
  stats_title: "Statistics",
  stats_refresh: "Refresh Statistics",
  stats_total_audits: "Total Audits",
  stats_unique_origins: "Unique Origins",
  stats_avg_trackers: "Avg. Trackers",
  stats_blocked_attempts: "Blocked Attempts",
  
  // Backend Settings
  backend_url: "Backend URL",
  backend_token: "API Token",
  settings_readonly: "Settings are read-only in popup. Change in Options.",
  settings_open_options: "Open Parent Settings",
  
  // Role Messages
  child_view_message: "This is your activity summary. For changes, ask a parent.",
  parent_settings_message: "Parent Settings - PIN protected"
};

export default strings;
