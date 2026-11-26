-- DEX routers are public, non-custodial APIs (every swap is signed by the user's own wallet), so they no longer need a
-- compliance approval. Ones whose production test already passed move from "Awaiting approval" to connected.
UPDATE provider_configs SET status = 'production_connected', updated_at = now()
 WHERE environment = 'production' AND status = 'awaiting_approval' AND enabled = true AND last_success_at IS NOT NULL
   AND provider_id IN ('jupiter', 'pumpfun', 'zerox', 'swapkit', 'cetus', 'panora');
