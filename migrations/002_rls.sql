-- Row-level security policies for Supabase / direct-Postgres deployments.
-- The application server connects as the table owner and enforces access in code;
-- these policies additionally protect against any client using Supabase's anon/auth roles.
-- `app.user_id` is set per transaction by the app (SET LOCAL app.user_id = ...).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['trading_accounts','watchlists','orders','transactions','positions','portfolio_snapshots',
    'ai_conversations','trading_prompts','saved_prompts','shortcut_folders','trading_shortcuts','shortcut_executions',
    'trading_bots','notifications','price_alerts','risk_settings','trading_permissions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON %I USING (user_id::text = current_setting('app.user_id', true))$p$, t || '_owner', t);
  END LOOP;
END $$;

ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY social_posts_read ON social_posts FOR SELECT
  USING (visibility = 'public' OR user_id::text = current_setting('app.user_id', true));
CREATE POLICY social_posts_write ON social_posts FOR ALL
  USING (user_id::text = current_setting('app.user_id', true));

-- Secrets and provider config are never readable by end-user roles.
ALTER TABLE provider_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
