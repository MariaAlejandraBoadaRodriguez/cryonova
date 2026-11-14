/**
 * Development-only network shim for CLI scripts.
 *
 * Some sandboxed development environments only allow outbound HTTPS through an
 * egress proxy announced via HTTPS_PROXY, with an allowlist of exact hosts.
 * Node's built-in fetch ignores HTTPS_PROXY, so CLI scripts call this once at
 * startup. When a proxy is present, Neon SQL-over-HTTP requests are also sent
 * to the endpoint host itself (which serves the same /sql API) instead of the
 * regional api.* host. The deployed web app never imports this module.
 */
import { neonConfig } from "@neondatabase/serverless";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

export function enableDevProxy(): void {
  if (process.env.HTTPS_PROXY || process.env.https_proxy) {
    setGlobalDispatcher(new EnvHttpProxyAgent());
    neonConfig.fetchEndpoint = (host: string) => `https://${host}/sql`;
  }
}
